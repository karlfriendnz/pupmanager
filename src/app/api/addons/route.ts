import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { resolvePriceId, loadPriceIndex } from '@/lib/billing'
import { stripeFor, isStripeConfigured } from '@/lib/stripe'
import { ADDONS, addonById, isCurrencyCode, DEFAULT_CURRENCY, type CurrencyCode } from '@/lib/pricing'
import type { AddonDef } from '@/lib/pricing'

// TrainerAddon.itemId is an FK to BillingItem.id, so enabling an add-on whose
// BillingItem row was never seeded in this environment 500s on a FK violation.
// Historically that meant re-running scripts/backfill-addon-billing-items.ts by
// hand every time a new add-on shipped. Instead, self-heal: ensure the row
// exists (from the catalog) before we touch TrainerAddon. Idempotent; `update:{}`
// leaves an existing row's Stripe price wiring untouched.
async function ensureBillingItem(def: AddonDef): Promise<void> {
  await prisma.billingItem.upsert({
    where: { id: def.id },
    create: {
      id: def.id,
      kind: 'ADDON',
      name: def.name,
      description: def.description,
      priceMonthly: def.price.NZD,
      sortOrder: ADDONS.findIndex(a => a.id === def.id) + 1,
    },
    update: {},
  })
}

// POST /api/addons — enable/disable an add-on for the current trainer's
// business by adding/removing the matching line item on their Stripe
// subscription. The Stripe webhook then reconciles the TrainerAddon rows
// (active + stripeSubscriptionItemId); we also write `active` here so the UI
// updates instantly even before the webhook lands.
//
// A trainer still inside their FREE TRIAL has no subscription to add a line item
// to — they take a local-only path (see below) that switches the feature on now
// and leaves the charge to /api/billing/checkout when they subscribe.
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
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { itemId, active } = parsed.data

  // Must be a real add-on that isn't a coming-soon preview (e.g. AI).
  const def = addonById(itemId)
  if (!def || def.comingSoon) {
    return NextResponse.json({ error: 'This add-on isn\'t available yet.' }, { status: 404 })
  }

  // The permission depends on what's being toggled, so it's checked AFTER we know
  // which add-on this is. A paid one commits to a recurring charge — that needs the
  // spend permission. A FREE one costs nothing and is just a feature switch on the
  // Configure page, so requiring "add paid team seats" to flip it locked managers
  // out of turning on things the business already owns.
  const permission = def.free ? 'settings.edit' : 'billing.seats'
  if (!can(permission, ctx.role, ctx.permissions)) {
    return NextResponse.json({ error: 'You don\'t have permission to change this.' }, { status: 403 })
  }

  // Guarantee the BillingItem the TrainerAddon FK points at exists in this env.
  await ensureBillingItem(def)

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
    select: { stripeSubscriptionId: true, sandboxBilling: true, trialEndsAt: true },
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

  // ── Still on the free trial, no subscription yet? Switch it on locally. ──
  //
  // A trialist has no Stripe subscription to hang a line item off, and this used
  // to be a dead end: "Subscribe to your plan to add extras." — i.e. the only way
  // to try a paid extra was to end your own trial and start paying. Karl's call:
  // "people can turn this on — not on by default — but they can turn it on, and
  // then they get invoiced when the trial is up."
  //
  // So write the TrainerAddon row active with NO Stripe call. hasAddon() gates on
  // that row, so the feature works immediately, and /api/billing/checkout carries
  // whatever is still switched on into the subscription it creates — which keeps
  // the trainer's remaining trial days, so the first charge lands when the trial
  // ends, not now.
  //
  // stripeSubscriptionItemId stays NULL deliberately. That is what marks the row
  // as "on, but not a billed line item yet": the Stripe webhook's reconciliation
  // sweep only deactivates rows that DO have one, so a locally-activated row is
  // left alone until checkout puts it on a real subscription — at which point the
  // webhook updates this same row (unique on trainerId+itemId) rather than adding
  // a second one.
  //
  // An EXPIRED trial with no subscription is NOT this case — they get the old
  // error. Otherwise "turn it on during the trial" would quietly become "paid
  // extras are free forever if you never subscribe".
  const inTrial = (trainer?.trialEndsAt?.getTime() ?? 0) > Date.now()
  if (!trainer?.stripeSubscriptionId && inTrial) {
    await prisma.trainerAddon.upsert({
      where: { trainerId_itemId: { trainerId: ctx.companyId, itemId } },
      create: { trainerId: ctx.companyId, itemId, active },
      update: { active },
    })
    return NextResponse.json({ ok: true, itemId, active, billsAtTrialEnd: true })
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

  // The stored id is not proof the subscription is still alive. It is written
  // by the billing webhook from whatever subscription it last saw, so it can
  // name one that has since been cancelled — and adding a paid add-on to a dead
  // subscription bills nobody while switching the feature on, or fails in a way
  // the trainer reads as "the button is broken".
  if (!['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)) {
    console.warn(
      `[addons] trainer ${ctx.companyId} has stripeSubscriptionId ${sub.id} but it is ${sub.status}`,
    )
    return NextResponse.json(
      { error: 'Your subscription is not active, so extras cannot be changed. Check Billing.', needsSubscription: true },
      { status: 409 },
    )
  }

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
