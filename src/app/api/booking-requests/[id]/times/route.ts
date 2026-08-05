import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveNegotiationActor } from '@/lib/booking-negotiation-actor'
import { defaultProposalMessage } from '@/lib/booking-negotiation'
import { getTrainerAvailabilityById } from '@/lib/client-availability'
import {
  bookableStartTimes,
  packageBookingWindow,
  ANY_TIME_WINDOW,
} from '@/lib/package-booking-window'

// GET /api/booking-requests/[id]/times?date=YYYY-MM-DD
//
// The start times either party may suggest on one day, computed SERVER-side by
// the same helper the propose route gates with. One source of truth: the picker
// cannot offer an hour the route would then refuse, which is the failure
// lib/package-booking-window exists to prevent (AGENTS.md #3 — the screen is
// never the guarantee, so it must at least not disagree with the one that is).
//
// The two parties see different lists, matching the two gates:
//   • CLIENT — the offering's own window, exactly as the self-book picker;
//   • TRAINER — their whole published availability, because a trainer may
//     knowingly offer a client an hour outside the offering's usual window.
// Both lists have the trainer's existing bookings and blackouts already
// subtracted, so neither can suggest a double-booking.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actorResult = await resolveNegotiationActor(id)
  if (!actorResult.ok) {
    return NextResponse.json({ error: actorResult.error }, { status: actorResult.status })
  }
  const { actor } = actorResult

  const dateStr = new URL(req.url).searchParams.get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 })
  }

  const request = await prisma.bookingRequest.findUnique({
    where: { id },
    select: {
      trainerId: true,
      package: {
        select: {
          name: true, durationMins: true, bufferMins: true, sessionCount: true,
          weeksBetween: true, bookingWindowMode: true, bookingWindowRanges: true,
          bookingWindowDates: true, bookingWindowTimes: true, bookingWindowDays: true,
          bookingWindowStart: true, bookingWindowEnd: true,
        },
      },
    },
  })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const avail = await getTrainerAvailabilityById(request.trainerId)
  if (!avail) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const times = bookableStartTimes({
    slots: avail.slots,
    blackouts: avail.blackouts,
    busy: avail.busy,
    dateStr,
    durationMins: request.package.durationMins,
    bufferMins: request.package.bufferMins,
    window: actor.party === 'CLIENT' ? packageBookingWindow(request.package) : ANY_TIME_WINDOW,
  })

  return NextResponse.json({
    tz: avail.tz,
    times,
    packageName: request.package.name,
    sessionCount: request.package.sessionCount,
    weeksBetween: request.package.weeksBetween,
    durationMins: request.package.durationMins,
    // The composer's pre-filled note. Copy lives on the server so there is one
    // place to change it when Karl signs the wording off.
    defaultMessage: defaultProposalMessage(actor.party),
    party: actor.party,
  })
}
