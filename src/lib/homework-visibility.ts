import type { Prisma } from '@/generated/prisma'

// When a client is allowed to see a piece of homework.
//
// Homework carries a `timing` (see the HomeworkTiming enum): preparation for a
// session, or practice after it. Preparation that arrives after the class is
// useless — "bring a hungry dog and a pot of chicken" — and practice that
// arrives before it is noise the client can do nothing with.
//
// ── What "the session has run" means ─────────────────────────────────────────
//
// Its START time has passed, OR the trainer has marked it done. Deliberately
// NOT the end time and NOT the register:
//
//   • End time (scheduledAt + durationMins) can't be compared in a Prisma
//     `where` without raw SQL, and a class that runs ten minutes over would
//     hold the homework back for no reason. The moment a session starts, its
//     homework has stopped being a spoiler.
//   • Marked-attended is the most accurate signal and the least reliable one —
//     plenty of trainers never tick the register, and homework that waits for a
//     tick that never comes is homework the client never sees. A missing tick
//     must not be able to hide work.
//
// So: start time is the fact that is always present and always right, and the
// completed statuses are ORed in to cover a session finished early or one whose
// scheduledAt was left in the future.
//
// This is the ONE definition. Every client-facing read of TrainingTask spreads
// it into its `where` — if you find yourself writing `scheduledAt: { lte: ... }`
// against homework anywhere else, use this instead.

/** Session statuses that mean the trainer considers the session done. */
const RUN_STATUSES = ['COMPLETED', 'COMMENTED', 'INVOICED'] as const

/**
 * A `TrainingTask` where-fragment that hides post-session homework until its
 * session has run. Spread into an existing where clause:
 *
 * ```ts
 * where: { clientId, date: { gte, lt }, ...clientVisibleHomeworkWhere() }
 * ```
 *
 * Trainer-side reads must NOT use this — a trainer has to see what they have
 * queued up, which is the whole point of being able to set it in advance.
 */
export function clientVisibleHomeworkWhere(now: Date = new Date()): Prisma.TrainingTaskWhereInput {
  return {
    OR: [
      // Preparation. Its whole job is to arrive early, so it is visible the
      // moment the trainer hands it out.
      { timing: 'BEFORE_SESSION' },
      // Homework with no session behind it — added by hand from the client's
      // own screen, or imported — has nothing to wait for.
      { sessionId: null },
      // Practice, once the session it came out of has started…
      { session: { scheduledAt: { lte: now } } },
      // …or once the trainer has called it done, whatever the clock says.
      { session: { status: { in: [...RUN_STATUSES] } } },
    ],
  }
}

/**
 * The same rule applied to a row already in hand, for the places that fetched
 * the task first (a detail screen resolving a task by id) or that filter an
 * `include`d list in memory.
 */
export function isHomeworkVisibleToClient(
  task: {
    timing: 'BEFORE_SESSION' | 'AFTER_SESSION'
    sessionId?: string | null
    session?: { scheduledAt: Date; status: string } | null
  },
  now: Date = new Date(),
): boolean {
  if (task.timing === 'BEFORE_SESSION') return true
  // No session behind it — nothing to wait for. `sessionId` is checked rather
  // than `session` so a caller that didn't join the session can't accidentally
  // read "not loaded" as "no session" and reveal everything.
  if (task.sessionId === null) return true
  if (!task.session) return false
  if (RUN_STATUSES.includes(task.session.status as (typeof RUN_STATUSES)[number])) return true
  return task.session.scheduledAt.getTime() <= now.getTime()
}
