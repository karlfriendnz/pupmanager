import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { stripe, isStripeConfigured } from '@/lib/stripe'
import { resolvePriceId, loadPriceIndex } from '@/lib/billing'
import { isCurrencyCode, currencyMeta, SEAT_PRICE, DEFAULT_CURRENCY, type CurrencyCode } from '@/lib/pricing'

// Resolve the trainer's billing currency from their Stripe subscription
// (defaults to NZD). Shared by GET (price preview) and the validation below.
async function subscriptionCurrency(subscriptionId: string | null | undefined): Promise<CurrencyCode> {
  if (!subscriptionId || !isStripeConfigured()) return DEFAULT_CURRENCY
  try {
    const sub = await stripe().subscriptions.retrieve(subscriptionId)
    const c = (sub.currency ?? '').toUpperCase()
    return isCurrencyCode(c) ? c : DEFAULT_CURRENCY
  } catch {
    return DEFAULT_CURRENCY
  }
}

// GET /api/billing/seats — the per-seat price in the trainer's billing
// currency, for the "add a seat" confirm modal. Permission-gated like POST.
export async function GET() {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!can('billing.seats', ctx.role, ctx.permissions)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { stripeSubscriptionId: true },
  })
  const cur = await subscriptionCurrency(trainer?.stripeSubscriptionId)
  const meta = currencyMeta(cur)
  return NextResponse.json({ seatPrice: SEAT_PRICE[cur], symbol: meta.symbol, currency: meta.label })
}

const schema = z.object({
  seatCount: z.number().int().min(1).max(100),
  // Re-auth: the actor confirms with their password before we charge.
  password: z.string().min(1),
})

// POST /api/billing/seats
//
// Change the number of trainer seats by updating the Stripe subscription's
// per-seat line item quantity — the ONLY way to add seats, so the team can't
// grow without paying. Charged immediately, pro-rata, to the card on file
// (proration_behavior: 'always_invoice'); the UI confirms the change first.
// A trainer with no subscription is told to subscribe. The
// customer.subscription.updated webhook reconciles seatCount afterwards (we
// also set it here so the team page updates immediately).
export async function POST(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!can('billing.seats', ctx.role, ctx.permissions)) {
    return NextResponse.json({ error: 'You don\'t have permission to add seats.' }, { status: 403 })
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Billing not configured yet' }, { status: 503 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { seatCount, password } = parsed.data

  // Re-authenticate the actor with their password before charging.
  const account = await prisma.account.findFirst({
    where: { userId: ctx.userId, provider: 'credentials' },
    select: { providerAccountId: true },
  })
  if (!account?.providerAccountId || !(await bcrypt.compare(password, account.providerAccountId))) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 })
  }

  // Never let seats drop below the trainers already on the team.
  const used = await prisma.trainerMembership.count({ where: { companyId: ctx.companyId } })
  if (seatCount < used) {
    return NextResponse.json(
      { error: `You have ${used} trainers — remove some before reducing seats below ${used}.` },
      { status: 400 },
    )
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { stripeSubscriptionId: true },
  })
  if (!trainer?.stripeSubscriptionId) {
    return NextResponse.json(
      { error: 'Subscribe to your plan to add trainer seats.', needsSubscription: true },
      { status: 409 },
    )
  }

  const stripeClient = stripe()
  const sub = await stripeClient.subscriptions.retrieve(trainer.stripeSubscriptionId)

  // Resolve the seat price in the subscription's currency.
  const currency = (sub.currency ?? DEFAULT_CURRENCY).toUpperCase()
  const cur: CurrencyCode = isCurrencyCode(currency) ? currency : DEFAULT_CURRENCY
  const seatItem = await prisma.billingItem.findUnique({
    where: { id: 'seat' },
    select: { stripePriceId: true, stripePriceIdsByCurrency: true },
  })
  const seatPrice = seatItem ? resolvePriceId(seatItem, cur) : null
  if (!seatPrice) {
    return NextResponse.json({ error: 'Extra seats aren\'t available for purchase yet.' }, { status: 409 })
  }

  // Find the existing seat line item on the subscription (if any).
  const index = await loadPriceIndex()
  const seatLine = sub.items.data.find(li => index.get(li.price.id)?.type === 'seat')
  const extraSeats = seatCount - 1 // first trainer is included in Core

  const items: Stripe.SubscriptionUpdateParams.Item[] = []
  if (extraSeats > 0) {
    items.push(seatLine ? { id: seatLine.id, quantity: extraSeats } : { price: seatPrice, quantity: extraSeats })
  } else if (seatLine) {
    items.push({ id: seatLine.id, deleted: true })
  }

  if (items.length > 0) {
    await stripeClient.subscriptions.update(sub.id, {
      items,
      // Bill the change now, pro-rated to the rest of the period. (During a
      // Stripe trial this nets to $0 until the trial ends, which is correct.)
      proration_behavior: 'always_invoice',
    })
  }

  await prisma.trainerProfile.update({ where: { id: ctx.companyId }, data: { seatCount } })

  return NextResponse.json({ ok: true, seatCount })
}
