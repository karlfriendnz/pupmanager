import type Stripe from 'stripe'
import { prisma } from './prisma'
import { stripeFor } from './stripe'
import { platformFeeBps } from './connect'

// The Stripe SUBSCRIPTION layer for client→trainer recurring payments.
//
// Everything here happens on the TRAINER'S connected account, created with the
// `stripeAccount` header — the same direct-charge model as the one-off checkout
// in connect-checkout.ts. The trainer is merchant of record; our margin rides on
// top. Nothing here touches the platform account, which is where the trainer's
// OWN subscription to PupManager lives (src/lib/billing.ts) — those Customer,
// Price and Subscription ids are meaningless here and must never be reused.
//
// Kept deliberately general (plans, prices, customers, subscriptions) rather
// than membership-specific, because puppy-school recurring billing is meant to
// share this layer — see the note at prisma/schema.prisma on Membership.
//
// The PupManager-side lifecycle (what a paid cycle GRANTS, what a cancellation
// means to a client) lives in membership-billing.ts. This module only knows
// about Stripe.

// The cycle itself — unit, count, Stripe shape, wording and date arithmetic —
// lives in the PURE module billing-interval.ts, so the trainer's plan editor and
// the client's card can import the wording without dragging prisma and the
// Stripe SDK into a browser bundle. Re-exported here because every existing
// server caller imports it from this module.
export {
  type PlanInterval,
  stripeRecurring,
  intervalLabel,
  cycleTermLabel,
  addCycles,
  editorInterval,
  isValidIntervalCount,
  maxIntervalCount,
  MAX_WEEKS_PER_CYCLE,
  MAX_MONTHS_PER_CYCLE,
} from './billing-interval'

import { stripeRecurring, type PlanInterval } from './billing-interval'

/**
 * Our margin as a PERCENT for `application_fee_percent`.
 *
 * Subscriptions do NOT accept `application_fee_amount` (the fixed-cents field
 * the one-off checkout uses), only a percentage applied to every invoice
 * forever. That is the trade we want: the alternative — setting a fee on each
 * invoice from an `invoice.created` webhook — has to win a race against Stripe
 * finalising the invoice, and its failure mode is that we silently earn nothing
 * and nobody notices for months.
 *
 * Returns null when we take nothing (a currency whose margin we haven't
 * confirmed, e.g. zar), so the caller can OMIT the field rather than send 0.
 */
export function applicationFeePercentFor(currency: string): number | null {
  const bps = platformFeeBps(currency)
  if (bps <= 0) return null
  // bps → percent, at Stripe's 2-decimal precision for this field.
  return Math.round(bps) / 100
}

/**
 * The client's Stripe Customer on this trainer's connected account, created once
 * and cached on their ClientProfile (which already IS the (userId, trainerId)
 * pair). Live and test ids are stored separately — a sandbox `cus_…` does not
 * exist in live mode.
 */
export async function ensureCustomer(args: {
  clientId: string
  connectAccountId: string
  sandbox: boolean
  email?: string | null
  name?: string | null
}): Promise<string> {
  const field = args.sandbox ? 'stripeCustomerIdTest' : 'stripeCustomerId'
  const client = await prisma.clientProfile.findUnique({
    where: { id: args.clientId },
    select: { stripeCustomerId: true, stripeCustomerIdTest: true },
  })
  const cached = args.sandbox ? client?.stripeCustomerIdTest : client?.stripeCustomerId
  if (cached) return cached

  const stripe = stripeFor(args.sandbox)
  const customer = await stripe.customers.create(
    {
      email: args.email ?? undefined,
      name: args.name ?? undefined,
      metadata: { clientProfileId: args.clientId },
    },
    {
      stripeAccount: args.connectAccountId,
      // Derived from our own id so a double-tapped Subscribe on a slow
      // connection reuses the first Customer instead of minting a second.
      idempotencyKey: `cust:${args.clientId}:${args.sandbox ? 'test' : 'live'}`,
    },
  )

  await prisma.clientProfile.update({
    where: { id: args.clientId },
    data: { [field]: customer.id },
  })
  return customer.id
}

/**
 * The Stripe Product + recurring Price for a MembershipPlan, minted lazily on
 * first sale and cached on the row.
 *
 * Stripe Prices are IMMUTABLE. A trainer editing the price OR THE CYCLE does not
 * mutate this Price — the plan editor writes a fresh row with null cached ids
 * (archiving any plan that has live subscribers), and the next sale mints a new
 * Price. Everyone already subscribed keeps billing on the Price they agreed to,
 * which is exactly what stops an edit silently re-pricing or re-cycling existing
 * clients.
 */
