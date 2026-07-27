import type { CurrencyCode } from './pricing'

/**
 * Approximate FX rates to NZD, for INTERNAL admin reporting only.
 *
 * These are hand-maintained averages, not live rates. There is no FX feed in
 * this app, and adding one to draw a progress bar would buy a network
 * dependency and a failure mode for a number nobody invoices from.
 *
 * That trade-off is fine HERE and nowhere else:
 *  • Admin totals answer "roughly how big is the book" — a few percent of drift
 *    doesn't change the answer.
 *  • Anything a customer sees, is charged, or is invoiced for MUST stay in its
 *    own currency. Never convert money on a client-facing screen with these.
 *
 * Update them when they drift enough to matter. Last set: 2026-07-27.
 */
export const NZD_RATES: Record<CurrencyCode, number> = {
  NZD: 1,
  AUD: 1.09,
  GBP: 2.10,
  USD: 1.65,
  CAD: 1.20,
  ZAR: 0.09,
}

/** When these rates were last reviewed — shown in the admin UI so a stale number is visible rather than assumed fresh. */
export const NZD_RATES_UPDATED = '27 Jul 2026'

/**
 * Convert an amount in `currency` to approximate NZD.
 *
 * An unknown currency returns the amount unchanged rather than 0 — under-
 * reporting revenue silently is worse than reporting it un-converted, and a
 * currency we don't have a rate for is a bug to notice, not a number to hide.
 */
export function toNzd(amount: number, currency: CurrencyCode | string): number {
  const rate = NZD_RATES[currency as CurrencyCode]
  return rate == null ? amount : amount * rate
}

/** Sum a set of per-currency amounts into one approximate NZD figure. */
export function sumToNzd(rows: readonly { currency: CurrencyCode | string; amount: number }[]): number {
  return rows.reduce((n, r) => n + toNzd(r.amount, r.currency), 0)
}
