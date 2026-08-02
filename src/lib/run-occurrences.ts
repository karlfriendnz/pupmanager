import type { Prisma } from '@/generated/prisma'

// One occurrence of a run, changed on its own — cancelled, or moved.
//
// A weekly casual class runs for months. One week is Labour Day; another has to
// start an hour later because the hall is booked. Neither is a reason to touch
// the other fifteen weeks.
//
// ── Why the row stays ────────────────────────────────────────────────────────
//
// The obvious implementation is DELETE, and it is wrong three times over:
//
//   1. `ClassEnrollment.dropInSession` and `SessionAttendance.session` both
//      cascade. Deleting the occurrence silently deletes the register AND every
//      casual booking for it — the people who most need telling are the ones
//      the delete erases.
//   2. A deleted date leaves nothing behind to say it was deliberate. The
//      nightly slot top-up plans forward from each slot's LAST session, so
//      killing the tail moves the tail back and the very next night puts the
//      date straight back. Forever.
//   3. "Undo" stops existing.
//
// So a cancelled occurrence is a row with `cancelledAt` set. It is excluded
// everywhere it would otherwise be counted, charged, reminded or offered — and
// it is the tombstone that makes regeneration safe.
//
// ── Why an adjusted one is MARKED ────────────────────────────────────────────
//
// Three code paths rebuild or rewrite a run's sessions wholesale
// (`syncOfferingRun`, `updateClass`, the venue propagation inside the first).
// A hand-set time that any of them can overwrite is not a feature, it is a bug
// with a UI. `scheduleOverriddenAt` marks the row; the rebuilds refuse to run
// over it and the propagations skip it.
//
// `originalScheduledAt` records where the generator had put it, so the slot
// planner can recognise "I already made this one, they moved it" rather than
// creating it again at the old time.

/**
 * The sessions of a run that still count — for capacity, price, rosters,
 * reminders, the client's list, everything.
 *
 * Spread into a `TrainingSession` where:
 * ```ts
 * where: { classRunId, ...LIVE_SESSION }
 * ```
 */
export const LIVE_SESSION = { cancelledAt: null } as const satisfies Prisma.TrainingSessionWhereInput

// Both readers compare loosely (`!= null`). Prisma always hands back null for
// an unset nullable column, so the only way to see `undefined` is a caller that
// didn't select the field — and reading "not loaded" as "edited" would block
// every class reschedule in the system, permanently, from one missing select.
// Unlike the homework gate, the fail-safe direction here is OPEN.

/** True when this occurrence has been called off. */
export function isCancelled(s: { cancelledAt: Date | null }): boolean {
  return s.cancelledAt != null
}

/** True when the trainer set this occurrence's own time or venue by hand. */
export function isScheduleOverridden(s: { scheduleOverriddenAt: Date | null }): boolean {
  return s.scheduleOverriddenAt != null
}

/**
 * True when ANY occurrence of this run has been touched on its own — cancelled
 * or moved.
 *
 * This is the guard the two rebuild paths ask before they `deleteMany` a run's
 * sessions and lay down a fresh series. Rebuilding over per-occurrence work
 * would resurrect the public holiday and undo the moved week in one statement,
 * silently, on a save the trainer thought was about something else.
 *
 * It is deliberately a REFUSAL rather than a merge. Merging means deciding
 * which of the new dates the old overrides map onto, and there is no honest
 * answer when the cadence itself has changed — a wrong answer here is a class
 * that meets on a day nobody was told about.
 */
export function hasPerOccurrenceEdits(
  sessions: { cancelledAt: Date | null; scheduleOverriddenAt: Date | null }[],
): boolean {
  return sessions.some(s => isCancelled(s) || isScheduleOverridden(s))
}

/**
 * Every instant a slot's generator must NOT plan again, given the sessions that
 * slot already holds.
 *
 * A cancelled occurrence contributes its own time — that date is spoken for and
 * must stay dead. A moved occurrence contributes the time it was moved FROM, so
 * the planner doesn't helpfully re-create the week the trainer just shifted.
 *
 * Keyed on the epoch millisecond because the planner rebuilds Dates from the
 * same rule, so equal instants are equal to the millisecond.
 */
export function spokenForInstants(
  sessions: { scheduledAt: Date; cancelledAt: Date | null; originalScheduledAt: Date | null }[],
): Set<number> {
  const out = new Set<number>()
  for (const s of sessions) {
    if (s.originalScheduledAt) out.add(s.originalScheduledAt.getTime())
    if (s.cancelledAt) out.add(s.scheduledAt.getTime())
  }
  return out
}

/** Human label for a cancelled occurrence, for a list row or a notification. */
export function cancelledLabel(s: { cancelReason: string | null }): string {
  return s.cancelReason ? `Cancelled — ${s.cancelReason}` : 'Cancelled'
}
