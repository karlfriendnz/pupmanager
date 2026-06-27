import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { resolvePriceId, loadPriceIndex } from '@/lib/billing'
import { stripeFor, isStripeConfigured } from '@/lib/stripe'
import { addonById, isCurrencyCode, DEFAULT_CURRENCY, type CurrencyCode } from '@/lib/pricing'

// POST /api/addons — enable/disable an add-on for the current trainer's
// business by adding/removing the matching line item on their Stripe
// subscription. The Stripe webhook then reconciles the TrainerAddon rows
// (active + stripeSubscriptionItemId); we also write `active` here so the UI
// updates instantly even before the webhook lands.
//
// Enabling an add-on is pro-rated to the trainer's next billing date
// (proration_behavior: 'create_prorations') — the prorated amount for the rest
// of the current period lands on their upcoming invoice rather than charging
// immediately; disabling credits the unused remainder.
//
// itemId is a BillingItem.id == the pricing AddonId ('achievements' | 'shop' |
// 'marketing' | …). Coming-soon previews (e.g. 'ai') are refused.
const schema = z.object({
  itemId: z.string().min(1),
  active: z.boolean(),
})

export async function POST(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Enabling an add-on commits to a recurring charge — gate on the spend perm.
  if (!can('billing.seats', ctx.role, ctx.permissions)) {
    return NextResponse.json({ error: 'You don\'t have permission to change add-ons.' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { itemId, active } = parsed.data

  // Must be a real add-on that isn't a coming-soon preview (e.g. AI).
  const def = addonById(itemId)
  if (!def || def.comingSoon) {
    return NextResponse.json({ error: 'This add-on isn\'t available yet.' }, { status: 404 })
  }

  // FREE add-ons (e.g. Timesheets) toggle with no Stripe involvement.
  if (def.free) {
    await prisma.trainerAddon.upsert({
      where: { trainerId_itemId: { trainerId: ctx.companyId, itemId } },
      create: { trainerId: ctx.companyId, itemId, active },
      update: { active },
    })
    return NextResponse.json({ ok: true, itemId, active })
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { stripeSubscriptionId: true, sandboxBilling: true },
  })
  const sandbox = trainer?.sandboxBilling ?? false

  // Sandbox/demo accounts (sandboxBilling) with no real subscription comp paid
  // add-ons: toggle directly in the DB with no Stripe, so a demo works fully
  // without billing set up. Real trainers (sandboxBilling=false) still require a
  // subscription; sandbox accounts that DID set up a test subscription fall
  // through to the normal Stripe path below.
  if (sandbox && !trainer?.stripeSubscriptionId) {
    await prisma.trainerAddon.upsert({
      where: { trainerId_itemId: { trainerId: ctx.companyId, itemId } },
      create: { trainerId: ctx.companyId, itemId, active },
      update: { active },
    })
    return NextResponse.json({ ok: true, itemId, active, comped: true })
  }

  if (!isStripeConfigured(sandbox)) {
    return NextResponse.json({ error: 'Billing not configured yet' }, { status: 503 })
  }
  if (!trainer?.stripeSubscriptionId) {
    return NextResponse.json(
      { error: 'Subscribe to your plan to add extras.', needsSubscription: true },
      { status: 409 },
    )
  }

  const stripeClient = stripeFor(sandbox)
  const sub = await stripeClient.subscriptions.retrieve(trainer.stripeSubscriptionId)
  const currency = (sub.currency ?? DEFAULT_CURRENCY).toUpperCase()
  const cur: CurrencyCode = isCurrencyCode(currency) ? currency : DEFAULT_CURRENCY

  const item = await prisma.billingItem.findUnique({
    where: { id: itemId },
    select: { stripePriceId: true, stripePriceIdsByCurrency: true, stripePriceIdTest: true, stripePriceIdsByCurrencyTest: true },
  })
  const priceId = item ? resolvePriceId(item, cur, sandbox) : null
  if (!priceId) {
    return NextResponse.json({ error: 'This add-on isn\'t available for purchase yet.' }, { status: 409 })
  }

  // Find any existing line item for THIS add-on on the subscription.
  const index = await loadPriceIndex(sandbox)
  const line = sub.items.data.find(li => {
    const c = index.get(li.price.id)
    return c?.type === 'addon' && c.id === itemId
  })

  const items: Stripe.SubscriptionUpdateParams.Item[] = []
  if (active && !line) items.push({ price: priceId, quantity: 1 })
  else if (!active && line) items.push({ id: line.id, deleted: true })

  if (items.length > 0) {
    await stripeClient.subscriptions.update(sub.id, {
      items,
      // Pro-rate to the next billing date: the prorated amount goes on the
      // upcoming invoice (no immediate charge); removing credits the remainder.
      proration_behavior: 'create_prorations',
    })
  }

  // Reflect immediately (the webhook will also reconcile + set the sub-item id).
  await prisma.trainerAddon.upsert({
    where: { trainerId_itemId: { trainerId: ctx.companyId, itemId } },
    create: { trainerId: ctx.companyId, itemId, active },
    update: { active },
  })

  return NextResponse.json({ ok: true, itemId, active })
}
