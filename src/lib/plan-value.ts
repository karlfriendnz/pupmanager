// What a paying customer's subscription is worth to us, monthly and annually.
//
// Used by the Super Admin Businesses screen to show each ACTIVE customer's plan
// value and a grand MRR/ARR summary. The number is computed from the SAME
// pricing catalog (Core + per-seat + active add-ons) that /billing/setup and
// Stripe are wired from — see lib/pricing.monthlyTotal — so it always matches
// what the trainer is actually billed, without a per-row Stripe round-trip.
//
// Pure + dependency-free (no prisma, no Stripe): the caller batches the DB reads
// (payoutCurrency, seatCount, enabled add-on ids) and feeds them in, keeping the
// admin list free of N+1 queries. That also makes it trivially unit-testable.
import {
  monthlyTotal,
  isCurrencyCode,
  currencyMeta,
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from './pricing'

export interface PlanValue {
  // The customer's own billing/display currency.
  currency: CurrencyCode
  // Major units (whole dollars/pounds/rand), matching lib/pricing figures.
  monthly: number
  annual: number
}

/** A trainer's payoutCurrency, coerced to a known code (falls back to NZD). */
export function normaliseCurrency(payoutCurrency: string | null | undefined): CurrencyCode {
  return payoutCurrency && isCurrencyCode(payoutCurrency) ? payoutCurrency : DEFAULT_CURRENCY
}

/**
 * Monthly (and annual = monthly × 12) value of one customer's plan, in their
 * own currency. Reuses monthlyTotal so Core + seats + active add-ons are priced
 * from the catalog — never hardcoded.
 */
export function planValueFor(input: {
  payoutCurrency: string | null | undefined
  seatCount: number | null | undefined
  enabledAddonIds: readonly string[]
}): PlanValue {
  const currency = normaliseCurrency(input.payoutCurrency)
  const monthly = monthlyTotal(currency, input.seatCount ?? 1, input.enabledAddonIds)
  return { currency, monthly, annual: monthly * 12 }
}

export interface CurrencyTotal {
  currency: CurrencyCode
  symbol: string
  // How many paying customers billed in this currency.
  count: number
  mrr: number
  arr: number
}

/**
 * Group per-customer plan values by currency into MRR/ARR totals. Customers can
 * be in different currencies, so a single summed figure would be meaningless —
 * we keep each currency separate and let the caller show them side by side. The
 * dominant currency (largest MRR) leads.
 */
export function summarisePlanValues(values: readonly PlanValue[]): CurrencyTotal[] {
  const byCurrency = new Map<CurrencyCode, CurrencyTotal>()
  for (const v of values) {
    const t =
      byCurrency.get(v.currency) ??
      { currency: v.currency, symbol: currencyMeta(v.currency).symbol, count: 0, mrr: 0, arr: 0 }
    t.count += 1
    t.mrr += v.monthly
    t.arr += v.annual
    byCurrency.set(v.currency, t)
  }
  return [...byCurrency.values()].sort((a, b) => b.mrr - a.mrr)
}
