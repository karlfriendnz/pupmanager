import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveNegotiationActor } from '@/lib/booking-negotiation-actor'
import {
  proposalSessionDates,
  firstCollision,
  describeProposal,
  defaultProposalMessage,
} from '@/lib/booking-negotiation'
import { getTrainerAvailabilityById } from '@/lib/client-availability'
import { checkBookableStart, packageBookingWindow } from '@/lib/package-booking-window'
import { utcToZonedDateAndMinutes } from '@/lib/timezone'
import { notifyMessageRecipient } from '@/lib/notify-message-recipient'

// POST /api/booking-requests/[id]/propose — counter-offer a different time.
//
// Either side may call it, any number of times: the trainer says "not that
// hour, how about this one", the client answers with one of their own, and it
// volleys until somebody approves. Nothing is booked here — the request stays
// PENDING and only an approval books.
//
// The proposal is created as a MESSAGE in the existing client↔trainer thread
// (see lib/booking-negotiation), which is what makes the negotiation read as
// one conversation and what gets the other party notified through the notifier
// that already exists rather than a second one.
const schema = z.object({
  /** Proposed start of the FIRST session. The rest of the series is derived. */
  startIso: z.string().min(1),
  /** The note that goes with it. Blank falls back to the party's default. */
  message: z.string().max(2000).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actorResult = await resolveNegotiationActor(id)
  if (!actorResult.ok) {
    return NextResponse.json({ error: actorResult.error }, { status: actorResult.status })
  }
  const { actor } = actorResult
  // A trainer previewing the client app must never speak as the client.
  if (actor.isPreview) {
    return NextResponse.json({ error: 'Preview mode — booking disabled' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const request = await prisma.bookingRequest.findFirst({
    where: { id, status: 'PENDING' },
    include: {
      package: {
        select: {
          name: true, sessionCount: true, weeksBetween: true, durationMins: true,
          bufferMins: true, bookingWindowMode: true, bookingWindowRanges: true,
          bookingWindowDates: true, bookingWindowTimes: true, bookingWindowDays: true,
          bookingWindowStart: true, bookingWindowEnd: true,
        },
      },
    },
  })
  // Already confirmed or declined — the conversation is over, and a new offer
  // would put a live Approve button on a request nothing can book.
  if (!request) {
    return NextResponse.json({ error: 'This request has already been decided' }, { status: 409 })
  }

  const start = new Date(parsed.data.startIso)
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Pick a start time in the future' }, { status: 400 })
  }

  const avail = await getTrainerAvailabilityById(request.trainerId)
  if (!avail) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const dates = proposalSessionDates(start, request.package)

  // ── The gate, and it is NOT the same for both parties ─────────────────────
  //
  // A CLIENT proposing gets the identical three checks the self-book route
  // applies (lib/package-booking-window): inside the trainer's published
  // availability, clear of everything already booked, and inside this
  // offering's own window. Countering a time must not become a way to ask for
  // an hour the front door would have refused.
  //
  // A TRAINER proposing is only checked for a COLLISION. The window and the
  // published hours are a promise the trainer made and the only person who may
  // knowingly break it — offering a client a Saturday they don't normally work
  // is a kindness, not an error (the same asymmetry findNextBookableStart is
  // built around). Double-booking themselves is not a choice, so that one still
  // refuses.
  if (actor.party === 'CLIENT') {
    const { dateStr, minuteOfDay } = utcToZonedDateAndMinutes(start, avail.tz)
    const check = checkBookableStart({
      slots: avail.slots,
      blackouts: avail.blackouts,
      busy: avail.busy,
      dateStr,
      startMin: minuteOfDay,
      durationMins: request.package.durationMins,
      bufferMins: request.package.bufferMins,
      window: packageBookingWindow(request.package),
    })
    if (!check.ok) {
      const message =
        check.reason === 'taken' ? "That time's just been taken"
        : check.reason === 'outside-window' ? "This one isn't offered at that time"
        : "That time isn't available"
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  const clash = firstCollision({
    busy: avail.busy,
    tz: avail.tz,
    dates,
    durationMins: request.package.durationMins,
    bufferMins: request.package.bufferMins,
  })
  if (clash) {
    return NextResponse.json(
      { error: "That time's already booked — pick another" },
      { status: 400 },
    )
  }

  const note = (parsed.data.message ?? '').trim() || defaultProposalMessage(actor.party)
  const summary = describeProposal(dates, avail.tz, request.package.name)

  // One transaction, three writes, in this order for a reason: superseding
  // first means there is never an instant in which two proposals on the same
  // request are OPEN, which is the window an approval could slip through.
  const created = await prisma.$transaction(async tx => {
    await tx.bookingProposal.updateMany({
      where: { requestId: id, status: 'OPEN' },
      data: { status: 'SUPERSEDED', decidedAt: new Date() },
    })
    const message = await tx.message.create({
      data: {
        clientId: request.clientId,
        senderId: actor.userId,
        channel: 'TRAINER_CLIENT',
        // The body carries the proposal in words as well as in the card, so a
        // push preview, an email digest or any older client still reads as a
        // sentence rather than an empty bubble.
        body: `${note}\n\n${summary}`,
      },
      include: { sender: { select: { name: true, email: true } } },
    })
    const proposal = await tx.bookingProposal.create({
      data: {
        requestId: id,
        proposedBy: actor.party,
        proposedByUserId: actor.userId,
        sessionDates: dates.map(d => d.toISOString()),
        messageId: message.id,
      },
    })
    return { message, proposal }
  })

  // The one notifier — push / email / in-app, each gated by the recipient's own
  // NEW_MESSAGE (trainer) or CLIENT_NEW_MESSAGE (client) preference. There is
  // deliberately no second notification for "a time was proposed": it IS a
  // message, and telling someone twice about one event is noise.
  after(async () => {
    try {
      await notifyMessageRecipient({
        messageId: created.message.id,
        clientId: request.clientId,
        senderId: actor.userId,
        body: created.message.body,
      })
    } catch (err) {
      console.error('[booking propose after]', err)
    }
  })

  return NextResponse.json(
    {
      ok: true,
      proposalId: created.proposal.id,
      messageId: created.message.id,
      sessionDates: dates.map(d => d.toISOString()),
    },
    { status: 201 },
  )
}