export async function ensurePlanPrice(args: {
  planId: string
  connectAccountId: string
  sandbox: boolean
  /** Fallback product name when the Product also has to be created. */
  productName: string
}): Promise<string> {
  const priceField = args.sandbox ? 'stripePriceIdTest' : 'stripePriceId'
  const productField = args.sandbox ? 'stripeProductIdTest' : 'stripeProductId'

  const plan = await prisma.membershipPlan.findUnique({
    where: { id: args.planId },
    select: {
      id: true, interval: true, intervalCount: true, priceCents: true,
      stripePriceId: true, stripePriceIdTest: true,
      stripeProductId: true, stripeProductIdTest: true,
      membership: { select: { trainerId: true, trainer: { select: { payoutCurrency: true } } } },
    },
  })
  if (!plan) throw new Error(`MembershipPlan ${args.planId} not found`)

  const cachedPrice = args.sandbox ? plan.stripePriceIdTest : plan.stripePriceId
  if (cachedPrice) return cachedPrice

  const currency = (plan.membership.trainer?.payoutCurrency ?? 'nzd').toLowerCase()
  const stripe = stripeFor(args.sandbox)
  const opts = { stripeAccount: args.connectAccountId }

  let productId = args.sandbox ? plan.stripeProductIdTest : plan.stripeProductId
  if (!productId) {
    const product = await stripe.products.create(
      { name: args.productName, metadata: { membershipPlanId: plan.id } },
      { ...opts, idempotencyKey: `prod:${plan.id}:${args.sandbox ? 'test' : 'live'}` },
    )
    productId = product.id
  }

  const price = await stripe.prices.create(
    {
      product: productId,
      currency,
      unit_amount: plan.priceCents,
      recurring: stripeRecurring(plan.interval as PlanInterval, plan.intervalCount),
      metadata: { membershipPlanId: plan.id },
    },
    {
      ...opts,
      // Includes the amount, the interval AND the count, so an edit to any of
      // them (which writes a fresh row with a null cache) still mints a
      // genuinely new Price rather than replaying the old request. Leaving the
      // count out would let "every 6 weeks" replay a monthly Price.
      idempotencyKey: `price:${plan.id}:${plan.priceCents}:${plan.interval}:${plan.intervalCount}:${args.sandbox ? 'test' : 'live'}`,
    },
  )

  await prisma.membershipPlan.update({
    where: { id: plan.id },
    data: { [priceField]: price.id, [productField]: productId },
  })
  return price.id
}

/**
 * A hosted Stripe Checkout Session in `mode: 'subscription'` — it collects the
 * card, records the mandate, and takes the first cycle in one step.
 *
 * BILLING DATE: Stripe's default anniversary behaviour. Someone who subscribes
 * on the 14th is billed on the 14th every cycle. We deliberately do NOT pass
 * `billing_cycle_anchor` or any proration setting, so there is no first-cycle
 * part-charge to reason about.
 */
export async function createSubscriptionCheckout(args: {
  connectAccountId: string
  sandbox: boolean
  customerId: string
  priceId: string
  /** Merged onto the Subscription, so every invoice.* webhook can resolve us. */
  subscriptionMetadata: Record<string, string>
  currency: string
  successUrl: string
  cancelUrl: string
  /** Our own id for this attempt — the outbound idempotency anchor. */
  idempotencyKey: string
}): Promise<{ id: string; url: string | null }> {
  const stripe = stripeFor(args.sandbox)
  const feePercent = applicationFeePercentFor(args.currency)

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: args.customerId,
      line_items: [{ price: args.priceId, quantity: 1 }],
      subscription_data: {
        metadata: args.subscriptionMetadata,
        // Omit entirely when we take nothing — never send 0.
        ...(feePercent != null ? { application_fee_percent: feePercent } : {}),
      },
      // Mirrored onto the Session too, so checkout.session.completed can also
      // resolve the purchase without waiting for a subscription event.
      metadata: args.subscriptionMetadata,
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
    },
    {
      stripeAccount: args.connectAccountId,
      // THE most likely double-charge bug in the whole feature: without this, a
      // client double-tapping Subscribe on a slow connection creates two
      // subscriptions and is charged twice every month, forever, until somebody
      // notices. Derived from our own purchase id, so both taps collapse to one.
      idempotencyKey: args.idempotencyKey,
    },
  )
  return { id: session.id, url: session.url }
}

