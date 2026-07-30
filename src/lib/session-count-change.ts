/**
 * What changing "Number of sessions" is about to do to the sessions that exist.
 *
 * Editing a scheduled class already pauses on SAVE to ask which sessions to drop —
 * but only on save, so the consequence of the change arrived after the decision.
 * This is the same answer, at the moment the number moves, under the box.
 *
 * Pure on purpose: the arithmetic is the part worth being sure about, and the
 * "will be deleted" number is the one a trainer acts on.
 */

export type SessionCountChange =
  /** The number didn't really move. */
  | { kind: 'none' }
  /**
   * A 1:1 package: it owns no schedule, so the count only decides what a FUTURE
   * assignment gets. Clients already on it keep the sessions they have —
   * syncOfferingRun is group-only, so nothing rewrites them.
   */
  | { kind: 'assignments'; count: number }
  /**
   * A class with several cohorts running. We can't say which one would change, and
   * the save deliberately doesn't touch any of them (syncOfferingRun no-ops on a
   * multi-run offering), so say that rather than nothing.
   */
  | { kind: 'cohorts'; runCount: number; count: number }
  /** `count` more sessions get created, continuing the cadence. */
  | { kind: 'add'; count: number }
  /** `count` existing sessions go. The trainer picks which on save. */
  | { kind: 'remove'; count: number }
  /** Switched to ongoing: no fixed end, and what's scheduled stays. */
  | { kind: 'ongoing'; existing: number }

export function sessionCountChange({
  existingSessions,
  wanted,
  previous,
  isGroup = true,
  runCount = 1,
}: {
  /** How many sessions are scheduled RIGHT NOW (0 when there's no single run). */
  existingSessions: number
  /** The count now chosen in the form. 0 means "ongoing, no fixed end". */
  wanted: number
  /**
   * What the offering was SAVED with. Without it the message appears the moment
   * the screen opens, describing a change nobody made — this only ever answers
   * "what will this edit do", so an untouched form has nothing to say.
   */
  previous?: number
  /** A 1:1 package owns no schedule; a class does. */
  isGroup?: boolean
  /** How many cohorts of this class are running. Only one has a schedule we can
   *  speak for — the edit screen only loads sessions when there's exactly one. */
  runCount?: number
}): SessionCountChange {
  if (!Number.isFinite(wanted) || wanted < 0) return { kind: 'none' }

  // Nothing said until something changes. Checked FIRST, before any of the
  // per-shape branches, so it holds for all of them.
  if (previous !== undefined && Number.isFinite(previous) && wanted === previous) {
    return { kind: 'none' }
  }

  // A 1:1 package has no series of its own — sessions are created when it's
  // assigned. Saying "3 will be deleted" would be a lie, but saying nothing left
  // the trainer wondering whether the change did anything at all.
  if (!isGroup) return wanted === 0 ? { kind: 'none' } : { kind: 'assignments', count: wanted }

  // Several cohorts: we don't know which schedule the trainer means, and the save
  // deliberately leaves all of them alone.
  if (runCount > 1) return { kind: 'cohorts', runCount, count: wanted }

  if (!Number.isFinite(existingSessions) || existingSessions <= 0) return { kind: 'none' }

  // Ongoing isn't "zero sessions" — it's "no fixed end". Reading it as a shrink to
  // zero would warn that every session is about to be deleted, which is the
  // opposite of what happens.
  if (wanted === 0) return { kind: 'ongoing', existing: existingSessions }

  if (wanted > existingSessions) return { kind: 'add', count: wanted - existingSessions }
  if (wanted < existingSessions) return { kind: 'remove', count: existingSessions - wanted }
  return { kind: 'none' }
}

/** The sentence shown under the box. `hasAttendance` sharpens the shrink warning:
 *  dropping a session someone was marked present at loses a record. */
export function sessionCountChangeMessage(
  change: SessionCountChange,
  opts: { hasAttendance?: boolean } = {},
): string | null {
  const s = (n: number) => (n === 1 ? 'session' : 'sessions')
  switch (change.kind) {
    case 'add':
      return `${change.count} ${s(change.count)} will be added, carrying on the same cadence.`
    case 'remove':
      return opts.hasAttendance
        ? `${change.count} ${s(change.count)} will be removed — you'll choose which ones when you save. Some already have attendance marked.`
        : `${change.count} ${s(change.count)} will be removed — you'll choose which ones when you save.`
    case 'ongoing':
      return `No fixed end. The ${change.existing} ${s(change.existing)} already scheduled stay as they are.`
    case 'assignments':
      return `Anyone assigned this from now on gets ${change.count} ${s(change.count)}. Clients already on it keep the sessions they have.`
    case 'cohorts':
      return `${change.runCount} groups are running this. New ones get ${change.count} ${s(change.count)}; the sessions already scheduled don't move.`
    case 'none':
      return null
  }
}
