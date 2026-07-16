// Client-facing cancellation fee logic. A trainer can configure a fee
// (cancellationFeeCents) that a client is charged when THEY cancel a booking or
// class enrolment — optionally only inside a "late cancellation" window
// (cancellationFeeWindowHours) measured from the session start.
//
// The decision is a pure function so both cancel routes reuse identical rules
// and it's cheap to unit-test.

export interface CancellationFeeConfig {
  cancellationFeeCents: number | null
  cancellationFeeWindowHours: number | null
}

/**
 * How much (in minor units) a client owes for cancelling a session that starts
 * at `startAt`, given the trainer's fee config. Returns 0 when no fee applies:
 *   - no fee configured (null / <= 0), or
 *   - a window is set and the start is further away than that window.
 * A null window means the fee applies to ANY cancellation once a fee is set.
 */
export function resolveCancellationFeeCents(
  config: CancellationFeeConfig,
  startAt: Date,
  now: Date = new Date(),
): number {
  const fee = config.cancellationFeeCents ?? 0
  if (fee <= 0) return 0

  const windowHours = config.cancellationFeeWindowHours
  // No window → the fee applies to every cancellation.
  if (windowHours == null) return fee

  const hoursUntilStart = (startAt.getTime() - now.getTime()) / 3_600_000
  // Charged only when cancelling within the window of the start (a late cancel).
  // A start already in the past counts as within the window.
  return hoursUntilStart <= windowHours ? fee : 0
}