/**
 * Move a live subscription onto a different plan's Price — the upgrade path.
 *
 * The existing Subscription is KEPT and its single item re-priced, rather than
 * cancelled and replaced. That matters for three reasons: the client is not
 * charged a fresh full period on the day they switch, the card and billing
 * anchor carry over untouched, and there is never a moment where two live
 * subscriptions exist for one person (the exact shape that cost a customer a
 * double charge in July).
 *
 * PRORATION. An UPGRADE invoices immediately for the balance of the period at
 * the new rate, so the better package is paid for from the moment it starts —
 * the alternative is a free run now and an unexplained larger bill next month.
 * A DOWNGRADE only writes credit lines, which land on the next invoice: taking
 * money at the moment someone chooses to pay less would be indefensible, and
 * refunding to card for a plan change they initiated is not what they asked for.
 *
 * The metadata is REPLACED, not merged, because it is what every later webhook
 * uses to work out which package a subscription belongs to. A stale membershipId
 * left behind here would attribute next month's payment to the old package.
 */
export async function switchSubscriptionPrice(args: {
  subscriptionId: string
  newPriceId: string
  connectAccountId: string
  sandbox: boolean
  /** Full replacement metadata — membershipId, planId, clientId, trainerId, consentId. */
  metadata: Record<string, string>
  /** True when the new plan costs more per period than the old one. */
  isUpgrade: boolean
  currency: string
  idempotencyKey: string
}): Promise<Stripe.Subscription> {
  const stripe = stripeFor(args.sandbox)
  const opts = { stripeAccount: args.connectAccountId }

  const sub = await stripe.subscriptions.retrieve(args.subscriptionId, {}, opts)
  const item = sub.items.data[0]
  if (!item) throw new Error(`Subscription ${args.subscriptionId} has no items to re-price`)

  const feePercent = applicationFeePercentFor(args.currency)

  return stripe.subscriptions.update(
    args.subscriptionId,
    {
      // Passing the EXISTING item id is what re-prices it. Omitting the id
      // would add a second line and bill them for both packages.
      items: [{ id: item.id, price: args.newPriceId }],
      proration_behavior: args.isUpgrade ? 'always_invoice' : 'create_prorations',
      metadata: args.metadata,
      ...(feePercent != null ? { application_fee_percent: feePercent } : {}),
    },
    {
      ...opts,
      // A double-tapped Upgrade must re-price once. Anchored on our own consent
      // id, so both taps produce the same key.
      idempotencyKey: args.idempotencyKey,
    },
  )
}

/**
 * A hosted Stripe Checkout Session in `mode: 'setup'` — it collects a new card
 * and saves it against the customer WITHOUT charging anything.
 *
 * Deliberately not the Stripe billing portal: the portal needs a per-account
 * configuration that an Express trainer has never set up, so it would fail for
 * exactly the trainers this is meant to serve. A setup-mode Checkout works on
 * any connected account with no prior configuration.
 */
export async function createCardUpdateSession(args: {
  connectAccountId: string
  sandbox: boolean
  customerId: string
  metadata: Record<string, string>
  successUrl: string
  cancelUrl: string
}): Promise<{ id: string; url: string | null }> {
  const stripe = stripeFor(args.sandbox)
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'setup',
      customer: args.customerId,
      currency: 'nzd',
      // Mirrored onto both the Session and its SetupIntent so the webhook can
      // resolve the purchase from whichever object it is holding.
      metadata: args.metadata,
      setup_intent_data: { metadata: args.metadata },
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
    },
    { stripeAccount: args.connectAccountId },
  )
  return { id: session.id, url: session.url }
}

/**
 * Ask Stripe to stop the subscription at the end of the paid-for period. They
 * keep everything they have already paid for — no pro-rata refund, which is what
 * almost every subscription does and is far easier to explain than a part-refund.
 *
 * Stripe stays the source of truth: we set the flag here and let
 * customer.subscription.updated/deleted move our row, rather than declaring the
 * row cancelled and hoping Stripe agreed.
 */
export async function cancelAtPeriodEnd(args: {
  connectAccountId: string
  sandbox: boolean
  subscriptionId: string
}): Promise<Stripe.Subscription> {
  const stripe = stripeFor(args.sandbox)
  return stripe.subscriptions.update(
    args.subscriptionId,
    { cancel_at_period_end: true },
    { stripeAccount: args.connectAccountId },
  )
}

