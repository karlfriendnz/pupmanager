import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe, isStripeConfigured } from '@/lib/stripe'
import { env } from '@/lib/env'

const TRIAL_DAYS = 10
const MAX_SEATS = 5

const schema = z.object({
  planId: z.string().min(1),
  seats: z.number().int().min(1).max(MAX_SEATS).default(1),
  // Business profile fields captured on /billing/setup. We persist them
  // to TrainerProfile and feed them into the Stripe Customer + Checkout
  // Session so invoices show the right address.
  businessName:    z.string().optional(),
  phone:           z.string().optional(),
  addressLine1:    z.string().optional(),
  addressLine2:    z.string().optional(),
  addressCity:     z.string().optional(),
  addressRegion:   z.string().optional(),
  addressPostcode: z.string().optional(),
  addressCountry:  z.string().optional(),
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
    planId, seats,
    businessName, phone,
    addressLine1, addressLine2, addressCity, addressRegion, addressPostcode, addressCountry,
  } = parsed.data

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    select: { id: true, name: true, stripePriceId: true, isActive: true },
  })
  if (!plan || !plan.isActive) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  if (!plan.stripePriceId) {
    return NextResponse.json({ error: 'This plan isn\'t available for purchase yet' }, { status: 409 })
  }

  // Persist anything the form gave us before talking to Stripe — that
  // way an interrupted Checkout still leaves the trainer's record
  // up-to-date and the next attempt pre-fills correctly.
  const profileUpdate = {
    seatCount: seats,
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

  const checkout = await stripeClient.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: plan.stripePriceId, quantity: seats }],
    // We've already gathered the address — let Stripe trust it without
    // re-prompting. Falls back to "auto" if line1 is missing so we
    // still get a billing address either way.
    billing_address_collection: stripeAddress ? 'auto' : 'required',
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata: { trainerId, planId: plan.id, seats: String(seats) },
    },
    metadata: { trainerId, planId: plan.id, seats: String(seats) },
    success_url: `${env.NEXT_PUBLIC_APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/billing/cancel`,
    allow_promotion_codes: true,
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
