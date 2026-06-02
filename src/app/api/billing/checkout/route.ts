import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe, isStripeConfigured } from '@/lib/stripe'
import { env } from '@/lib/env'
import { isCurrencyCode, isAddonId, DEFAULT_CURRENCY, type CurrencyCode } from '@/lib/pricing'
import { resolvePriceId } from '@/lib/billing'
import { isFounderEligible } from '@/lib/founder'

const TRIAL_DAYS = 10
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
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!isStripeConfigured()) {
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
    planId, currency, seatCount, addons,
    businessName, phone,
    addressLine1, addressLine2, addressCity, addressRegion, addressPostcode, addressCountry,
  } = parsed.data
  const cur = currency as CurrencyCode

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    select: { id: true, name: true, stripePriceId: true, stripePriceIdsByCurrency: true, isActive: true },
  })
  if (!plan || !plan.isActive) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  // Resolve the Core price for the chosen currency (per-currency override
  // wins; NZD column is the fallback). If neither is set we can't open
  // Checkout for the base plan.
  const corePrice = resolvePriceId(plan, cur)
  if (!corePrice) {
    return NextResponse.json({ error: 'This plan isn\'t available for purchase yet' }, { status: 409 })
  }

  // Build the rest of the line items: extra seats + selected add-ons. We
  // pull the seat + add-on BillingItems and resolve each to a Stripe price
  // in the trainer's currency. A missing price for something the trainer
  // asked for is a 409 — we never silently drop a paid line.
  const extraSeats = Math.max(0, seatCount - 1)
  const neededItemIds = [...(extraSeats > 0 ? ['seat'] : []), ...addons]
  const items = neededItemIds.length
    ? await prisma.billingItem.findMany({
        where: { id: { in: neededItemIds }, isActive: true },
        select: { id: true, kind: true, stripePriceId: true, stripePriceIdsByCurrency: true },
      })
    : []
  const itemById = new Map(items.map(i => [i.id, i]))

  const extraLineItems: { price: string; quantity: number }[] = []

  if (extraSeats > 0) {
    const seat = itemById.get('seat')
    const seatPrice = seat ? resolvePriceId(seat, cur) : null
    if (!seatPrice) {
      return NextResponse.json({ error: 'Extra trainer seats aren\'t available for purchase yet' }, { status: 409 })
    }
    extraLineItems.push({ price: seatPrice, quantity: extraSeats })
  }

  for (const addonId of addons) {
    const item = itemById.get(addonId)
    const addonPrice = item && item.kind === 'ADDON' ? resolvePriceId(item, cur) : null
    if (!addonPrice) {
      return NextResponse.json({ error: 'One of the selected add-ons isn\'t available for purchase yet' }, { status: 409 })
    }
    extraLineItems.push({ price: addonPrice, quantity: 1 })
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

  const stripeClient = stripe()

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
    addons: addons.join(','),
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
      trial_period_days: TRIAL_DAYS,
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
function countryToISO(name: string | null | undefined): string | undefined {
  if (!name) return undefined
  const v = name.trim().toLowerCase()
  const map: Record<string, string> = {
    'new zealand': 'NZ', 'nz': 'NZ', 'aotearoa': 'NZ',
    'australia': 'AU', 'au': 'AU',
    'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'gb': 'GB',
    'united states': 'US', 'us': 'US', 'usa': 'US', 'america': 'US',
    'canada': 'CA', 'ca': 'CA',
    'south africa': 'ZA', 'za': 'ZA',
    'ireland': 'IE', 'ie': 'IE',
  }
  if (map[v]) return map[v]
  // Already a 2-letter code? Pass through uppercased.
  if (/^[a-z]{2}$/.test(v)) return v.toUpperCase()
  return undefined
}
