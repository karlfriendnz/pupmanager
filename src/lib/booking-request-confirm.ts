// Turning a pending BookingRequest into a real booking.
//
// This used to live inline in PATCH /api/booking-requests/[id]. It was lifted
// out the day counter-offers landed, because a negotiated booking has to
// produce EXACTLY what a straight confirmation produces — the assignment, the
// session series, the Google Calendar mirror, the receivable and the client's
// notification, all five, in the same order (AGENTS.md #4: count what the
// action does). The only way to guarantee that is for both paths to run the
// same function rather than two copies that drift.
//
// The one thing an accepted counter-offer changes is WHICH dates get booked, so
// that is the only parameter.
import { prisma } from './prisma'
import { safeEvaluate } from './achievements'
import { createBookingAssignment } from './self-book'
import { carryRequestAnswersToSession } from './booking-gate'
import { createInvoiceForAssignment } from './invoicing'

export interface ConfirmArgs {
  requestId: string
  trainerId: string
  /**
   * The series to book. Omit to book the request's own stored `sessionDates`
   * (a straight confirmation); pass an accepted proposal's dates to book those
   * instead. When passed, the request's `sessionDates` are updated to match, so
   * the row records the times that were actually agreed rather than the ones
   * first asked for.
   */
  sessionDates?: Date[]
}

export type ConfirmResult =
  | { ok: true; clientPackageId: string }
  | { ok: false; status: number; error: string }

/**
 * Confirm a PENDING booking request. Idempotent by virtue of the status filter:
 * a request that is already CONFIRMED or DECLINED is not found and returns 404
 * rather than booking a second series.
 */
export async function confirmBookingRequest(args: ConfirmArgs): Promise<ConfirmResult> {
  const reqRow = await prisma.bookingRequest.findFirst({
    where: { id: args.requestId, trainerId: args.trainerId, status: 'PENDING' },
    include: {
      // bufferMins rides along so a confirmed request books with the package's
      // turnaround gap, exactly like an instant book.
      package: { select: { name: true, sessionCount: true, durationMins: true, bufferMins: true, sessionType: true } },
    },
  })
  if (!reqRow) return { ok: false, status: 404, error: 'Not found' }

  const stored = (Array.isArray(reqRow.sessionDates) ? reqRow.sessionDates : [])
    .map(d => new Date(String(d)))
    .filter(d => !Number.isNaN(d.getTime()))
  const dates = args.sessionDates && args.sessionDates.length > 0 ? args.sessionDates : stored
  if (dates.length === 0) {
    return { ok: false, status: 400, error: 'Request has no valid session dates' }
  }

  const assignmentId = await prisma.$transaction(async tx => {
    const aid = await createBookingAssignment(tx, {
      trainerId: args.trainerId,
      clientId: reqRow.clientId,
      packageId: reqRow.packageId,
      dogId: reqRow.dogId,
      pkg: reqRow.package,
      sessionDates: dates,
      bookingPageId: reqRow.bookingPageId,
    })
    await tx.bookingRequest.update({
      where: { id: args.requestId },
      data: {
        status: 'CONFIRMED',
        decidedAt: new Date(),
        resultingClientPackageId: aid,
        // What was agreed, not what was first asked for.
        sessionDates: dates.map(d => d.toISOString()),
      },
    })
    return aid
  })

  await safeEvaluate(reqRow.clientId)
  // createMany returns no ids, so re-read them by the new assignment. Read
  // OUTSIDE the Google try/catch below: the answers move on the back of this,
  // and a flaky calendar sync must not be able to swallow them.
  const createdRows = await prisma.trainingSession.findMany({
    where: { clientPackageId: assignmentId },
    orderBy: { scheduledAt: 'asc' },
    select: { id: true },
  })
  // An approval-required offering asks its gating questions BEFORE anybody has
  // said yes, so the answers were parked on the request. This is where they move
  // onto the session the trainer has just created — otherwise the client would
  // have typed five things that ended up on a decided request while the session
  // being run had none, which is bug #8's shape exactly.
  await carryRequestAnswersToSession(prisma, {
    bookingRequestId: args.requestId,
    sessionId: createdRows[0]?.id ?? null,
  })
  // Best-effort: mirror the confirmed session series onto the trainer's Google
  // Calendar.
  try {
    if (createdRows.length) {
      const { syncSessionsToGoogle } = await import('@/lib/google-calendar-sync')
      await syncSessionsToGoogle(createdRows.map(r => r.id))
    }
  } catch {
    // Non-critical
  }
  // Best-effort receivable for the confirmed booking (idempotent, skips
  // unpriced packages, never blocks the confirmation).
  await createInvoiceForAssignment({
    trainerId: args.trainerId,
    clientId: reqRow.clientId,
    sourceType: 'PACKAGE',
    clientPackageId: assignmentId,
  })
  await prisma.clientNotification
    .create({
      data: {
        clientId: reqRow.clientId,
        trainerId: args.trainerId,
        subject: `Booking confirmed: ${reqRow.package.name}`,
        notes: `Your ${reqRow.package.name} sessions are now on the calendar.`,
      },
    })
    .catch(e => console.error('[booking confirm] notify failed', e))

  return { ok: true, clientPackageId: assignmentId }
}
