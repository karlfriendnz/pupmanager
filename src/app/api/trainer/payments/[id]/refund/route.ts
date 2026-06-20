import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripeFor, isStripeConfigured } from '@/lib/stripe'
import { enforceRateLimit } from '@/lib/rate-limit'
import { requireSameOrigin } from '@/lib/csrf'
import { recordAudit, auditRequestMeta } from '@/lib/audit'

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
  const csrf = requireSameOrigin(req); if (csrf) return csrf
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  const { id } = await params

  const limited = await enforceRateLimit({ key: `refund:${trainerId}`, limit: 20, windowMs: 10 * 60_000 })
  if (limited) return limited

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

  // Atomically claim the refund headroom BEFORE calling Stripe so two concurrent
  // requests can't both pass a stale "remaining" check and over-refund. Only one
  // updateMany whose guard still holds will win; the loser gets a 409.
  const claim = await prisma.payment.updateMany({
    where: { id, amountRefunded: { lte: payment.amountTotal - amount } },
    data: { amountRefunded: { increment: amount } },
  })
  if (claim.count === 0) {
    return NextResponse.json({ error: 'A refund is already in progress for this payment.' }, { status: 409 })
  }

  let refund
  try {
    refund = await stripeFor(payment.sandbox).refunds.create(
      {
        payment_intent: payment.stripePaymentIntentId,
        amount,
        // Pull the money back from the connected account and reclaim our fee so
        // the refund is shared fairly rather than landing entirely on us.
        reverse_transfer: true,
        refund_application_fee: true,
      },
      // Dedupe a double-submit of the same refund state at Stripe too.
      { idempotencyKey: `refund:${id}:${payment.amountRefunded}:${amount}` },
    )
  } catch (err) {
    // Stripe rejected it — release the headroom we provisionally claimed.
    await prisma.payment.update({ where: { id }, data: { amountRefunded: { decrement: amount } } })
    console.error('[refund] stripe refund failed', id, err)
    return NextResponse.json({ error: 'Refund failed — nothing was charged back.' }, { status: 502 })
  }

  await prisma.refund.create({
    data: {
      paymentId: id,
      stripeRefundId: refund.id,
      amount,
      reason: parsed.data?.reason ?? null,
      status: refund.status ?? 'pending',
    },
  })
  // The charge.refunded webhook reconciles amountRefunded + status to Stripe's
  // authoritative total; our provisional increment just held the lock.

  await recordAudit({
    action: 'BILLING_CHANGED',
    companyId: trainerId,
    actorUserId: session.user.id,
    targetType: 'payment',
    targetId: id,
    meta: { refundId: refund.id, amount },
    ...auditRequestMeta(req),
  })
  return NextResponse.json({ ok: true, refundId: refund.id })
}