/**
 * Stop a subscription immediately, mid-period.
 *
 * Deliberately does NOT ask Stripe to prorate a refund: mid-cycle cancellation
 * keeps the rest of the period rather than refunding it, and a trainer who wants
 * to give money back does it through the existing refund route, where it is a
 * visible, deliberate act with an audit trail.
 */
export async function cancelSubscriptionNow(args: {
  connectAccountId: string
  sandbox: boolean
  subscriptionId: string
}): Promise<Stripe.Subscription> {
  const stripe = stripeFor(args.sandbox)
  return stripe.subscriptions.cancel(
    args.subscriptionId,
    undefined,
    { stripeAccount: args.connectAccountId },
  )
}

/** Retrieve a subscription from the connected account (it does not live on ours). */
export async function retrieveSubscription(args: {
  connectAccountId: string
  sandbox: boolean
  subscriptionId: string
}): Promise<Stripe.Subscription> {
  const stripe = stripeFor(args.sandbox)
  return stripe.subscriptions.retrieve(
    args.subscriptionId,
    undefined,
    { stripeAccount: args.connectAccountId },
  )
}

// ─── Reading the Stripe objects (API version 2026-04-22.dahlia) ─────────────
// These two helpers exist because the shapes MOVED in this API version, and
// reading the old field silently yields undefined rather than failing loudly.

/**
 * The current period boundaries for a subscription.
 *
 * VERIFIED against node_modules/stripe (22.1.1, pinned 2026-04-22.dahlia):
 * `current_period_start` / `current_period_end` are NO LONGER on the
 * Subscription object — they live on each SubscriptionItem. The Subscription
 * type only mentions them as list-filter params. We sell exactly one item per
 * subscription, so the first item's period IS the subscription's period.
 */
export function periodFromSubscription(sub: Stripe.Subscription): { start: Date | null; end: Date | null } {
  const item = sub.items?.data?.[0]
  if (!item) return { start: null, end: null }
  return {
    start: item.current_period_start ? new Date(item.current_period_start * 1000) : null,
    end: item.current_period_end ? new Date(item.current_period_end * 1000) : null,
  }
}

/**
 * The subscription id an invoice belongs to.
 *
 * VERIFIED against the pinned API version: `invoice.subscription` is GONE. It is
 * now `invoice.parent.subscription_details.subscription`, and `parent` is a
 * discriminated union that can also be a quote.
 */
export function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent
  if (!parent || parent.type !== 'subscription_details') return null
  const sub = parent.subscription_details?.subscription
  if (!sub) return null
  return typeof sub === 'string' ? sub : sub.id
}

/**
 * The PaymentIntent that settled an invoice.
 *
 * VERIFIED against the pinned API version: `invoice.payment_intent` and
 * `invoice.charge` are both GONE. Payments now hang off `invoice.payments`, an
 * ApiList<InvoicePayment> that must be requested with `expand: ['payments']`;
 * each entry's `payment` is a union of payment_intent / charge / payment_record.
 */
export function paymentIntentIdFromInvoice(invoice: Stripe.Invoice): string | null {
  for (const entry of invoice.payments?.data ?? []) {
    const pi = entry.payment?.payment_intent
    if (pi) return typeof pi === 'string' ? pi : pi.id
  }
  return null
}

/**
 * Map a Stripe subscription status onto ours.
 *
 * `past_due` and `unpaid` are deliberately different: past_due means Stripe is
 * still retrying and the client KEEPS ACCESS, unpaid means Stripe has given up.
 * Nothing here revokes access early — that is the whole point of the grace
 * window, and acting on it is Phase 2's job.
 */
export function mapSubscriptionStatus(
  sub: Stripe.Subscription,
): 'ACTIVE' | 'PAST_DUE' | 'CANCELLING' | 'CANCELLED' | 'PAUSED' {
  if (sub.status === 'canceled') return 'CANCELLED'
  if (sub.status === 'unpaid') return 'CANCELLED'
  if (sub.status === 'past_due') return 'PAST_DUE'
  if (sub.status === 'paused') return 'PAUSED'
  // A live subscription that is flagged to stop at the period end is CANCELLING,
  // not CANCELLED — they still get what they paid for until the date.
  if (sub.cancel_at_period_end) return 'CANCELLING'
  return 'ACTIVE'
}
