/**
 * Repair a trainer's billing link, then switch an add-on on — properly billed.
 *
 * Written for Mersea Mutts, whose `achievements` went off on 30 July and could
 * not be switched back on. The button was not the problem: their stored
 * `stripeSubscriptionId` names a subscription live Stripe says does not exist,
 * so every add-on change threw before it reached the add-on. Flipping the
 * database row would have handed them a £9/month feature for nothing AND left
 * the real fault in place, so this repairs the link first.
 *
 * ── Two things it will not do ──────────────────────────────────────────────
 * It never CREATES a subscription. If the customer has no live subscription at
 * all, that is a person deciding to start paying again, not a script's call.
 * And if it finds more than one candidate it stops and prints them: guessing
 * which subscription is "the real one" is how someone ends up billed twice.
 *
 * ── It writes to PRODUCTION ────────────────────────────────────────────────
 * Dry run by default. Nothing is written without --apply, and it prints the
 * database host and the Stripe mode before it does anything so you can see
 * where you are pointed.
 *
 *   npx tsx scripts/repair-trainer-addon.ts --trainer <id> --addon achievements
 *   npx tsx scripts/repair-trainer-addon.ts --trainer <id> --addon achievements --apply
 *
 * The add-on change itself goes through `applyAddonChange` — the same function
 * the trainer's own button and the admin screen call. This repo has already
 * charged a real customer wrong twice by having two paths compute one thing;
 * a script with its own copy of the Stripe logic would be the third.
 */
import 'dotenv/config'
import { prisma } from '@/lib/prisma'
import { stripeFor } from '@/lib/stripe'
import { applyAddonChange } from '@/lib/addon-change'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const APPLY = process.argv.includes('--apply')
const trainerId = arg('trainer')
const itemId = arg('addon') ?? 'achievements'

function line() { console.log('─'.repeat(72)) }

async function main() {
  if (!trainerId) {
    console.error('Usage: --trainer <TrainerProfile.id> [--addon achievements] [--apply]')
    process.exit(1)
  }

  const dbHost = (() => {
    try { return new URL(process.env.DATABASE_URL ?? '').host } catch { return '(unreadable)' }
  })()
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  const mode = key.startsWith('sk_live') ? 'LIVE' : key.startsWith('sk_test') ? 'TEST' : '(none)'

  line()
  console.log(`Database : ${dbHost}`)
  console.log(`Stripe   : ${mode}`)
  console.log(`Mode     : ${APPLY ? 'APPLY — this will write' : 'DRY RUN — nothing will be written'}`)
  line()

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: {
      id: true, businessName: true, sandboxBilling: true,
      stripeCustomerId: true, stripeSubscriptionId: true, payoutCurrency: true,
    },
  })
  if (!trainer) { console.error(`No trainer ${trainerId}`); process.exit(1) }

  console.log(`Trainer  : ${trainer.businessName ?? '(unnamed)'}`)
  console.log(`Currency : ${(trainer.payoutCurrency ?? 'nzd').toUpperCase()}`)
  console.log(`Sandbox  : ${trainer.sandboxBilling}`)
  console.log(`Customer : ${trainer.stripeCustomerId ?? '(none)'}`)
  console.log(`Stored subscription: ${trainer.stripeSubscriptionId ?? '(none)'}`)

  // A sandbox trainer read with a live key (or the reverse) is the most likely
  // way a stored id goes missing, so say it plainly rather than let the reader
  // infer it from a Stripe error.
  if (trainer.sandboxBilling && mode === 'LIVE') {
    console.log('\n⚠  This trainer is flagged sandboxBilling but the key is LIVE — ids will not match.')
  }

  const stripe = stripeFor(trainer.sandboxBilling)
  const addon = await prisma.trainerAddon.findUnique({
    where: { trainerId_itemId: { trainerId, itemId } },
    select: { active: true, stripeSubscriptionItemId: true, updatedAt: true },
  })
  console.log(`\nAdd-on "${itemId}": ${addon ? (addon.active ? 'ON' : 'OFF') : 'no row'}` +
    (addon ? `, last changed ${addon.updatedAt.toISOString()}` : '') +
    (addon?.stripeSubscriptionItemId ? `, billed as ${addon.stripeSubscriptionItemId}` : ', not a billed line'))

  // ── 1. Is the stored subscription real? ──────────────────────────────────
  let storedOk = false
  if (trainer.stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(trainer.stripeSubscriptionId)
      storedOk = true
      console.log(`\n✓ Stored subscription exists — status ${sub.status}, currency ${sub.currency.toUpperCase()}`)
    } catch (e) {
      console.log(`\n✗ Stored subscription is not in ${mode} Stripe: ${(e as Error).message}`)
    }
  }

  // ── 2. If not, what DOES the customer have? ──────────────────────────────
  if (!storedOk) {
    if (!trainer.stripeCustomerId) {
      console.log('\nNo Stripe customer either. They have never subscribed in this mode.')
      console.log('Nothing to repair — they need to go through checkout themselves.')
      return
    }
    const subs = await stripe.subscriptions.list({ customer: trainer.stripeCustomerId, status: 'all', limit: 20 })
    const usable = subs.data.filter(s => ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status))

    console.log(`\nCustomer has ${subs.data.length} subscription(s); ${usable.length} usable:`)
    for (const s of subs.data) {
      console.log(`  ${s.id}  ${s.status.padEnd(10)} ${s.currency.toUpperCase()}  items: ${s.items.data.map(i => i.price.id).join(', ')}`)
    }

    if (usable.length === 0) {
      console.log('\nNothing to point at. They are not paying for anything right now, so')
      console.log('re-linking would be inventing a subscription. They need to subscribe again.')
      return
    }
    if (usable.length > 1) {
      console.log('\nMore than one usable subscription. Refusing to guess — pick one by hand')
      console.log('in Stripe, cancel the rest, then re-run this.')
      return
    }

    const real = usable[0]
    console.log(`\n→ Would relink ${trainer.stripeSubscriptionId ?? '(none)'} → ${real.id}`)
    if (!APPLY) {
      console.log('   (dry run — pass --apply to write it)')
      return
    }
    await prisma.trainerProfile.update({
      where: { id: trainerId },
      data: { stripeSubscriptionId: real.id },
    })
    console.log('   ✓ relinked')
  }

  // ── 3. Switch the add-on on, through the app's own path ──────────────────
  if (!APPLY) {
    console.log(`\n→ Would switch "${itemId}" ON via applyAddonChange (adds the Stripe line item, prorated)`)
    console.log('   (dry run — pass --apply to do it)')
    return
  }

  const result = await applyAddonChange({
    trainerId,
    itemId,
    active: true,
    // Recorded honestly in the audit log as an admin action with no user behind
    // it, so the history says a PupManager operator did this and not the trainer.
    actor: { kind: 'admin', userId: null, userAgent: 'scripts/repair-trainer-addon.ts' },
  })

  if (result.ok) {
    console.log(`\n✓ "${itemId}" is on and billed. It will appear prorated on their next invoice.`)
  } else {
    console.log(`\n✗ Refused: ${result.reason} — ${result.error}`)
    process.exitCode = 1
  }
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
