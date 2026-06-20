import type { Prisma } from '@/generated/prisma'
import { prisma } from './prisma'
import { stripeFor } from './stripe'
import { platformFeeAmount } from './connect'

// Builds a hosted Stripe Checkout Session for a client→trainer payment as a
// *destination charge* (the charge sits on the platform account; net funds
// transfer to the trainer's connected account, our application fee is taken
// atomically). Reused by every purchasable (products now; packages, sessions,
// class enrolments in later phases) — each just supplies its line(s) + intent.
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
}

/**
 * Write a PENDING Payment (+ PaymentItem rows) with no Stripe session yet.
 * Used both by the immediate-checkout flows (which mint a session right away)
 * and by trainer-issued invoices (which mint the session later, when the client
 * opens the pay link). Returns the Payment id.
 */
export async function createPaymentRecord(input: CreatePaymentRecordInput): Promise<string> {
  const amountTotal = input.lines.reduce((sum, l) => sum + l.unitAmount * (l.quantity ?? 1), 0)
  const applicationFeeAmount = platformFeeAmount(amountTotal)

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
        create: input.lines.map(l => ({
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
 * Mint a hosted Checkout Session for an existing PENDING Payment (destination
 * charge). Rebuilds the line items from the stored PaymentItems, so the caller
 * only needs the Payment id. Safe to call again if a link is reused — it just
 * supersedes the previous session. Returns the hosted URL (or null).
 */
export async function mintCheckoutSession(
  paymentId: string,
  urls: { successUrl: string; cancelUrl: string },
): Promise<string | null> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { items: true },
  })
  if (!payment || payment.status !== 'PENDING') return null

  const stripe = stripeFor(payment.sandbox)
  const session = await stripe.checkout.sessions.create({
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
      application_fee_amount: payment.applicationFeeAmount,
      transfer_data: { destination: payment.connectAccountId },
      metadata: { paymentId: payment.id },
    },
    client_reference_id: payment.id,
    metadata: { paymentId: payment.id, trainerId: payment.trainerId },
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
  })

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
  const url = await mintCheckoutSession(paymentId, { successUrl: input.successUrl, cancelUrl: input.cancelUrl })
  return { url, paymentId }
}
