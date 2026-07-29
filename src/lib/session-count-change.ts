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
  /** Nothing scheduled to affect, or the number didn't really move. */
  | { kind: 'none' }
  /** `count` more sessions get created, continuing the cadence. */
  | { kind: 'add'; count: number }
  /** `count` existing sessions go. The trainer picks which on save. */
  | { kind: 'remove'; count: number }
  /** Switched to ongoing: no fixed end, and what's scheduled stays. */
  | { kind: 'ongoing'; existing: number }

export function sessionCountChange({
  existingSessions,
  wanted,
}: {
  /** How many sessions are scheduled RIGHT NOW. */
  existingSessions: number
  /** The count now chosen in the form. 0 means "ongoing, no fixed end". */
  wanted: number
}): SessionCountChange {
  // A 1:1 package has no scheduled series of its own — its sessions are created
  // when the package is assigned to a client. There is nothing to add or delete
  // yet, so promising either would be a lie.
  if (!Number.isFinite(existingSessions) || existingSessions <= 0) return { kind: 'none' }
  if (!Number.isFinite(wanted) || wanted < 0) return { kind: 'none' }

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
    case 'none':
      return null
  }
}
