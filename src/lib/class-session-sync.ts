// Best-effort: mirror a class's freshly-created sessions onto the trainer's
// Google Calendar. Unassigned class sessions route to the company owner's
// connection (the sync engine's built-in fallback). Never breaks the create.
//
// Shared, because a class can now be scheduled from two places — POST
// /api/class-runs and POST /api/packages (defining an offering with a start
// date) — and a session that skips this is a session missing from the
// trainer's calendar with nothing to indicate it.
/**
 * How many of a newly-created series get mirrored from inside the request.
 *
 * A slot-scheduled run now lays down a YEAR of sessions at creation (see
 * SLOT_HORIZON_MONTHS) — for a five-day, three-part daycare that's ~780 rows,
 * and syncSessionsToGoogle fires one Google write PER ROW, in parallel. Pushing
 * all of them here would blow Google's per-minute quota and hold the create
 * response open while it did. Mirror the nearest ones now — which is the whole
 * series for an ordinary class, whose run is a handful long, so nothing changes
 * there — and leave the tail to the google-calendar-backfill cron, which exists
 * for exactly this and pages through anything with no googleCalendarEventId.
 */
const MAX_INLINE_MIRROR = 60

export async function syncClassSessions(sessionIds: string[]) {
  if (sessionIds.length === 0) return
  try {
    let ids = sessionIds
    if (ids.length > MAX_INLINE_MIRROR) {
      const { prisma } = await import('./prisma')
      const nearest = await prisma.trainingSession.findMany({
        where: { id: { in: sessionIds } },
        orderBy: { scheduledAt: 'asc' },
        take: MAX_INLINE_MIRROR,
        select: { id: true },
      })
      ids = nearest.map((s) => s.id)
    }
    const { syncSessionsToGoogle } = await import('./google-calendar-sync')
    await syncSessionsToGoogle(ids)
  } catch {
    // Non-critical
  }
}

/**
 * Best-effort: remove class sessions from the trainer's Google Calendar after
 * a reschedule has deleted them. Same posture as the push above — a calendar
 * that couldn't be reached must never fail the save.
 */
export async function removeClassEvents(companyId: string, eventIds: string[]) {
  if (eventIds.length === 0) return
  try {
    const { deleteGoogleEvents } = await import('./google-calendar-sync')
    await deleteGoogleEvents(companyId, eventIds)
  } catch {
    // Non-critical
  }
}
