import { describe, it, expect } from 'vitest'
import {
  platformFeeBps,
  platformFeeAmount,
  processingRate,
  processingRateLabel,
  estimateProcessingSurcharge,
} from '@/lib/connect'
import { CURRENCIES } from '@/lib/pricing'

// Mersea Mutts reported ~4.7% processing fees against an expected 2.5% + 20p.
// Their Stripe statement fitted 3.5% + 20p exactly on every domestic-card row
// (£30 → £1.25, £70 → £2.65, £75 → £2.83), because GBP carried a 2% margin
// while the settings screen promised 2.5% all-in. They stopped taking payments
// over it.
//
// We take 1%. Full stop, every currency (Karl, 2026-07-28). These tests pin
// that, and pin the thing that actually caused the bug: a customer-facing quote
// written by hand, free to drift from the fee it describes.

describe('our margin', () => {
  it('is 1%, in every currency we sell in', () => {
    for (const c of CURRENCIES) {
      expect(platformFeeBps(c.code), `${c.code} margin`).toBe(100)
    }
  })

  it('is 1% for a currency we have never heard of, not zero and not a guess', () => {
    expect(platformFeeBps('sek')).toBe(100)
  })

  it('takes 1% of the gross', () => {
    expect(platformFeeAmount(7000, 'gbp')).toBe(70)
    expect(platformFeeAmount(3000, 'gbp')).toBe(30)
  })

  it('takes nothing from a zero or negative amount', () => {
    expect(platformFeeAmount(0, 'gbp')).toBe(0)
    expect(platformFeeAmount(-500, 'gbp')).toBe(0)
  })
})

describe('what a trainer actually pays, all in', () => {
  // Stripe's domestic rate + our 1%.
  const EXPECTED: Record<string, { label: string; bps: number; fixed: number }> = {
    gbp: { label: '2.5%', bps: 250, fixed: 20 },
    aud: { label: '2.7%', bps: 270, fixed: 30 },
    nzd: { label: '3.65%', bps: 365, fixed: 30 },
    usd: { label: '3.9%', bps: 390, fixed: 30 },
    cad: { label: '3.9%', bps: 390, fixed: 30 },
    zar: { label: '3.9%', bps: 390, fixed: 50 },
  }

  for (const [cur, want] of Object.entries(EXPECTED)) {
    it(`${cur} is ${want.label}`, () => {
      expect(processingRate(cur)).toEqual({ bps: want.bps, fixed: want.fixed })
      expect(processingRateLabel(cur)).toBe(want.label)
    })
  }

  it('reproduces the Mersea Mutts statement, at the rate we now charge', () => {
    // The rows that were £1.25 / £2.65 / £2.83 at the old 3.5%.
    const fee = (gross: number) => {
      const { bps, fixed } = processingRate('gbp')
      return Math.round((gross * bps) / 10_000) + fixed
    }
    expect(fee(3000)).toBe(95)   // was 125
    expect(fee(7000)).toBe(195)  // was 265
    expect(fee(7500)).toBe(208)  // was 283
  })

  it('never prints a trailing zero — a rate reads 2.5%, not 2.50%', () => {
    for (const c of CURRENCIES) {
      expect(processingRateLabel(c.code)).not.toMatch(/\.\d0%$/)
    }
  })
})

describe('the surcharge and the fee cannot drift apart', () => {
  // The settings screen quoting one number while we charged another is what hit
  // Mersea Mutts. Anything customer-facing derives from processingRate now.
  it('grosses up so the trainer nets exactly what they sold, in every currency', () => {
    for (const c of CURRENCIES) {
      const cur = c.code.toLowerCase()
      const price = 5000
      const gross = price + estimateProcessingSurcharge(price, cur)
      const { bps, fixed } = processingRate(cur)
      const cost = Math.round((gross * bps) / 10_000) + fixed
      // Within a minor unit — the gross-up solves a continuous equation and the
      // fee is then rounded to whole cents.
      expect(Math.abs(gross - cost - price), `${c.code} nets short`).toBeLessThanOrEqual(1)
    }
  })

  it('surcharges nothing on a zero amount', () => {
    expect(estimateProcessingSurcharge(0, 'gbp')).toBe(0)
  })
})
