import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { bookingGateFor, gateRefusal, pickGateAnswers, type GateAnswers } from '@/lib/booking-gate'
import { liveHold, releaseBookingHold, saveHoldAnswers } from '@/lib/booking-holds'

// PATCH  /api/my/booking-hold/[holdId] — save the answers that open the gate.
// DELETE /api/my/booking-hold/[holdId] — give the slot back.
//
// The answers are stored the moment the FORM STEP is finished, not when the
// payment succeeds. Somebody whose card is declined has just typed five things,
// and sending them back to an empty form is the worst version of this; the
// retry, and the Stripe webhook, read them straight back off the hold.
//
// Conversely an abandoned booking must not leave a completed answer set lying
// about that satisfies a later gate. It cannot: these answers live on the HOLD,
// which expires and is swept, and nothing reads a hold's answers except the
// booking that consumes it. A BookingFormAnswer — the durable record — is only
// ever written at the moment a real session/enrolment/request exists.

const patchSchema = z.object({
  answers: z.record(
    z.string(),
    z.union([z.string().max(4000), z.array(z.string().max(2000)).max(50)]),
  ),
})

async function ownHold(holdId: string, clientId: string) {
  return prisma.bookingHold.findFirst({
    where: { id: holdId, clientId },
    select: { id: true, packageId: true, trainerId: true },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ holdId: string }> }) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — booking disabled' }, { status: 403 })

  const { holdId } = await params
  // Scoped to the caller's own hold. Somebody else's is not theirs to answer:
  // a gate another person could open on your behalf is not a gate.
  const own = await ownHold(holdId, active.clientId)
  if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid answers' }, { status: 400 })

  // Expiry is read here, not swept. A hold that lapsed while they were typing is
  // already gone as far as everybody else is concerned, so saying so now — with
  // a code the wizard turns into "that time went, pick another" — is the honest
  // answer, and far better than accepting the answers and refusing at Confirm.
  const live = await liveHold(holdId)
  if (!live) return NextResponse.json({ error: 'That time is no longer held.', code: 'HOLD_EXPIRED' }, { status: 409 })

  const gate = await bookingGateFor({ packageId: own.packageId })
  if (!gate) {
    // Nothing to answer. Not an error — a trainer can switch the gate off while
    // somebody is mid-booking, and that should let them straight through.
    return NextResponse.json({ ok: true, gated: false })
  }

  const answers = pickGateAnswers(gate, parsed.data.answers as GateAnswers)
  const refusal = gateRefusal(gate, answers)
  if (refusal) return NextResponse.json(refusal, { status: 400 })

  await saveHoldAnswers(holdId, answers)
  return NextResponse.json({ ok: true, gated: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ holdId: string }> }) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { holdId } = await params
  // Deliberately idempotent and quiet: this is called when somebody taps Back,
  // and a "no such hold" error on the way back to the time picker helps nobody.
  await releaseBookingHold(holdId, active.clientId)
  return NextResponse.json({ ok: true })
}
