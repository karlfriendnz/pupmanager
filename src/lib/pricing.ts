// Per-currency pricing for the public Solo plan. Mirrored verbatim
// from the marketing site's `pupmanager-marketing/src/components/
// PricingTiers.tsx` so the in-app /billing/setup surface and the
// public /pricing page always quote the same number for the same
// currency. Update both files together.
//
// The values are explicit per currency (no FX maths) — we picked them
// to land on round numbers people recognise locally rather than
// pegging to a single rate.
//
// Marketing simplified to a single tier ("Solo plan · One trainer ·
// all features included"). Old GROWTH_PRICE / ENTERPRISE_PRICE are
// gone — re-add only when marketing reintroduces multi-tier.

export type CurrencyCode = 'AUD' | 'NZD' | 'GBP' | 'CAD' | 'USD' | 'ZAR'

export const CURRENCIES: { code: CurrencyCode; symbol: string; label: string }[] = [
  { code: 'AUD', symbol: '$', label: 'AUD' },
  { code: 'NZD', symbol: '$', label: 'NZD' },
  { code: 'GBP', symbol: '£', label: 'GBP' },
  { code: 'CAD', symbol: '$', label: 'CAD' },
  { code: 'USD', symbol: '$', label: 'USD' },
  { code: 'ZAR', symbol: 'R', label: 'ZAR' },
]

// Solo plan — single trainer, all features included.
export const SOLO_PRICE: Record<CurrencyCode, number> = {
  AUD: 45,
  NZD: 49,
  GBP: 23,
  CAD: 41,
  USD: 30,
  ZAR: 540,
}

export const PLAN_NAME = 'Solo plan'

export const DEFAULT_CURRENCY: CurrencyCode = 'NZD'

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCIES as { code: string }[]).some(c => c.code === value)
}

export function currencyMeta(code: CurrencyCode) {
  return CURRENCIES.find(c => c.code === code) ?? CURRENCIES.find(c => c.code === DEFAULT_CURRENCY)!
}
