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
  /** What to create on success, read by the webhook (e.g. { productId, quantity }). */
  intent?: Prisma.InputJsonValue
}

export interface CreateConnectCheckoutInput {
  sandbox: boolean
  trainerId: string
  connectAccountId: string
  clientId: string | null
  /** ISO 4217 lower-case, the trainer's payout currency. */
  currency: string
  lines: CheckoutLine[]
  /** Denormalised summary for the trainer's earnings list. */
  description?: string
  successUrl: string
  cancelUrl: string
}

export async function createConnectCheckout(
  input: CreateConnectCheckoutInput,
): Promise<{ url: string | null; paymentId: string }> {
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
          intent: l.intent,
        })),
      },
    },
  })

  const stripe = stripeFor(input.sandbox)
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: input.lines.map(l => ({
      quantity: l.quantity ?? 1,
      price_data: {
        currency: input.currency,
        unit_amount: l.unitAmount,
        product_data: { name: l.description },
      },
    })),
    payment_intent_data: {
      application_fee_amount: applicationFeeAmount,
      transfer_data: { destination: input.connectAccountId },
      // Echo the Payment id so payment_intent.succeeded can resolve it too.
      metadata: { paymentId: payment.id },
    },
    client_reference_id: payment.id,
    metadata: { paymentId: payment.id, trainerId: input.trainerId },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  })

  await prisma.payment.update({
    where: { id: payment.id },
    data: { stripeCheckoutSessionId: session.id },
  })

  return { url: session.url, paymentId: payment.id }
}
