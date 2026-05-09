// Per-currency pricing for the public Growth and (coming-soon)
// Enterprise tiers. Mirrored verbatim from the marketing site's
// `pupmanager-marketing/src/components/PricingTiers.tsx` so the in-app
// /billing/setup surface and the public /pricing page always quote the
// same number for the same currency. Update both files together.
//
// The values are explicit per currency (no FX maths) — we picked them
// to land on round numbers people recognise locally rather than
// pegging to a single rate.

export type CurrencyCode = 'AUD' | 'NZD' | 'GBP' | 'CAD' | 'USD' | 'ZAR'

export const CURRENCIES: { code: CurrencyCode; symbol: string; label: string }[] = [
  { code: 'AUD', symbol: '$', label: 'AUD' },
  { code: 'NZD', symbol: '$', label: 'NZD' },
  { code: 'GBP', symbol: '£', label: 'GBP' },
  { code: 'CAD', symbol: '$', label: 'CAD' },
  { code: 'USD', symbol: '$', label: 'USD' },
  { code: 'ZAR', symbol: 'R', label: 'ZAR' },
]

export const GROWTH_PRICE: Record<CurrencyCode, number> = {
  AUD: 38,
  NZD: 40,
  GBP: 20,
  CAD: 35,
  USD: 25,
  ZAR: 450,
}

export const ENTERPRISE_PRICE: Record<CurrencyCode, number> = {
  AUD: 76,
  NZD: 80,
  GBP: 40,
  CAD: 70,
  USD: 50,
  ZAR: 900,
}

export const DEFAULT_CURRENCY: CurrencyCode = 'NZD'

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCIES as { code: string }[]).some(c => c.code === value)
}

export function currencyMeta(code: CurrencyCode) {
  return CURRENCIES.find(c => c.code === code) ?? CURRENCIES.find(c => c.code === DEFAULT_CURRENCY)!
}
