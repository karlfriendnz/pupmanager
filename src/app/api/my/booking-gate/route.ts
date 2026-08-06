import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { bookingGateFor } from '@/lib/booking-gate'
import { renderUnifiedForm } from '@/lib/unified-form-render'
import { offeringVisibleWhere, offeringVisibleRelationWhere } from '@/lib/offering-visibility'

// GET /api/my/booking-gate?packageId=… | ?classRunId=…
//
// "Is there a form in the way of booking this, and what does it ask?"
//
// The booking wizard calls this the moment a client picks an offering, so it
// knows whether the step track has three steps or four before they get as far
// as picking a time. The QUESTIONS come back with it, because the same call
// then feeds FormRunner on the form step — one round trip, not two.
//
// This is a convenience for the screen and nothing more. It grants nothing: the
// booking routes resolve the gate again for themselves and refuse a booking
// whose answers don't satisfy it, so a client who never calls this, or who is
// handed a doctored response, is in exactly the same position at Confirm.
export async function GET(req: Request) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = z
    .object({ packageId: z.string().min(1).optional(), classRunId: z.string().min(1).optional() })
    .safeParse({
      packageId: url.searchParams.get('packageId') ?? undefined,
      classRunId: url.searchParams.get('classRunId') ?? undefined,
    })
  if (!parsed.success || (!parsed.data.packageId && !parsed.data.classRunId)) {
    return NextResponse.json({ error: 'Name an offering' }, { status: 400 })
  }

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { trainerId: true },
  })
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // Scoped to THIS client's trainer, and to an offering they are allowed to see
  // — the same visibility gate the lists and the booking routes apply. An id is
  // guessable, and this response carries the trainer's own form questions.
  if (parsed.data.packageId) {
    const owned = await prisma.package.findFirst({
      where: { id: parsed.data.packageId, trainerId: profile.trainerId, ...offeringVisibleWhere() },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (parsed.data.classRunId) {
    const owned = await prisma.classRun.findFirst({
      where: { id: parsed.data.classRunId, trainerId: profile.trainerId, ...offeringVisibleRelationWhere() },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const gate = await bookingGateFor({
    packageId: parsed.data.packageId ?? null,
    classRunId: parsed.data.classRunId ?? null,
  })
  if (!gate) return NextResponse.json({ form: null, linkedFields: {} })

  // Belt and braces: a step can only name one of its own trainer's forms
  // (the flow API enforces it on write), but a gate is the last place to
  // discover that has stopped being true.
  if (gate.form.trainerId !== profile.trainerId) {
    return NextResponse.json({ form: null, linkedFields: {} })
  }

  const { runnable, linkedFields } = await renderUnifiedForm(gate.form)
  return NextResponse.json({ form: runnable, linkedFields, stepId: gate.stepId })
}
