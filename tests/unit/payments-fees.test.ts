import { describe, it, expect, vi, beforeEach } from 'vitest'

// The fee/markup/payout math is the money centerpiece. We import the real
// functions from @/lib/connect and assert their actual outputs. env.ts is
// mocked so PLATFORM_FEE_BPS is deterministic and we
// never touch process.env or a real Stripe key. './stripe' is mocked so the
// module graph never instantiates a Stripe client at import time.

const h = vi.hoisted(() => ({
  env: { PLATFORM_FEE_BPS: 0 },
}))

vi.mock('@/lib/env', () => ({ env: h.env }))
vi.mock('@/lib/stripe', () => ({
  stripeFor: vi.fn(() => ({})),
  isStripeConfigured: vi.fn(() => true),
}))

import {
  currencyForCountry,
  platformFeeBps,
  platformFeeAmount,
  estimateProcessingSurcharge,
} from '@/lib/connect'

beforeEach(() => {
  h.env.PLATFORM_FEE_BPS = 0
})

describe('currencyForCountry — payout currency defaulting', () => {
  it('maps known launch markets to their currency', () => {
    expect(currencyForCountry('NZ')).toBe('nzd')
    expect(currencyForCountry('AU')).toBe('aud')
    expect(currencyForCountry('GB')).toBe('gbp')
    expect(currencyForCountry('CA')).toBe('cad')
    expect(currencyForCountry('US')).toBe('usd')
    expect(currencyForCountry('ZA')).toBe('zar')
    expect(currencyForCountry('IE')).toBe('eur')
  })
  it('is case-insensitive on the country code', () => {
    expect(currencyForCountry('nz')).toBe('nzd')
    expect(currencyForCountry('gb')).toBe('gbp')
  })
  it('falls back to NZD for unknown / null / empty country', () => {
    expect(currencyForCountry('XX')).toBe('nzd')
    expect(currencyForCountry(null)).toBe('nzd')
    expect(currencyForCountry(undefined)).toBe('nzd')
    expect(currencyForCountry('')).toBe('nzd')
  })
})

describe('platformFeeAmount — application_fee (legacy, default 0)', () => {
  it('is 0 by default (direct charges take no application fee)', () => {
    expect(platformFeeBps()).toBe(0)
    expect(platformFeeAmount(10_000)).toBe(0)
    expect(platformFeeAmount(0)).toBe(0)
  })

  it('computes basis-point fee with banker-free rounding when a markup is configured', () => {
    h.env.PLATFORM_FEE_BPS = 500 // 5%
    expect(platformFeeBps()).toBe(500)
    expect(platformFeeAmount(10_000)).toBe(500) // 5% of $100.00
    // 5% of 10394 = 519.7 → rounds to 520
    expect(platformFeeAmount(10_394)).toBe(520)
    // 5% of 1 = 0.05 → rounds to 0
    expect(platformFeeAmount(1)).toBe(0)
    // 5% of 10 = 0.5 → rounds to 1 (Math.round)
    expect(platformFeeAmount(10)).toBe(1)
  })

  it('handles a zero total', () => {
    h.env.PLATFORM_FEE_BPS = 500
    expect(platformFeeAmount(0)).toBe(0)
  })
})

describe('estimateProcessingSurcharge — grossed-up card fee passed to the client', () => {
  // The contract: surcharge is added on top so that, after Stripe takes its
  // per-currency fee on the GROSSED-UP total, the trainer nets the original
  // amount. We assert the exact integer-cent outputs AND prove the net works out.

  it('NZD $100.00 → 394c surcharge (matches the shipped Stripe-verified figure)', () => {
    expect(estimateProcessingSurcharge(10_000, 'nzd')).toBe(394)
  })

  it('is case-insensitive on currency', () => {
    expect(estimateProcessingSurcharge(10_000, 'NZD')).toBe(394)
  })

  it('per-currency rates produce distinct surcharges', () => {
    expect(estimateProcessingSurcharge(10_000, 'aud')).toBe(Math.round((10_000 * 0.027 + 30) / (1 - 0.027)))
    expect(estimateProcessingSurcharge(5_000, 'gbp')).toBe(149) // 2.5% + 20c grossed up
    expect(estimateProcessingSurcharge(5_000, 'eur')).toBe(149) // same rate as gbp
    expect(estimateProcessingSurcharge(10_000, 'usd')).toBe(437) // 3.9% + 30c
    expect(estimateProcessingSurcharge(10_000, 'cad')).toBe(437)
  })

  it('uses the default rate (3.9% + 50c) for an unknown currency', () => {
    // zar isn't in SURCHARGE_RATES → SURCHARGE_DEFAULT { bps:390, fixed:50 }
    expect(estimateProcessingSurcharge(10_000, 'zar')).toBe(458)
    expect(estimateProcessingSurcharge(10_000, 'sgd')).toBe(458)
  })

  it('returns 0 for zero / negative amounts (no surcharge on a free item)', () => {
    expect(estimateProcessingSurcharge(0, 'nzd')).toBe(0)
    expect(estimateProcessingSurcharge(-500, 'nzd')).toBe(0)
  })

  it('still charges at least the fixed fee on tiny amounts', () => {
    // 1c NZD: (1*0.035 + 30) / (1-0.035) = 30.035/0.965 ≈ 31.1 → 31
    expect(estimateProcessingSurcharge(1, 'nzd')).toBe(31)
  })

  it('grosses up so the trainer nets the original amount after the real Stripe fee', () => {
    // Simulate Stripe taking the SAME per-currency rate on the grossed-up total.
    const cases: Array<[number, string, number, number]> = [
      [10_000, 'nzd', 350, 30],
      [10_000, 'usd', 390, 30],
      [5_000, 'gbp', 250, 20],
      [25_000, 'aud', 270, 30],
    ]
    for (const [amount, currency, bps, fixed] of cases) {
      const surcharge = estimateProcessingSurcharge(amount, currency)
      const grossTotal = amount + surcharge
      const stripeFee = Math.round(grossTotal * (bps / 10_000) + fixed)
      const net = grossTotal - stripeFee
      // Net should land on the original amount within a cent of rounding slack.
      expect(Math.abs(net - amount)).toBeLessThanOrEqual(1)
    }
  })
})

