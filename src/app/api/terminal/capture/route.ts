import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'
import { captureCardPresentPaymentIntent } from '@/lib/terminal'
import { guardTapToPay } from '../_guard'

// Capture the tap the SDK just authorised.
//
// The split matters: `confirmPaymentIntent` on the device AUTHORISES the card
// (that is the part that has to happen on the phone, because it drives the PIN
// prompt and the NFC field), and this endpoint CAPTURES it. Until this runs the
// client's money is only held, and if the app dies mid-sale the hold expires by
// itself in about two days rather than becoming a charge for nothing.
//
// It is deliberately NOT the thing that marks the Payment paid. That still
// happens in the Connect webhook off `payment_intent.succeeded`, keyed on
// `metadata.paymentId`, exactly as it does for a QR payment — so a capture whose
// HTTP response never reaches the phone still settles correctly, and a
// double-tap on "done" cannot double-fulfil.

const bodySchema = z.object({
  paymentId: z.string().min(1),
})

export async function POST(req: Request) {
  const csrf = requireSameOrigin(req); if (csrf) return csrf
  const guard = await guardTapToPay()
  if (guard instanceof NextResponse) return guard

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  // Scoped to this trainer in the where clause — the intent id is never taken
  // from the client, only ever read off a Payment row we own. Otherwise this
  // endpoint would capture arbitrary intents on our platform.
  const payment = await prisma.payment.findFirst({
    where: { id: parsed.data.paymentId, trainerId: guard.trainerId },
    select: { id: true, stripePaymentIntentId: true, currency: true, status: true, connectAccountId: true },
  })
  if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!payment.stripePaymentIntentId) {
    return NextResponse.json({ error: 'Nothing to capture' }, { status: 409 })
  }
  // Already settled by the webhook — capturing again would 400 at Stripe. Report
  // success, because from the trainer's point of view it IS paid.
  if (payment.status === 'PAID') {
    return NextResponse.json({ ok: true, alreadyCaptured: true })
  }

  const intent = await captureCardPresentPaymentIntent({
    sandbox: guard.sandbox,
    // The account stamped on the Payment, not the trainer's current one — a
    // trainer who re-onboarded mid-sale must still capture where the money is.
    connectAccountId: payment.connectAccountId,
    paymentIntentId: payment.stripePaymentIntentId,
    currency: payment.currency,
  })

  return NextResponse.json({ ok: true, status: intent.status })
}
