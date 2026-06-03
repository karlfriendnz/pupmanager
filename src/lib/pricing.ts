// Per-currency pricing for PupManager. Mirrored verbatim from the
// marketing site's `pupmanager-marketing/src/components/PricingTiers.tsx`
// so the in-app /billing/setup surface and the public /pricing page
// always quote the same number for the same currency. **The website is
// the source of truth — update PricingTiers.tsx and this file together.**
//
// Values are explicit per currency (no FX maths) — picked to land on
// round numbers people recognise locally rather than pegging to a rate.
//
// Pricing model (since 2026-06): a single "Core software" base, plus
// per-seat pricing for extra trainers, plus three toggleable add-ons.
// The first trainer is included in Core; each additional seat bills at
// SEAT_PRICE. Add-ons are optional recurring line items.

export type CurrencyCode = 'AUD' | 'NZD' | 'GBP' | 'CAD' | 'USD' | 'ZAR'

export const CURRENCIES: { code: CurrencyCode; symbol: string; label: string }[] = [
  { code: 'AUD', symbol: '$', label: 'AUD' },
  { code: 'NZD', symbol: '$', label: 'NZD' },
  { code: 'GBP', symbol: '£', label: 'GBP' },
  { code: 'CAD', symbol: '$', label: 'CAD' },
  { code: 'USD', symbol: '$', label: 'USD' },
  { code: 'ZAR', symbol: 'R', label: 'ZAR' },
]

// Core software — every core feature, unlimited clients/dogs, one trainer.
export const CORE_PRICE: Record<CurrencyCode, number> = {
  AUD: 45,
  NZD: 49,
  GBP: 25,
  CAD: 39,
  USD: 35,
  ZAR: 649,
}

// Extra trainer seats — billed per seat / month on top of Core. The
// first trainer is included, so a trainer with `seatCount` trainers
// pays for (seatCount - 1) seats.
export const SEAT_PRICE: Record<CurrencyCode, number> = {
  AUD: 36,
  NZD: 39,
  GBP: 19,
  CAD: 31,
  USD: 28,
  ZAR: 519,
}

export type AddonId = 'achievements' | 'shop' | 'ai'

export interface AddonDef {
  id: AddonId
  name: string
  description: string
  // Optional short status note (e.g. "In beta — graduates Q3").
  badge?: string
  price: Record<CurrencyCode, number>
}

// Toggleable add-ons. Prices mirror the website (all six currencies).
export const ADDONS: AddonDef[] = [
  {
    id: 'achievements',
    name: 'Client achievements',
    description: 'Branded badges your clients earn and share. Free marketing every time an owner posts a win.',
    price: { AUD: 18, NZD: 19, GBP: 9, CAD: 15, USD: 13, ZAR: 249 },
  },
  {
    id: 'shop',
    name: 'Client shop',
    description: 'In-app checkout for extras like leads, toys and gift cards. Branded with your name and colours.',
    price: { AUD: 27, NZD: 29, GBP: 15, CAD: 23, USD: 21, ZAR: 389 },
  },
  {
    id: 'ai',
    name: 'AI helper',
    description: 'Draft training plans from a few notes. Turn a month of sessions into a client-friendly update.',
    badge: 'In beta — graduates Q3',
    price: { AUD: 27, NZD: 29, GBP: 15, CAD: 23, USD: 21, ZAR: 389 },
  },
]

export function addonById(id: string): AddonDef | undefined {
  return ADDONS.find(a => a.id === id)
}

export function isAddonId(value: string): value is AddonId {
  return ADDONS.some(a => a.id === value)
}

export const PLAN_NAME = 'Core software'

// Back-compat: older surfaces imported SOLO_PRICE. Core is the new name
// for the same base price. Kept as an alias so nothing breaks mid-migration.
export const SOLO_PRICE = CORE_PRICE

export const DEFAULT_CURRENCY: CurrencyCode = 'NZD'

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCIES as { code: string }[]).some(c => c.code === value)
}

export function currencyMeta(code: CurrencyCode) {
  return CURRENCIES.find(c => c.code === code) ?? CURRENCIES.find(c => c.code === DEFAULT_CURRENCY)!
}

// Compute the monthly total for a given currency, seat count, and set of
// enabled add-on ids. Shared by /billing/setup (live total) and anywhere
// else we need to quote the full price.
export function monthlyTotal(
  currency: CurrencyCode,
  seatCount: number,
  enabledAddonIds: readonly string[],
): number {
  const seats = Math.max(0, seatCount - 1)
  const addonsTotal = ADDONS
    .filter(a => enabledAddonIds.includes(a.id))
    .reduce((sum, a) => sum + a.price[currency], 0)
  return CORE_PRICE[currency] + seats * SEAT_PRICE[currency] + addonsTotal
}
