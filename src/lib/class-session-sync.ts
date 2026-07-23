// Best-effort: mirror a class's freshly-created sessions onto the trainer's
// Google Calendar. Unassigned class sessions route to the company owner's
// connection (the sync engine's built-in fallback). Never breaks the create.
//
// Shared, because a class can now be scheduled from two places — POST
// /api/class-runs and POST /api/packages (defining an offering with a start
// date) — and a session that skips this is a session missing from the
// trainer's calendar with nothing to indicate it.
export async function syncClassSessions(sessionIds: string[]) {
  if (sessionIds.length === 0) return
  try {
    const { syncSessionsToGoogle } = await import('./google-calendar-sync')
    await syncSessionsToGoogle(sessionIds)
  } catch {
    // Non-critical
  }
}
