import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripeFor, isStripeConfigured } from '@/lib/stripe'

// Refund a client→trainer payment. Owner-only. Issues the Stripe refund
// (reversing the transfer so it comes out of the trainer's balance, and
// clawing back our platform fee so the trainer isn't out of pocket on it),
// records a Refund row, and lets the charge.refunded webhook reconcile the
// Payment's amountRefunded + status authoritatively.

const schema = z.object({
  // Minor units. Omit for a full refund of the remaining amount.
  amount: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
}).optional()

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  const { id } = await params

  const payment = await prisma.payment.findUnique({
    where: { id },
    select: {
      trainerId: true, status: true, sandbox: true,
      amountTotal: true, amountRefunded: true, stripePaymentIntentId: true,
    },
  })
  // Scope to the caller's own payments — no cross-trainer refunds.
  if (!payment || payment.trainerId !== trainerId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (payment.status !== 'PAID' && payment.status !== 'PARTIALLY_REFUNDED') {
    return NextResponse.json({ error: 'This payment can’t be refunded.' }, { status: 409 })
  }
  if (!payment.stripePaymentIntentId) {
    return NextResponse.json({ error: 'Payment is still settling — try again shortly.' }, { status: 409 })
  }
  if (!isStripeConfigured(payment.sandbox)) {
    return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const remaining = payment.amountTotal - payment.amountRefunded
  if (remaining <= 0) return NextResponse.json({ error: 'Already fully refunded.' }, { status: 409 })
  const amount = parsed.data?.amount ?? remaining
  if (amount > remaining) {
    return NextResponse.json({ error: 'Amount exceeds the refundable balance.' }, { status: 400 })
  }

  const refund = await stripeFor(payment.sandbox).refunds.create({
    payment_intent: payment.stripePaymentIntentId,
    amount,
    // Pull the money back from the connected account and reclaim our fee so the
    // refund is shared fairly rather than landing entirely on the platform.
    reverse_transfer: true,
    refund_application_fee: true,
  })

  await prisma.refund.create({
    data: {
      paymentId: id,
      stripeRefundId: refund.id,
      amount,
      reason: parsed.data?.reason ?? null,
      status: refund.status ?? 'pending',
    },
  })

  return NextResponse.json({ ok: true, refundId: refund.id })
}
