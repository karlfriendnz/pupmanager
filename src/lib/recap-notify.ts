import { prisma } from '@/lib/prisma'
import { notifyClient } from '@/lib/client-notify'
import { clientFacingTrainerName } from '@/lib/trainer-name'
import { reportHasContent, attendanceReportHasContent } from '@/lib/report-visibility'

// Telling a client their recap is ready.
//
// Visibility and notification used to be the same act: stamping `sentAt` both
// revealed the write-up and fired the push. Now that completing a session
// reveals it (see lib/report-visibility), those two come apart, and `sentAt`
// keeps only the second job — "this client has been told". That is the one
// thing it is genuinely good at: it is a per-recap stamp, so it is impossible
// to notify the same person twice about the same write-up, however many times
// the trainer re-saves the note or toggles the session complete.
//
// ── Why one notification per client, not per note ────────────────────────────
//
// A trainer ticking off twelve sessions on a Sunday evening is usually ticking
// off twelve different clients, and each of those people should hear once. But
// a client who had three sessions that week must not get three pushes in the
// same second. So a single call dedupes by recipient: every recap it releases
// is stamped and revealed, and each PERSON gets at most one "your recap is
// ready". The link points at the most recent of their sessions.

const RECAP_TYPE = 'CLIENT_RECAP_READY' as const

export interface ReleaseRecapsOptions {
  trainerId: string
  /** Explicit SessionFormResponse ids — the per-note and bulk Send buttons. */
  responseIds?: string[]
  /** Explicit SessionAttendance ids — the group-class equivalent. */
  attendanceIds?: string[]
  /**
   * Every not-yet-announced recap sitting on these sessions. This is the path
   * completion takes: the trainer marks a session done and whatever is written
   * on it goes out, without anyone naming a note id.
   */
  sessionIds?: string[]
}

/**
 * Reveal-and-announce. Stamps `sentAt` / `reportSentAt` on every matching recap
 * that has actually been written, then notifies each affected client once.
 *
 * Empty write-ups are skipped on purpose. Attaching a form to a session creates
 * a blank response row, and a blank row is not a recap — announcing one would
 * send a client to a page with nothing on it, which is exactly the bug the old
 * "recap ready" tile on the client home screen used to have.
 *
 * Safe to call repeatedly: only rows with a null stamp are considered, so
 * re-completing a session, or editing a note that has already gone out, is a
 * no-op rather than a second push.
 */
export async function releaseRecaps(opts: ReleaseRecapsOptions): Promise<{ sent: number }> {
  const { trainerId } = opts
  const responseIds = opts.responseIds ?? []
  const attendanceIds = opts.attendanceIds ?? []
  const sessionIds = opts.sessionIds ?? []
  if (responseIds.length === 0 && attendanceIds.length === 0 && sessionIds.length === 0) {
    return { sent: 0 }
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { businessName: true, user: { select: { name: true } } },
  })
  const trainerName = clientFacingTrainerName(trainer)

  const now = new Date()
  // userId → the one notification that person will get. Later sessions win, so
  // a client with several recaps released at once is pointed at the newest.
  const pending = new Map<string, { dogName: string; planName: string; sessionId: string; at: number }>()
  const remember = (userId: string, vars: { dogName: string; planName: string; sessionId: string; at: number }) => {
    const existing = pending.get(userId)
    if (!existing || vars.at >= existing.at) pending.set(userId, vars)
  }

  let released = 0

  // ── 1:1 session notes ────────────────────────────────────────────────────
  const responseOr = [
    ...(responseIds.length > 0 ? [{ id: { in: responseIds } }] : []),
    ...(sessionIds.length > 0 ? [{ sessionId: { in: sessionIds } }] : []),
  ]
  if (responseOr.length > 0) {
    const candidates = await prisma.sessionFormResponse.findMany({
      where: { sentAt: null, session: { trainerId }, OR: responseOr },
      select: {
        id: true,
        sessionId: true,
        answers: true,
        introMessage: true,
        closingMessage: true,
        session: {
          select: {
            title: true,
            scheduledAt: true,
            dog: { select: { name: true } },
            client: { select: { userId: true } },
          },
        },
      },
    })
    const ready = candidates.filter(reportHasContent)
    if (ready.length > 0) {
      await prisma.sessionFormResponse.updateMany({
        where: { id: { in: ready.map(r => r.id) } },
        data: { sentAt: now },
      })
      released += ready.length
      for (const r of ready) {
        if (!r.session.client?.userId) continue
        remember(r.session.client.userId, {
          dogName: r.session.dog?.name ?? 'your dog',
          planName: r.session.title,
          sessionId: r.sessionId,
          at: r.session.scheduledAt.getTime(),
        })
      }
    }
  }

  // ── Group-class per-attendee reports ─────────────────────────────────────
  const attendanceOr = [
    ...(attendanceIds.length > 0 ? [{ id: { in: attendanceIds } }] : []),
    ...(sessionIds.length > 0 ? [{ sessionId: { in: sessionIds } }] : []),
  ]
  if (attendanceOr.length > 0) {
    const candidates = await prisma.sessionAttendance.findMany({
      where: {
        reportSentAt: null,
        session: { classRun: { trainerId } },
        OR: attendanceOr,
      },
      select: {
        id: true,
        sessionId: true,
        report: true,
        session: { select: { scheduledAt: true } },
        enrollment: {
          select: {
            client: { select: { userId: true } },
            dog: { select: { name: true } },
            classRun: { select: { name: true } },
          },
        },
      },
    })
    const ready = candidates.filter(a => attendanceReportHasContent(a.report))
    if (ready.length > 0) {
      await prisma.sessionAttendance.updateMany({
        where: { id: { in: ready.map(a => a.id) } },
        data: { reportSentAt: now },
      })
      released += ready.length
      for (const a of ready) {
        if (!a.enrollment.client?.userId) continue
        remember(a.enrollment.client.userId, {
          dogName: a.enrollment.dog?.name ?? 'your dog',
          planName: a.enrollment.classRun?.name ?? 'your class',
          sessionId: a.sessionId,
          at: a.session.scheduledAt.getTime(),
        })
      }
    }
  }

  for (const [userId, v] of pending) {
    await notifyClient({
      userId,
      trainerId,
      type: RECAP_TYPE,
      vars: { trainerName, dogName: v.dogName, planName: v.planName },
      link: `/my-sessions/${v.sessionId}`,
      ctaLabel: 'See your recap',
    })
  }

  return { sent: released }
}
