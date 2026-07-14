// The "gap before the next session" buffer — a turnaround window (travel,
// clean-up, reset) the trainer configures on a package or a class, snapshotted
// onto every session it creates.
//
// The rule, in one line: a session OCCUPIES
//     [scheduledAt, scheduledAt + durationMins + bufferMins)
// The interval is HALF-OPEN, so a booking that starts at the exact instant the
// buffer ends is allowed; one that starts a minute earlier is not.
//
// Both sides of a comparison carry their own trailing buffer, so a new booking
// can't be squeezed in just before an existing one either — its own turnaround
// would run into the existing session.
//
// Pure (no prisma, no DOM) so the server routes, the client schedule UI and the
// unit tests all share exactly one implementation.

/** Longest gap a trainer can set (4 hours) — matches the zod bounds on the APIs. */
export const MAX_BUFFER_MINS = 240

/** Clamp any user/DB-supplied value to a sane, non-negative whole number. */
export function normalizeBufferMins(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.min(MAX_BUFFER_MINS, Math.max(0, Math.floor(value)))
}

/**
 * The buffer a class session should be booked with. A ClassRun may override its
 * package (null = inherit) — the same tri-state shape `capacity` uses.
 */
export function effectiveBufferMins(
  runBufferMins: number | null | undefined,
  packageBufferMins: number | null | undefined,
): number {
  return normalizeBufferMins(runBufferMins ?? packageBufferMins ?? 0)
}

/** Minutes a session takes off the calendar: the session itself plus its buffer. */
export function occupiedMins(durationMins: number, bufferMins: number | null | undefined): number {
  return Math.max(0, durationMins) + normalizeBufferMins(bufferMins)
}

/** Exclusive end of a session's occupied window, in ms. */
export function occupiedEndMs(
  startMs: number,
  durationMins: number,
  bufferMins: number | null | undefined,
): number {
  return startMs + occupiedMins(durationMins, bufferMins) * 60_000
}

export interface BufferedInterval {
  startMs: number
  durationMins: number
  bufferMins?: number | null
}

/**
 * Half-open overlap of two buffered sessions. TRUE = double-booked (or one's
 * turnaround would run into the other). A session starting exactly when the
 * other's buffer ends → FALSE (allowed).
 */
export function bufferedOverlap(a: BufferedInterval, b: BufferedInterval): boolean {
  const endA = occupiedEndMs(a.startMs, a.durationMins, a.bufferMins)
  const endB = occupiedEndMs(b.startMs, b.durationMins, b.bufferMins)
  return a.startMs < endB && b.startMs < endA
}
