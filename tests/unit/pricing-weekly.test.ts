import { describe, it, expect } from 'vitest'
import { CORE_WEEKLY, CORE_PRICE, SEAT_PRICE, ADDONS, weeklyFromMonthly, formatWeekly, monthlyTotal } from '@/lib/pricing'

// The public pricing page (pupmanager-marketing PricingWeekly.tsx) leads with a
// weekly figure; /billing/setup now does the same. These lock the two together —
// a trainer who reads "$10/wk" on the site must see "$10/wk" at checkout.
describe('weekly display matches the marketing site', () => {
  // Verbatim from PricingWeekly.tsx `baseWeekly`.
  const SITE_BASE_WEEKLY = { AUD: 10, NZD: 10, GBP: 5, CAD: 10, USD: 10, ZAR: 150 } as const

  it('Core weekly equals the website baseWeekly in every currency', () => {
    expect(CORE_WEEKLY).toEqual(SITE_BASE_WEEKLY)
  })

  it('the monthly figure is derived from weekly, not hand-typed', () => {
    for (const [c, wk] of Object.entries(SITE_BASE_WEEKLY)) {
      expect(CORE_PRICE[c as keyof typeof CORE_PRICE]).toBe(Math.round(wk * (52 / 12)))
    }
  })

  // weeklyNum in PricingWeekly.tsx: half-dollar steps under 20, whole above.
  it('weeklyFromMonthly reproduces the site rounding', () => {
    expect(weeklyFromMonthly(19)).toBe(4.5)   // achievements NZD
    expect(weeklyFromMonthly(29)).toBe(6.5)   // shop NZD
    expect(weeklyFromMonthly(39)).toBe(9)     // seat NZD
    expect(weeklyFromMonthly(10)).toBe(2.5)   // marketing NZD
    expect(weeklyFromMonthly(649)).toBe(150)  // whole numbers above 20
  })

  it('formats without trailing .00', () => {
    expect(formatWeekly(9)).toBe('9')
    expect(formatWeekly(4.5)).toBe('4.50')
  })

  it('every add-on and seat price converts to a sane weekly figure', () => {
    for (const a of ADDONS) {
      for (const c of Object.keys(SITE_BASE_WEEKLY) as (keyof typeof SEAT_PRICE)[]) {
        const wk = weeklyFromMonthly(a.price[c])
        expect(wk).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(wk)).toBe(true)
      }
    }
  })

  it('the NZD solo total reads as $10/wk', () => {
    expect(weeklyFromMonthly(monthlyTotal('NZD', 1, []))).toBe(10)
  })
})
