import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { requireSameOrigin } from '@/lib/csrf'
import { prisma } from '@/lib/prisma'
import { stripeFor, isStripeConfigured } from '@/lib/stripe'
import { env } from '@/lib/env'
import { isCurrencyCode, isAddonId, DEFAULT_CURRENCY, type CurrencyCode } from '@/lib/pricing'
import { resolvePriceId, getUnbilledPaidAddons } from '@/lib/billing'
import { isFounderEligible } from '@/lib/founder'
import { countryToISO } from '@/lib/country'

const MAX_SEATS = 50

const schema = z.object({
  planId: z.string().min(1),
  // Currency the trainer picked on /billing/setup. The server uses it
  // to look up the matching Stripe Price ID; if no per-currency price
  // is wired up we fall back to the legacy stripePriceId column
  // (treated as NZD) and let the trainer know they were billed in NZD.
  currency: z.string().refine(isCurrencyCode, 'Invalid currency').default(DEFAULT_CURRENCY),
  // Total number of trainers (seats). The first is included in Core; any
  // beyond that bill at the per-seat price. Clamped server-side.
  seatCount: z.coerce.number().int().min(1).max(MAX_SEATS).default(1),
  // Add-on ids the trainer switched on (subset of ADDONS). Unknown ids
  // are rejected so we never try to bill for something that isn't sold.
  addons: z.array(z.string().refine(isAddonId, 'Unknown add-on')).default([]),
  // Business profile fields captured on /billing/setup. We persist them
  // to TrainerProfile and feed them into the Stripe Customer + Checkout
  // Session so invoices show the right address. Phone, city and
  // country are required (everything else may be left blank — line2 +
  // region are genuinely optional, line1 + postcode are still
  // required at the form layer for completeness).
  businessName:    z.string().optional(),
  phone:           z.string().min(4,   'Phone number is required'),
  addressLine1:    z.string().optional(),
  addressLine2:    z.string().optional(),
  addressCity:     z.string().min(1,   'City is required'),
  addressRegion:   z.string().optional(),
  addressPostcode: z.string().optional(),
  addressCountry:  z.string().min(2,   'Country is required'),
})

