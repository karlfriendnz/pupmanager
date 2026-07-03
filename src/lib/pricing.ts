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

export type AddonId = 'achievements' | 'shop' | 'ai' | 'marketing' | 'routeplanner' | 'timesheets' | 'todos' | 'leadmagnets' | 'xero' | 'googlecalendar' | 'clientapp' | 'notes' | 'classes' | 'library' | 'payments'

export interface AddonDef {
  id: AddonId
  name: string
  description: string
  // Optional short status note (e.g. "In beta — graduates Q3").
  badge?: string
  // When true the add-on is previewed but NOT sellable yet — it renders as a
  // disabled "coming soon" card, is excluded from checkout, and the toggle
  // endpoint refuses to enable it. Kept in this list (vs removed) so its price
  // still feeds totals for any trainer who already has it.
  comingSoon?: boolean
  // When true the add-on is included at no cost: it toggles on/off WITHOUT
  // touching Stripe and never appears at checkout (off until enabled, like every
  // add-on). Price is 0 in every currency.
  free?: boolean
  // When true this add-on is ON by default (a core feature living on the Add-ons
  // page), enabled unless the trainer explicitly turns it off. Contrast the
  // usual "off until enabled" add-ons. Implies free.
  defaultOn?: boolean
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
    id: 'marketing',
    name: 'Marketing',
    description: 'Email your clients in bulk — campaigns, win-backs and seasonal nudges — from your own brand, with open and click tracking.',
    price: { AUD: 9, NZD: 10, GBP: 5, CAD: 8, USD: 7, ZAR: 129 },
  },
  {
    id: 'routeplanner',
    name: 'Route planner',
    description: 'Plan the most efficient route between your visits, with drive-time and distance from your base — and from one client to the next.',
    price: { AUD: 9, NZD: 10, GBP: 5, CAD: 8, USD: 7, ZAR: 129 },
  },
  {
    id: 'leadmagnets',
    name: 'Lead magnets',
    description: 'Offer a free download behind a branded sign-up form. Prospects get the file by email and join your mailing list — embed it on your own site to grow your audience.',
    price: { AUD: 9, NZD: 10, GBP: 5, CAD: 8, USD: 7, ZAR: 129 },
  },
  {
    id: 'xero',
    name: 'Xero',
    description: 'Sync your invoices, payments and clients straight into your own Xero organisation — no double entry, always reconciled.',
    free: true,
    price: { AUD: 0, NZD: 0, GBP: 0, CAD: 0, USD: 0, ZAR: 0 },
  },
  {
    id: 'googlecalendar',
    name: 'Google Calendar',
    description: 'Push your sessions, classes and blocked-out time straight into your own Google Calendar — always up to date, on every device.',
    free: true,
    price: { AUD: 0, NZD: 0, GBP: 0, CAD: 0, USD: 0, ZAR: 0 },
  },
  {
    id: 'timesheets',
    name: 'Timesheets',
    description: 'Track the hours your team works across sessions, classes and admin, then turn them into payroll-ready totals.',
    free: true,
    price: { AUD: 0, NZD: 0, GBP: 0, CAD: 0, USD: 0, ZAR: 0 },
  },
  {
    id: 'todos',
    name: 'To-do & brain dump',
    description: 'A quick scratchpad on your dashboard — jot to-dos and brain-dump notes so nothing slips between sessions.',
    free: true,
    price: { AUD: 0, NZD: 0, GBP: 0, CAD: 0, USD: 0, ZAR: 0 },
  },
  {
    id: 'clientapp',
    name: 'Client app',
    description: 'Give your clients a branded app to see sessions, message you, and follow their dog’s progress. Turn off if you just want the admin side.',
    free: true,
    defaultOn: true,
    price: { AUD: 0, NZD: 0, GBP: 0, CAD: 0, USD: 0, ZAR: 0 },
  },
  {
    id: 'notes',
    name: 'Session notes',
    description: 'Record write-ups and progress notes against each session. Turn off for a simpler, notes-free session view.',
    free: true,
    defaultOn: true,
    price: { AUD: 0, NZD: 0, GBP: 0, CAD: 0, USD: 0, ZAR: 0 },
  },
  {
    id: 'classes',
    name: 'Group classes',
    description: 'Run class cohorts with shared sessions and enrolments. Turn off if you only do 1:1 work.',
    free: true,
    defaultOn: true,
    price: { AUD: 0, NZD: 0, GBP: 0, CAD: 0, USD: 0, ZAR: 0 },
  },
  {
    id: 'library',
    name: 'Training library',
    description: 'Build a reusable library of exercises and tasks to drop into sessions and homework.',
    free: true,
    defaultOn: true,
    price: { AUD: 0, NZD: 0, GBP: 0, CAD: 0, USD: 0, ZAR: 0 },
  },
  {
    // Not a normal toggle — enabling means connecting Stripe. The card is a link
    // to Settings → Payments; its "on" state mirrors connectChargesEnabled.
    id: 'payments',
    name: 'Client payments',
    description: 'Take card payments from clients for sessions and invoices — connect your Stripe and get paid in-app. Pay-as-you-go, no monthly fee.',
    free: true,
    price: { AUD: 0, NZD: 0, GBP: 0, CAD: 0, USD: 0, ZAR: 0 },
  },
  {
    id: 'ai',
    name: 'AI helper',
    description: 'Draft training plans from a few notes. Turn a month of sessions into a client-friendly update.',
    badge: 'Coming soon',
    comingSoon: true,
    price: { AUD: 27, NZD: 29, GBP: 15, CAD: 23, USD: 21, ZAR: 389 },
  },
]

export function addonById(id: string): AddonDef | undefined {
  return ADDONS.find(a => a.id === id)
}

export function isAddonId(value: string): value is AddonId {
  return ADDONS.some(a => a.id === value)
}

// Sellable through Stripe right now — excludes coming-soon previews (AI) AND
// free add-ons (timesheets), which never go through checkout.
export function isSellableAddon(id: string): boolean {
  const a = addonById(id)
  return !!a && !a.comingSoon && !a.free
}

// Included at no cost (toggles without Stripe, on by default).
export function isFreeAddon(id: string): boolean {
  return !!addonById(id)?.free
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
