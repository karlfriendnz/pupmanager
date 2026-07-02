/**
 * Prove the LIVE prod webhook + reconciliation by creating a Stripe TEST
 * subscription for the demo trainer (Core + 1 extra seat + achievements) with
 * a test card, then reading back what the prod webhook wrote to the DB.
 *
 *   npx tsx scripts/verify-demo-webhook.ts
 *
 * Talks only to Stripe TEST (key from .env.local) + READS the DB. The only DB
 * writes happen inside the production webhook handler (app.pupmanager.com),
 * which is exactly what we're testing. Demo is sandbox so this is harmless.
 */
import fs from 'node:fs'
import Stripe from 'stripe'
import { scriptPrisma } from "../src/lib/prisma-script"

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const key = process.env.STRIPE_SECRET_KEY ?? ''
if (!key.startsWith('sk_test_')) { console.error('.env.local STRIPE_SECRET_KEY must be a test key'); process.exit(1) }
const stripe = new Stripe(key, { apiVersion: '2026-04-22.dahlia' })
const prisma = scriptPrisma()

const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.() })

async function main() {
  const demo = await prisma.trainerProfile.findFirst({
    where: { user: { email: 'demo@pupmanager.com' } },
    select: { id: true, sandboxBilling: true, subscriptionStatus: true, seatCount: true, user: { select: { email: true } } },
  })
  if (!demo) throw new Error('demo trainer not found')
  console.log(`Demo trainer ${demo.id} · sandbox=${demo.sandboxBilling} · before: status=${demo.subscriptionStatus} seats=${demo.seatCount}`)
  if (!demo.sandboxBilling) throw new Error('demo is not sandbox — refusing to touch live billing')

  // Resolve TEST price IDs (NZD canonical column).
  const core = await prisma.subscriptionPlan.findUnique({ where: { id: 'core' }, select: { stripePriceIdTest: true } })
  const seat = await prisma.billingItem.findUnique({ where: { id: 'seat' }, select: { stripePriceIdTest: true } })
  const ach = await prisma.billingItem.findUnique({ where: { id: 'achievements' }, select: { stripePriceIdTest: true } })
  const prices = [core?.stripePriceIdTest, seat?.stripePriceIdTest, ach?.stripePriceIdTest]
  if (prices.some((p) => !p)) throw new Error(`missing test price IDs: ${JSON.stringify(prices)}`)

  // Test customer with a working test card, tagged so the webhook maps it back.
  const customer = await stripe.customers.create({
    email: demo.user?.email ?? 'demo@pupmanager.com',
    payment_method: 'pm_card_visa',
    invoice_settings: { default_payment_method: 'pm_card_visa' },
    metadata: { trainerId: demo.id },
  })

  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: core!.stripePriceIdTest! }, { price: seat!.stripePriceIdTest!, quantity: 1 }, { price: ach!.stripePriceIdTest! }],
    metadata: { trainerId: demo.id },
  })
  console.log(`\nCreated TEST subscription ${sub.id} · stripe status=${sub.status} (NZ$107/mo: core + 1 seat + achievements)`)
  console.log('Waiting for the prod webhook to reconcile…')

  // Poll the DB for the webhook's effect.
  let after = demo
  for (let i = 0; i < 12; i++) {
    await sleep(2500)
    const t = await prisma.trainerProfile.findUnique({
      where: { id: demo.id },
      select: { subscriptionStatus: true, seatCount: true, stripeSubscriptionId: true },
    })
    if (t?.stripeSubscriptionId === sub.id) {
      const addons = await prisma.trainerAddon.findMany({ where: { trainerId: demo.id, active: true }, select: { itemId: true } })
      console.log(`\n✓ Webhook reconciled (after ${(i + 1) * 2.5}s):`)
      console.log(`   subscriptionStatus : ${t.subscriptionStatus}`)
      console.log(`   seatCount          : ${t.seatCount}  (expected 2)`)
      console.log(`   stripeSubscriptionId: ${t.stripeSubscriptionId}`)
      console.log(`   active add-ons     : ${addons.map((a) => a.itemId).join(', ') || '(none)'}  (expected achievements)`)
      return
    }
    process.stdout.write('.')
  }
  console.log(`\n⚠ Timed out waiting for the webhook to set stripeSubscriptionId=${sub.id}. Check Stripe → Developers → Webhooks (test) delivery logs.`)
}

main().catch((err) => { console.error('\n', err instanceof Error ? err.message : err); process.exitCode = 1 }).finally(() => prisma.$disconnect())
