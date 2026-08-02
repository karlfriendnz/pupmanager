import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'
import { guardTapToPay } from '../_guard'

// "This phone just connected as a card reader on this trainer's account."
//
// It exists to record ONE fact we cannot otherwise learn: that the trainer has
// accepted Apple's Tap to Pay terms. Apple's acceptance happens on Apple's own
// web page, there is no webhook back to us, and Stripe's account object does not
// expose it either — but Stripe's SDK will not connect a Tap to Pay reader until
// the terms are accepted. So a successful connection IS the acceptance,
// observed rather than claimed.
//
// It is deliberately NOT a "I've done it" button the trainer can press. A
// trainer who ticked that box without finishing Apple's flow would be told they
// were ready and would then fail at the till, in front of a customer, which is
// the exact failure this whole feature exists to avoid.
//
// Called once per successful connect. Writing the same date again is harmless
// and costs one update, so there is no read-then-write race to lose.

export async function POST(req: Request) {
  const csrf = requireSameOrigin(req); if (csrf) return csrf
  const guard = await guardTapToPay()
  if (guard instanceof NextResponse) return guard

  // Only ever the CALLER's own trainer id, taken from their session by the
  // guard. There is no account id in the body, so there is nothing to forge.
  await prisma.trainerProfile.update({
    where: { id: guard.trainerId },
    data: { tapToPayTermsAcceptedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