// POST /api/billing/checkout
//
// Persists the trainer's business address + seat count, then opens a
// Stripe Checkout Session in subscription mode with `quantity = seats`
// and `trial_period_days = 10`. The browser receives `{ url }` and
// hands off via openExternal so iOS users land in Safari (Apple's
// anti-steering rules tolerate B2B web checkout) and web users
// navigate in-tab.
export async function POST(req: Request) {
  const csrf = requireSameOrigin(req); if (csrf) return csrf
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Starting a subscription commits the business to a recurring charge and
  // writes billing profile fields — gate on the billing spend permission
  // (OWNER by default) so a restricted member can't open checkout or mutate
  // the business's billing details. Mirrors /api/billing/seats + /api/addons.
  const ctx = await getTrainerContext()
  if (!ctx || !can('billing.seats', ctx.role, ctx.permissions)) {
    return NextResponse.json({ error: 'Only owners can manage billing.' }, { status: 403 })
  }

  // Sandbox trainers (the demo) bill against Stripe test mode end-to-end —
  // test key + the test price columns.
  const trainerMode = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { sandboxBilling: true, demoSessionId: true },
  })
  // A trade-show sandbox does not buy anything. Test mode already means no
  // money could move, but a stranger at a stand must not reach a card form at
  // all — it looks like we are asking them to pay to keep playing. Refused
  // here, on the server, rather than by hiding the button (AGENTS.md #5).
  if (trainerMode?.demoSessionId) {
    return NextResponse.json(
      { error: 'This is a demo workspace, so there is nothing to subscribe to.' },
      { status: 403 },
    )
  }
  const sandbox = trainerMode?.sandboxBilling ?? false

  if (!isStripeConfigured(sandbox)) {
    return NextResponse.json({ error: 'Billing not configured yet' }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const flat = parsed.error.flatten()
    const message = Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0] ?? 'Invalid payload'
    return NextResponse.json({ error: message }, { status: 400 })
  }
  const {
    planId, currency, seatCount, addons: requestedAddons,
    businessName, phone,
    addressLine1, addressLine2, addressCity, addressRegion, addressPostcode, addressCountry,
  } = parsed.data
  const cur = currency as CurrencyCode

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    select: { id: true, name: true, stripePriceId: true, stripePriceIdsByCurrency: true, stripePriceIdTest: true, stripePriceIdsByCurrencyTest: true, isActive: true },
  })
  if (!plan || !plan.isActive) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  // Resolve the Core price for the chosen currency + mode (per-currency
  // override wins; NZD column is the fallback). If neither is set we can't
  // open Checkout for the base plan.
  const corePrice = resolvePriceId(plan, cur, sandbox)
  if (!corePrice) {
    return NextResponse.json({ error: 'This plan isn\'t available for purchase yet' }, { status: 409 })
  }

  // ── Add-ons already switched on during the trial come with them. ──
  //
  // A trainer on a free trial can switch a paid add-on on without a subscription
  // (see /api/addons) — the row is written active with no Stripe line item. If
  // checkout only billed what this request happened to tick, the add-on they have
  // been using all trial would land on the subscription nowhere and quietly stay
  // free forever. So the real charge set is: what they ticked here, UNION what is
  // already on and unbilled.
  //
  // Anything they switched OFF before converting is already `active: false` and
  // so isn't in that set — turning it off in Add-ons is how you avoid the charge.
  //
  // A Set, not a concat: the same add-on can be both ticked here and already on,
  // and Stripe will happily put the same price on a subscription twice and bill
  // for both. Deduping is the whole guard against that. It also swallows a client
  // that sends the same id twice.
  const carriedAddons = await getUnbilledPaidAddons(trainerId)
  const addons = [...new Set([...requestedAddons, ...carriedAddons])]
  // Ticked in THIS request → a missing price is a hard 409 (below); carried over
  // from the trial → we'd rather let them subscribe than block checkout on wiring
  // they never asked about, so it's skipped with a shout in the log.
  const explicitlyRequested = new Set<string>(requestedAddons)

  // Build the rest of the line items: extra seats + selected add-ons. We
  // pull the seat + add-on BillingItems and resolve each to a Stripe price
  // in the trainer's currency. A missing price for something the trainer
  // asked for is a 409 — we never silently drop a paid line.
  const extraSeats = Math.max(0, seatCount - 1)
  const neededItemIds = [...(extraSeats > 0 ? ['seat'] : []), ...addons]
  const items = neededItemIds.length
    ? await prisma.billingItem.findMany({
        where: { id: { in: neededItemIds }, isActive: true },
        select: { id: true, kind: true, stripePriceId: true, stripePriceIdsByCurrency: true, stripePriceIdTest: true, stripePriceIdsByCurrencyTest: true },
      })
    : []
  const itemById = new Map(items.map(i => [i.id, i]))

  const extraLineItems: { price: string; quantity: number }[] = []

  if (extraSeats > 0) {
    const seat = itemById.get('seat')
    const seatPrice = seat ? resolvePriceId(seat, cur, sandbox) : null
    if (!seatPrice) {
      return NextResponse.json({ error: 'Extra team seats aren\'t available for purchase yet' }, { status: 409 })
    }
    extraLineItems.push({ price: seatPrice, quantity: extraSeats })
  }

  const billedAddons: string[] = []
  for (const addonId of addons) {
    const item = itemById.get(addonId)
    const addonPrice = item && item.kind === 'ADDON' ? resolvePriceId(item, cur, sandbox) : null
    if (!addonPrice) {
      if (!explicitlyRequested.has(addonId)) {
        // Carried over from the trial with no price wired for this currency.
        // Blocking would stop the trainer subscribing at all over an add-on they
        // didn't choose on this screen, so it stays on (unbilled) and we log it.
        console.warn(
          `[billing/checkout] trainer ${trainerId} has "${addonId}" on from their trial but no ` +
          `${cur} price is wired — subscribing without it, so it stays free until that's fixed.`,
        )
        continue
      }
      return NextResponse.json({ error: 'One of the selected add-ons isn\'t available for purchase yet' }, { status: 409 })
    }
    extraLineItems.push({ price: addonPrice, quantity: 1 })
    billedAddons.push(addonId)
  }

  // Persist anything the form gave us before talking to Stripe — that
  // way an interrupted Checkout still leaves the trainer's record
  // up-to-date and the next attempt pre-fills correctly. Add-on state is
  // NOT written here: the webhook reconciles it from the real Stripe
  // subscription so an abandoned checkout never flips a trainer's add-ons.
  const profileUpdate = {
    seatCount,
    ...(businessName    ? { businessName } : {}),
    ...(phone           ? { phone } : {}),
    ...(addressLine1    ? { addressLine1 } : {}),
    ...(addressLine2 !== undefined ? { addressLine2: addressLine2 || null } : {}),
    ...(addressCity     ? { addressCity } : {}),
    ...(addressRegion !== undefined ? { addressRegion: addressRegion || null } : {}),
    ...(addressPostcode ? { addressPostcode } : {}),
    ...(addressCountry  ? { addressCountry } : {}),
  }
  const trainer = await prisma.trainerProfile.update({
    where: { id: trainerId },
    data: profileUpdate,
    select: {
      stripeCustomerId: true,
      isFounder: true,
      trialEndsAt: true,
      businessName: true,
      phone: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressRegion: true,
      addressPostcode: true,
      addressCountry: true,
      user: { select: { email: true, name: true } },
    },
  })

  // Only carry the trainer's *remaining* free trial into the subscription —
  // never grant a fresh window. If their trial has already ended (or they
  // never had one), there's no trial and the first invoice is charged today.
  const trialMsLeft = trainer.trialEndsAt ? trainer.trialEndsAt.getTime() - Date.now() : 0
  const trialDaysLeft = trialMsLeft > 0 ? Math.ceil(trialMsLeft / (24 * 60 * 60 * 1000)) : 0

  const stripeClient = stripeFor(sandbox)

  // ── Already subscribed? Then this is a SECOND subscription, not a signup. ──
  //
  // Stripe opens as many subscriptions on one customer as it is asked to, and
  // nothing here used to check. A trainer who reached this route twice — a
  // stale tab, a back button, a "did that actually work?" second attempt —
  // ended up paying twice over, every month, for the same thing. Mersea Mutts
  // ran two live subscriptions from 21 and 25 July before anyone noticed.
  //
  // Asked of STRIPE, not of our own row, deliberately: `stripeSubscriptionId`
  // is overwritten by the billing webhook with whatever subscription it last
  // saw, so a duplicate is exactly the case our own data cannot see. The extra
  // round trip is on a path that is about to redirect to Stripe anyway.
  if (trainer.stripeCustomerId) {
    const existing = await stripeClient.subscriptions.list({
      customer: trainer.stripeCustomerId,
      status: 'all',
      limit: 20,
    })
    const live = existing.data.filter(s =>
      ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status),
    )
    if (live.length > 0) {
      console.warn(
        `[billing/checkout] refused a second subscription for trainer ${trainerId} — ` +
        `${live.length} already live (${live.map(s => s.id).join(', ')})`,
      )
      return NextResponse.json(
        {
          error: 'You already have an active subscription. Manage it from Billing rather than starting a new one.',
          subscriptionId: live[0].id,
        },
        { status: 409 },
      )
    }
  }

  // Stripe address shape — only meaningful if line1 is set. Stripe needs
  // a country code; we accept the country name from the form, so prefer
  // the alpha-2 code if the trainer typed one (NZ/AU/etc.) and otherwise
  // pass the long form through (Stripe will normalise).
  const stripeAddress = trainer.addressLine1
    ? {
        line1: trainer.addressLine1,
        line2: trainer.addressLine2 ?? undefined,
        city: trainer.addressCity ?? undefined,
        state: trainer.addressRegion ?? undefined,
        postal_code: trainer.addressPostcode ?? undefined,
        country: countryToISO(trainer.addressCountry),
      }
    : undefined

  // Lazily create + persist the Stripe Customer the first time this
  // trainer hits Checkout. Update on subsequent calls so address /
  // phone changes flow through to the customer record.
  let customerId = trainer.stripeCustomerId
  if (!customerId) {
    const customer = await stripeClient.customers.create({
      email: trainer.user.email ?? undefined,
      name: trainer.businessName ?? trainer.user.name ?? undefined,
      phone: trainer.phone ?? undefined,
      address: stripeAddress,
      metadata: { trainerId },
    })
    customerId = customer.id
    await prisma.trainerProfile.update({
      where: { id: trainerId },
      data: { stripeCustomerId: customerId },
    })
  } else {
    await stripeClient.customers.update(customerId, {
      name: trainer.businessName ?? trainer.user.name ?? undefined,
      phone: trainer.phone ?? undefined,
      ...(stripeAddress ? { address: stripeAddress } : {}),
    })
  }

  // Founders Circle: server-authoritative — the client never gets to
  // ask for the founder rate. Eligible when the coupon is wired, this
  // trainer hasn't already claimed a seat, and seats remain. We do NOT
  // stamp isFounder here: the webhook does it on checkout completion so
  // an abandoned checkout never burns a seat (see lib/founder.ts).
  const founder = await isFounderEligible(trainer.isFounder)
  const founderFlag = founder ? 'true' : 'false'

  // Core first, then extra seats + add-ons. The webhook classifies each
  // line back to core / seat / add-on by price ID, so order doesn't matter
  // for correctness — Core leads only for tidy invoices.
  const lineItems = [{ price: corePrice, quantity: 1 }, ...extraLineItems]

  // Carry the selection in metadata for debugging/fallback; the webhook
  // treats the actual subscription items as authoritative.
  const billingMeta = {
    trainerId,
    planId: plan.id,
    currency,
    founder: founderFlag,
    seatCount: String(seatCount),
    addons: billedAddons.join(','),
    sandbox: String(sandbox),
  }

  const checkout = await stripeClient.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: lineItems,
    // We've already gathered the address — let Stripe trust it without
    // re-prompting. Falls back to "auto" if line1 is missing so we
    // still get a billing address either way.
    billing_address_collection: stripeAddress ? 'auto' : 'required',
    subscription_data: {
      // Continue only the days left on their free trial; expired/none → bill now.
      ...(trialDaysLeft > 0 ? { trial_period_days: trialDaysLeft } : {}),
      metadata: billingMeta,
    },
    metadata: billingMeta,
    success_url: `${env.NEXT_PUBLIC_APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/billing/cancel`,
    // Stripe Checkout rejects `discounts` together with
    // `allow_promotion_codes`. Founders get the coupon applied silently
    // (12-month repeating discount, auto-reverts after); everyone else
    // keeps the open promo-code box exactly as before.
    ...(founder && env.STRIPE_FOUNDER_COUPON_ID
      ? { discounts: [{ coupon: env.STRIPE_FOUNDER_COUPON_ID }] }
      : { allow_promotion_codes: true }),
  })

  if (!checkout.url) {
    return NextResponse.json({ error: 'Stripe did not return a checkout URL' }, { status: 502 })
  }

  return NextResponse.json({ url: checkout.url })
}

// Map a free-text country name to its ISO 3166-1 alpha-2 code. Stripe
// accepts the alpha-2; for anything we don't recognise we let it
// through as-is (Stripe will reject obvious nonsense). Cheap lookup —
// add aliases as we see real data.
