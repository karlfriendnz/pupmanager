// How an offering's price is EXPRESSED, and the one place the total is derived.
//
// `Package.priceCents` is, and stays, the authoritative total: checkout,
// invoicing, Stripe, MembershipItem and every report read it and know nothing
// about this file. What a trainer told us, though, is often "thirty dollars a
// session" — and a four-session course priced that way has to re-total itself
// when it becomes a six-session course, or the number they typed silently stops
// being true.
//
// So `pricePerSessionCents` records the INTENT and nothing else. When it is set
// the total is derived from it on every save; when it is null the offering is
// priced as a lump sum exactly as it always was. There is no third state, and
// nothing downstream has to learn a second way to read a price.
//
// Pure — no Prisma, no React — because the form derives the figure it shows the
// trainer and the API derives the figure it stores, and those two must be the
// same arithmetic rather than two copies that drift.

/**
 * Below this, "per session" has nothing to say that the total doesn't.
 *
 * One session means the per-session price IS the total — two fields for one
 * number. Zero means an ONGOING offering (the trainer picks an end date when
 * they assign it), so there is no session count to multiply by at all.
 */
export const PER_SESSION_MIN_SESSIONS = 2

/** Whether to OFFER the per-session choice for an offering of this length. */
export function canPricePerSession(sessionCount: number | null | undefined): boolean {
  const n = Number(sessionCount)
  return Number.isFinite(n) && n >= PER_SESSION_MIN_SESSIONS
}

/**
 * The total an offering of `sessionCount` sessions costs at `perSessionCents`
 * each. Null when there is no per-session price, or no countable number of
 * sessions to multiply it by.
 */
export function totalFromPerSession(
  perSessionCents: number | null | undefined,
  sessionCount: number | null | undefined,
): number | null {
  if (perSessionCents === null || perSessionCents === undefined) return null
  const n = Number(sessionCount)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.round(perSessionCents * n)
}

/**
 * Settle an offering's price from what the trainer meant.
 *
 * Returns BOTH columns, always, so a caller can spread the result straight into
 * a create/update and cannot persist a per-session price without the matching
 * total (which is the only way the two could ever disagree).
 *
 * The three things it protects:
 *
 *  - **A session count change re-totals.** Run it on every save and a course
 *    that grows from four sessions to six re-prices from the per-session figure
 *    instead of keeping a total that no longer matches it.
 *  - **Ongoing offerings can't be zeroed.** `sessionCount` 0 means "ongoing",
 *    and 0 x anything is 0 — which would quietly wipe the price. The intent is
 *    dropped and the existing total left alone instead.
 *  - **One session collapses to a total.** The derived figure is kept (one
 *    session at $30 really is $30), but the intent is not stored, because the
 *    UI has nothing to show for it.
 */
export function resolvePackagePricing(input: {
  /** The trainer's per-session figure, or null when pricing as a lump sum. */
  pricePerSessionCents?: number | null
  /** The lump-sum total — used as-is whenever there is no per-session price. */
  priceCents?: number | null
  sessionCount: number | null | undefined
}): { priceCents: number | null; pricePerSessionCents: number | null } {
  const per = input.pricePerSessionCents ?? null
  const total = input.priceCents ?? null

  // Priced as a lump sum — behaviour is exactly what it was before this existed.
  if (per === null) return { priceCents: total, pricePerSessionCents: null }

  const derived = totalFromPerSession(per, input.sessionCount)

  // Ongoing (or an unreadable count): nothing to multiply by. Keep the total
  // that is already there rather than replacing a real price with zero.
  if (derived === null) return { priceCents: total, pricePerSessionCents: null }

  // One session: the derived total is right, but "per session" is not a thing
  // worth storing when there is only one of them.
  if (!canPricePerSession(input.sessionCount)) {
    return { priceCents: derived, pricePerSessionCents: null }
  }

  return { priceCents: derived, pricePerSessionCents: per }
}
