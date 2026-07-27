import { describe, it, expect } from 'vitest'
import { toNzd, sumToNzd, NZD_RATES } from '@/lib/fx'
import { CURRENCIES } from '@/lib/pricing'

// Approximate FX for the Super Admin totals only. These numbers decide what the
// ARR goal bar reads, so the maths is pinned even though the rates themselves
// are hand-maintained and expected to drift.

describe('converting admin totals to NZD', () => {
  it('leaves NZD alone', () => {
    expect(toNzd(1234, 'NZD')).toBe(1234)
  })

  it('converts a foreign amount using its rate', () => {
    expect(toNzd(100, 'GBP')).toBeCloseTo(100 * NZD_RATES.GBP, 6)
  })

  it('sums a mixed book into one NZD figure', () => {
    const total = sumToNzd([
      { currency: 'NZD', amount: 500 },
      { currency: 'GBP', amount: 100 },
    ])
    expect(total).toBeCloseTo(500 + 100 * NZD_RATES.GBP, 6)
  })

  it('passes an unknown currency through rather than zeroing it', () => {
    // Silently dropping revenue we can't convert would understate the book and
    // look like a downturn. Unconverted is wrong; missing is worse.
    expect(toNzd(250, 'JPY')).toBe(250)
  })

  it('has a rate for every currency the app actually sells in', () => {
    // A new currency added to pricing.ts without a rate here would be counted
    // at 1:1 and quietly skew the totals.
    for (const c of CURRENCIES) {
      expect(NZD_RATES[c.code], `no NZD rate for ${c.code}`).toBeGreaterThan(0)
    }
  })

  it('every rate is a sane positive number', () => {
    for (const [code, rate] of Object.entries(NZD_RATES)) {
      expect(rate, `${code} rate`).toBeGreaterThan(0)
      expect(rate, `${code} rate looks like a typo`).toBeLessThan(100)
    }
  })
})
