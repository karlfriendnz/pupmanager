import type { Prisma } from '@/generated/prisma'
import { prisma } from './prisma'
import { stripeFor } from './stripe'
import { platformFeeAmount, estimateProcessingSurcharge } from './connect'

// Builds a hosted Stripe Checkout Session for a client→trainer payment as a
// *direct charge* on the trainer's connected account (created with the
// Stripe-Account header). The trainer is the merchant of record and bears
// Stripe's processing fee; PupManager's cut is the markup baked into the
// platform processing-fee pricing set in the Stripe Dashboard (Connect →
// platform pricing), so we take NO application_fee here. Reused by every
// purchasable (products, packages, sessions, class enrolments) — each just
// supplies its line(s) + intent.
//
// A PENDING Payment (+ PaymentItem rows) is written BEFORE the session so the
// webhook can resolve it by metadata.paymentId on success; nothing is fulfilled
// here — fulfilment happens when the payment actually succeeds.

export type PurchasableKind = 'PACKAGE' | 'SESSION' | 'PRODUCT' | 'CLASS_ENROLLMENT'

export interface CheckoutLine {
  kind: PurchasableKind
  /** Shown on the Stripe page + stored as the line snapshot. */
  description: string
  /** Minor units (e.g. cents). */
  unitAmount: number
  quantity?: number
  productId?: string
  /** Link to an existing assignment being settled (invoice on a ClientPackage). */
  clientPackageId?: string
  /** What to create on success, read by the webhook (e.g. { productId, quantity }). */
  intent?: Prisma.InputJsonValue
}

export interface CreatePaymentRecordInput {
  sandbox: boolean
  trainerId: string
  connectAccountId: string
  clientId: string | null
  /** ISO 4217 lower-case, the trainer's payout currency. */
  currency: string
  lines: CheckoutLine[]
  /** Denormalised summary for the trainer's earnings list. */
  description?: string
}

export interface CreateConnectCheckoutInput extends CreatePaymentRecordInput {
  successUrl: string
  cancelUrl: string
  /**
   * Extra Stripe metadata merged onto BOTH the Checkout Session and its
   * PaymentIntent (so either webhook path can read it), e.g. { invoiceId }.
   * paymentId/trainerId are always set and can't be overridden.
   */
  metadata?: Record<string, string>
}

/**
 * Write a PENDING Payment (+ PaymentItem rows) with no Stripe session yet.
 * Used both by the immediate-checkout flows (which mint a session right away)
 * and by trainer-issued invoices (which mint the session later, when the client
 * opens the pay link). Returns the Payment id.
 */
export async function createPaymentRecord(input: CreatePaymentRecordInput): Promise<string> {
  const subtotal = input.lines.reduce((sum, l) => sum + l.unitAmount * (l.quantity ?? 1), 0)

  // If the trainer opts to pass the card fee on, append a grossed-up surcharge
  // line so the client pays it and the trainer nets the full subtotal. The line
  // is inert at fulfilment (PRODUCT kind with no productId is skipped) — it only
  // exists to add the amount + show on the Stripe page. One central place here
  // means every checkout path (products, classes, self-book, booking pages,
  // invoices, pay links) inherits the behaviour.
  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: input.trainerId },
    select: { passProcessingFeeToClient: true },
  })
  const lines: CheckoutLine[] = [...input.lines]
  if (trainer?.passProcessingFeeToClient) {
    const surcharge = estimateProcessingSurcharge(subtotal, input.currency)
    if (surcharge > 0) {
      lines.push({ kind: 'PRODUCT', description: 'Card processing fee', unitAmount: surcharge, quantity: 1, intent: { surcharge: true } })
    }
  }

  const amountTotal = lines.reduce((sum, l) => sum + l.unitAmount * (l.quantity ?? 1), 0)
  const applicationFeeAmount = platformFeeAmount(amountTotal, input.currency)

  const payment = await prisma.payment.create({
    data: {
      trainerId: input.trainerId,
      clientId: input.clientId,
      connectAccountId: input.connectAccountId,
      amountTotal,
      currency: input.currency,
      applicationFeeAmount,
      sandbox: input.sandbox,
      status: 'PENDING',
      description: input.description ?? null,
      items: {
        create: lines.map(l => ({
          kind: l.kind,
          description: l.description,
          unitAmount: l.unitAmount,
          quantity: l.quantity ?? 1,
          productId: l.productId ?? null,
          clientPackageId: l.clientPackageId ?? null,
          intent: l.intent,
        })),
      },
    },
  })
  return payment.id
}

/**
 * Mint a hosted Checkout Session for an existing PENDING Payment (direct charge
 * on the trainer's connected account). Rebuilds the line items from the stored
 * PaymentItems, so the caller only needs the Payment id. Safe to call again if a
 * link is reused — it just supersedes the previous session. Returns the hosted
 * URL (or null).
 */
export async function mintCheckoutSession(
  paymentId: string,
  urls: { successUrl: string; cancelUrl: string },
  extraMetadata?: Record<string, string>,
): Promise<string | null> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { items: true },
  })
  if (!payment || payment.status !== 'PENDING') return null
  // No connected account, no charge. This is the money chokepoint now that the
  // rollout allowlist is gone: a trainer who hasn't finished Stripe onboarding
  // has no account to charge on, and we must not call Stripe without one.
  if (!payment.connectAccountId) return null

  const stripe = stripeFor(payment.sandbox)
  // The Stripe-Account header makes this a DIRECT charge on the trainer's
  // connected account: the trainer is merchant of record and pays Stripe's
  // processing fee. Our margin rides on top as application_fee_amount, which
  // Stripe transfers to the platform automatically.
  //
  // This used to be omitted, on the belief that Dashboard "platform pricing"
  // collected our cut. It doesn't: those pricing tools only apply to direct
  // charges when the PLATFORM is billed for fees (and is on IC+), which isn't
  // our setup — so we were taking 0% on every payment. The fee is computed and
  // stored on the Payment row at creation; send the same number.
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: payment.items.map(l => ({
        quantity: l.quantity,
        price_data: {
          currency: payment.currency,
          unit_amount: l.unitAmount,
          product_data: { name: l.description },
        },
      })),
      payment_intent_data: {
        // Merge extra keys (e.g. invoiceId) but never let them clobber paymentId.
        metadata: { ...extraMetadata, paymentId: payment.id },
        // 0 would be rejected by Stripe — omit the key entirely when we take
        // nothing (a currency whose margin we haven't confirmed).
        ...(payment.applicationFeeAmount > 0
          ? { application_fee_amount: payment.applicationFeeAmount }
          : {}),
      },
      client_reference_id: payment.id,
      metadata: { ...extraMetadata, paymentId: payment.id, trainerId: payment.trainerId },
      success_url: urls.successUrl,
      cancel_url: urls.cancelUrl,
    },
    { stripeAccount: payment.connectAccountId },
  )

  await prisma.payment.update({
    where: { id: payment.id },
    data: { stripeCheckoutSessionId: session.id },
  })
  return session.url
}

/** Create the Payment record AND immediately mint its checkout session. */
export async function createConnectCheckout(
  input: CreateConnectCheckoutInput,
): Promise<{ url: string | null; paymentId: string }> {
  const paymentId = await createPaymentRecord(input)
  const url = await mintCheckoutSession(paymentId, { successUrl: input.successUrl, cancelUrl: input.cancelUrl }, input.metadata)
  return { url, paymentId }
}
