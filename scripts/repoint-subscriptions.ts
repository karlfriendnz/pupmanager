/**
 * Move every live subscription onto the CURRENT core Price.
 *
 * Stripe Price amounts are immutable, so a price change means minting a new
 * Price (see create-stripe-products.ts) and then repointing the subscriptions
 * that still reference the old one. Without this step existing customers keep
 * paying the superseded amount forever while the app quotes the new one.
 *
 * Safe by construction:
 *  - DRY RUN by default. Pass --apply to actually write to Stripe.
 *  - proration_behavior: 'none' — nobody gets a surprise mid-cycle charge or
 *    credit. The new amount takes effect from their next invoice.
 *  - trial dates untouched — trial_end is never sent, and Stripe only changes
 *    a trial when you pass the field, so a trialing subscriber keeps their
 *    exact end date. Repointing must never shorten or extend a trial.
 *  - Only the CORE line item is touched. Seats and add-ons keep their own
 *    items and prices.
 *  - Skips any subscription already on the right price.
 *
 * Run (dry):    npx tsx --env-file=.env.local scripts/repoint-subscriptions.ts
 * Run (for real): npx tsx --env-file=.env.local scripts/repoint-subscriptions.ts --apply
 *
 * STRIPE_SECRET_KEY decides the mode: any key containing `_live_` (sk_live_ or
 * a restricted rk_live_) hits live; anything else is treated as test.
 */
import Stripe from 'stripe'
import { scriptPrisma } from '../src/lib/prisma-script'
import { CURRENCIES, type CurrencyCode } from '../src/lib/pricing'

const APPLY = process.argv.includes('--apply')
const SECRET = process.env.STRIPE_SECRET_KEY ?? ''
if (!SECRET) {
  console.error('STRIPE_SECRET_KEY is not set.')
  process.exit(1)
}
// Live vs test is decided by the key itself. Matches `_live_` rather than
// an `sk_live_` prefix so a RESTRICTED key (rk_live_…) is correctly read as
// LIVE — the safest way to run these scripts is a restricted key scoped to
// Products/Prices/Subscriptions, and treating one as TEST would point a live
// migration at test data (or worse, report success having done nothing).
const MODE = /_live_/.test(SECRET) ? 'LIVE' : 'TEST'

const prisma = scriptPrisma()
const stripe = new Stripe(SECRET, { apiVersion: '2026-04-22.dahlia' })

// The current core Price per currency, resolved from the lookup_key that
// create-stripe-products.ts maintains. Reading Stripe (not the DB) keeps this
// script correct even if the DB wiring lags.
async function currentCorePrices(): Promise<Record<string, { id: string; amount: number }>> {
  const out: Record<string, { id: string; amount: number }> = {}
  for (const { code } of CURRENCIES) {
    const key = `pm_core_${code as CurrencyCode}`
    const found = await stripe.prices.list({ lookup_keys: [key], limit: 1 })
    const p = found.data[0]
    if (p) out[code] = { id: p.id, amount: (p.unit_amount ?? 0) / 100 }
    else console.warn(`  ! no price found for lookup_key ${key} — run create-stripe-products.ts first`)
  }
  return out
}

async function main() {
  console.log(`\nRepointing subscriptions to the current core price — ${MODE} mode`)
  console.log(APPLY ? '*** APPLYING CHANGES ***\n' : '(dry run — pass --apply to write)\n')

  const prices = await currentCorePrices()
  for (const [cur, p] of Object.entries(prices)) {
    console.log(`  ${cur}: ${p.id} @ ${p.amount}`)
  }
  console.log('')

  const trainers = await prisma.trainerProfile.findMany({
    where: { stripeSubscriptionId: { not: null } },
    select: {
      id: true,
      businessName: true,
      payoutCurrency: true,
      subscriptionStatus: true,
      stripeSubscriptionId: true,
      sandboxBilling: true,
    },
  })

  let moved = 0, skipped = 0, failed = 0

  for (const t of trainers) {
    const label = `${t.businessName} (${(t.payoutCurrency ?? 'nzd').toUpperCase()}, ${t.subscriptionStatus})`
    // A sandbox-billing trainer's subscription lives in TEST Stripe; don't try
    // to touch it with a live key (and vice versa).
    if (t.sandboxBilling !== (MODE === 'TEST')) {
      console.log(`- skip  ${label}: sandboxBilling=${t.sandboxBilling} doesn't match ${MODE} key`)
      skipped++
      continue
    }

    const target = prices[(t.payoutCurrency ?? 'nzd').toUpperCase()]
    if (!target) {
      console.log(`- skip  ${label}: no current price for that currency`)
      skipped++
      continue
    }

    try {
      const sub = await stripe.subscriptions.retrieve(t.stripeSubscriptionId!)
      if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
        console.log(`- skip  ${label}: subscription is ${sub.status}`)
        skipped++
        continue
      }

      // Identify the core item: the one whose price carries pmKey=core.
      const coreItem = sub.items.data.find(i => i.price.metadata?.pmKey === 'core')
      if (!coreItem) {
        console.log(`- skip  ${label}: no core line item found`)
        skipped++
        continue
      }
      if (coreItem.price.id === target.id) {
        console.log(`- skip  ${label}: already on the current price`)
        skipped++
        continue
      }

      const from = (coreItem.price.unit_amount ?? 0) / 100
      console.log(`→ move  ${label}: ${from} → ${target.amount}`)

      if (APPLY) {
        await stripe.subscriptions.update(sub.id, {
          items: [{ id: coreItem.id, price: target.id }],
          // Never bill or credit for the swap itself — the new amount simply
          // applies from the next invoice.
          proration_behavior: 'none',
          // trial_end is deliberately NOT passed: Stripe only changes a trial
          // when you send the field, so omitting it leaves a trialing
          // subscriber's end date exactly where it was. (The SDK's 'unchanged'
          // literal isn't in this API version's types — omission is the
          // supported way to say the same thing.)
        })
      }
      moved++
    } catch (err) {
      failed++
      console.error(`x fail  ${label}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`\n${APPLY ? 'Moved' : 'Would move'}: ${moved} · skipped: ${skipped} · failed: ${failed}\n`)
  if (!APPLY && moved > 0) console.log('Re-run with --apply to write these changes.\n')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
