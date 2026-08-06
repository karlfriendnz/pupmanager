// The billing CYCLE, as a unit plus a count — "every 6 weeks".
//
// Deliberately PURE: no prisma, no Stripe SDK, no React, no env. The trainer's
// plan editor and the client's storefront card both need this wording, and
// neither may pull the billing stack (and therefore `pg`) into a browser
// bundle. connect-subscriptions.ts re-exports everything here, so server code
// that already imports it keeps working unchanged.
//
// WHY A COUNT RATHER THAN MORE ENUM VALUES. Stripe's recurring shape has always
// been `{ interval, interval_count }`, and FORTNIGHT was only ever `week × 2` —
// the count was already there, just hard-coded. Groomers work on 4, 6 and
// 8-week cycles; a new enum value per cycle length would be a migration, a
// Prisma regenerate and a deploy every time somebody wants 5.
//
// FORTNIGHT SURVIVES. It is still a valid stored value and every existing row
// keeps billing and reading exactly as it does today. It is simply no longer
// offered to NEW plans — "every 2 weeks" says the same thing with the same
// Stripe result, and two ways to express one cycle is how a consent screen and
// an invoice end up disagreeing.

export type PlanInterval = 'WEEK' | 'FORTNIGHT' | 'MONTH'

/** The singular noun for one unit of each interval. */
const UNIT: Record<PlanInterval, string> = {
  WEEK: 'week',
  FORTNIGHT: 'fortnight',
  MONTH: 'month',
}

// ─── Bounds ─────────────────────────────────────────────────────────────────
// A cycle of 0 is nonsense and a cycle of 500 weeks is a support ticket. The
// ceiling is one year, which is also Stripe's own limit on a Price's billing
// period — anything longer is rejected by the API, so accepting it here would
// only move the failure to the moment somebody tries to buy.

export const MAX_WEEKS_PER_CYCLE = 52
export const MAX_MONTHS_PER_CYCLE = 12

/** The largest count that keeps one cycle inside a year, for this unit. */
export function maxIntervalCount(interval: PlanInterval): number {
  if (interval === 'MONTH') return MAX_MONTHS_PER_CYCLE
  if (interval === 'FORTNIGHT') return MAX_WEEKS_PER_CYCLE / 2
  return MAX_WEEKS_PER_CYCLE
}

/**
 * Is this a cycle we are willing to store and sell? Enforced SERVER-SIDE by the
 * membership schema — a number input with `min` on it is a hint, not a rule.
 */
export function isValidIntervalCount(interval: PlanInterval, count: number): boolean {
  return Number.isInteger(count) && count >= 1 && count <= maxIntervalCount(interval)
}

/**
 * Anything stored (or posted) that we are about to do arithmetic with. Legacy
 * rows predate the column and read back as 1 via the DB default; this is the
 * belt-and-braces for a null that somehow arrives anyway.
 */
function safeCount(count: number | null | undefined): number {
  const n = Math.trunc(Number(count))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

// ─── Stripe ─────────────────────────────────────────────────────────────────

/**
 * Our billing cycle → Stripe's `recurring` shape.
 *
 * Stripe has no "fortnight" and no "6 weeks" — both are a week interval with a
 * count. Keeping the translation in one function means the plan editor, the
 * consent screen and the Price minting can never disagree about what a cycle is.
 */
export function stripeRecurring(
  interval: PlanInterval,
  intervalCount: number = 1,
): { interval: 'week' | 'month'; interval_count: number } {
  const n = safeCount(intervalCount)
  switch (interval) {
    case 'WEEK':
      return { interval: 'week', interval_count: n }
    case 'FORTNIGHT':
      // A fortnight IS two weeks. A count on top multiplies it, so a legacy
      // FORTNIGHT row (count 1) still yields exactly `week × 2`.
      return { interval: 'week', interval_count: 2 * n }
    case 'MONTH':
      return { interval: 'month', interval_count: n }
  }
}

// ─── Wording ────────────────────────────────────────────────────────────────

/**
 * The noun that follows "every" and "/" — "week", "6 weeks", "fortnight".
 *
 * A count of 1 returns the bare singular, so "per week" and "every month" read
 * exactly as they always have. Never "every 1 week".
 */
export function intervalLabel(interval: PlanInterval, intervalCount: number = 1): string {
  const n = safeCount(intervalCount)
  const unit = UNIT[interval]
  return n > 1 ? `${n} ${unit}s` : unit
}

/**
 * A minimum term, stated in the BASE unit rather than in cycles.
 *
 * "2 cycles" means nothing to somebody handing over a card; "12 weeks" does.
 * With a count of 1 this produces the identical string the old wording did.
 */
export function cycleTermLabel(
  interval: PlanInterval,
  intervalCount: number,
  cycles: number,
): string {
  const total = Math.max(0, Math.trunc(cycles)) * safeCount(intervalCount)
  return `${total} ${UNIT[interval]}${total === 1 ? '' : 's'}`
}

// ─── Dates ──────────────────────────────────────────────────────────────────

/**
 * Move forward by whole billing cycles, used ONLY to describe a minimum term in
 * words before someone commits. The real period boundaries always come back
 * from Stripe — we never compute a billing date ourselves.
 */
export function addCycles(
  from: Date,
  interval: PlanInterval,
  cycles: number,
  intervalCount: number = 1,
): Date {
  const n = safeCount(intervalCount)
  const d = new Date(from.getTime())
  if (interval === 'MONTH') d.setMonth(d.getMonth() + cycles * n)
  else d.setDate(d.getDate() + cycles * n * (interval === 'FORTNIGHT' ? 14 : 7))
  return d
}

// ─── The editor ─────────────────────────────────────────────────────────────

/**
 * How a stored cycle should appear in the plan editor, which offers weeks and
 * months plus a number.
 *
 * A legacy FORTNIGHT row shows as "every 2 weeks" — the same cycle, the same
 * Stripe result, in the vocabulary the editor speaks. Nothing is written until
 * the trainer saves, and the PATCH route archives any plan with live
 * subscribers before writing new rows, so an existing subscription is never
 * re-cycled by this.
 */
export function editorInterval(
  interval: PlanInterval,
  intervalCount: number | null | undefined,
): { interval: 'WEEK' | 'MONTH'; intervalCount: number } {
  const n = safeCount(intervalCount)
  if (interval === 'FORTNIGHT') return { interval: 'WEEK', intervalCount: 2 * n }
  return { interval, intervalCount: n }
}
