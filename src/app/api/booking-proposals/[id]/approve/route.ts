import { NextResponse, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveNegotiationActor } from '@/lib/booking-negotiation-actor'
import { confirmBookingRequest } from '@/lib/booking-request-confirm'
import {
  parseSessionDates,
  firstCollision,
  proposalWhen,
  acceptedMessage,
} from '@/lib/booking-negotiation'
import { getTrainerAvailabilityById } from '@/lib/client-availability'
import { notifyMessageRecipient } from '@/lib/notify-message-recipient'

// POST /api/booking-proposals/[id]/approve — the other side says yes.
//
// Approving is what BOOKS. It runs the same confirmBookingRequest the trainer's
// straight "Approve" runs, so a time arrived at after four rounds of haggling
// produces exactly the records a first-time-lucky booking does — assignment,
// session series, calendar mirror, receivable, client notification.
//
// Four refusals, all server-side, all tested:
//
//   • the proposal is not the live one (SUPERSEDED / ACCEPTED / WITHDRAWN, or
//     something newer exists) — this is THE one that matters. An older card is
//     still on screen further up the thread; hiding its button is presentation,
//     and presentation is not a guarantee;
//   • you proposed it yourself — an approval is the other side saying yes;
//   • the request has already been decided;
//   • the diary has filled that slot since the offer was made. Refuse cleanly
//     and say so, rather than double-book.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const proposal = await prisma.bookingProposal.findUnique({
    where: { id },
    select: {
      id: true, requestId: true, status: true, proposedBy: true,
      sessionDates: true, createdAt: true,
      request: { select: { trainerId: true, clientId: true, status: true } },
    },
  })
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Tenant + identity, resolved against the REQUEST this proposal hangs off.
  const actorResult = await resolveNegotiationActor(proposal.requestId)
  if (!actorResult.ok) {
    return NextResponse.json({ error: actorResult.error }, { status: actorResult.status })
  }
  const { actor } = actorResult
  if (actor.isPreview) {
    return NextResponse.json({ error: 'Preview mode — booking disabled' }, { status: 403 })
  }

  // Nobody approves their own suggestion.
  if (proposal.proposedBy === actor.party) {
    return NextResponse.json(
      { error: 'Waiting for the other side to reply to this one' },
      { status: 403 },
    )
  }

  // ── Latest-only, enforced twice ───────────────────────────────────────────
  // The column first (a superseded proposal is stamped SUPERSEDED the moment a
  // newer one is written, inside the same transaction)…
  if (proposal.status !== 'OPEN') {
    return NextResponse.json(
      { error: 'A newer time has been suggested since — approve that one instead' },
      { status: 409 },
    )
  }
  // …and the ordering second, so a proposal that somehow escaped the stamp
  // (a partial write, a hand-edited row) still cannot book a superseded hour.
  const newest = await prisma.bookingProposal.findFirst({
    where: { requestId: proposal.requestId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (newest && newest.id !== proposal.id) {
    return NextResponse.json(
      { error: 'A newer time has been suggested since — approve that one instead' },
      { status: 409 },
    )
  }

  if (proposal.request.status !== 'PENDING') {
    return NextResponse.json({ error: 'This request has already been decided' }, { status: 409 })
  }

  const dates = parseSessionDates(proposal.sessionDates)
  if (dates.length === 0) {
    return NextResponse.json({ error: 'That suggestion has no valid times' }, { status: 400 })
  }

  const pkgRow = await prisma.bookingRequest.findUnique({
    where: { id: proposal.requestId },
    select: { package: { select: { name: true, durationMins: true, bufferMins: true } } },
  })
  const avail = await getTrainerAvailabilityById(proposal.request.trainerId)
  if (!pkgRow || !avail) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The gap between an offer and a yes is exactly where somebody else takes the
  // hour. Same predicate the self-book route gates on, buffers included.
  const clash = firstCollision({
    busy: avail.busy,
    tz: avail.tz,
    dates,
    durationMins: pkgRow.package.durationMins,
    bufferMins: pkgRow.package.bufferMins,
  })
  if (clash) {
    return NextResponse.json(
      {
        error: `${proposalWhen(clash, avail.tz)} has been booked since — suggest another time`,
        reason: 'taken',
      },
      { status: 409 },
    )
  }

  // Book it — the same path a straight confirmation takes.
  const result = await confirmBookingRequest({
    requestId: proposal.requestId,
    trainerId: proposal.request.trainerId,
    sessionDates: dates,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const when = proposalWhen(dates[0], avail.tz)
  // Close the negotiation and record the outcome IN the conversation, so the
  // thread ends on an answer rather than an unanswered question.
  const closing = await prisma.$transaction(async tx => {
    await tx.bookingProposal.update({
      where: { id: proposal.id },
      data: { status: 'ACCEPTED', decidedAt: new Date() },
    })
    await tx.bookingProposal.updateMany({
      where: { requestId: proposal.requestId, status: 'OPEN' },
      data: { status: 'WITHDRAWN', decidedAt: new Date() },
    })
    return tx.message.create({
      data: {
        clientId: proposal.request.clientId,
        senderId: actor.userId,
        channel: 'TRAINER_CLIENT',
        body: acceptedMessage(when),
      },
    })
  })

  after(async () => {
    try {
      await notifyMessageRecipient({
        messageId: closing.id,
        clientId: proposal.request.clientId,
        senderId: actor.userId,
        body: closing.body,
      })
    } catch (err) {
      console.error('[booking approve after]', err)
    }
  })

  return NextResponse.json({
    ok: true,
    status: 'CONFIRMED',
    clientPackageId: result.clientPackageId,
    when,
  })
}
