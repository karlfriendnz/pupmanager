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

describe('platformFeeAmount — our margin on a client payment', () => {
  // pupmanager.com/pricing advertises "3.5% + $0.30 /payment". These are direct
  // charges, so the trainer pays Stripe's rate; our cut is the gap up to 3.5%.
  it('takes the advertised spread over Stripe in each supported currency', () => {
    expect(platformFeeBps('nzd')).toBe(85)   // Stripe NZ 2.65% → 3.50%
    expect(platformFeeBps('aud')).toBe(180)  // Stripe AU 1.70% → 3.50%
    expect(platformFeeBps('gbp')).toBe(200)  // Stripe UK 1.50% → 3.50%
    expect(platformFeeBps('usd')).toBe(60)
    expect(platformFeeBps('cad')).toBe(60)
  })

  it('is case-insensitive about the currency', () => {
    expect(platformFeeBps('NZD')).toBe(85)
    expect(platformFeeAmount(10_000, 'NZD')).toBe(85)
  })

  it('takes NOTHING for a currency whose Stripe rate we have not confirmed', () => {
    // Better to earn 0 than to charge a trainer more than the pricing page promises.
    expect(platformFeeBps('zar')).toBe(0)
    expect(platformFeeAmount(10_000, 'zar')).toBe(0)
    expect(platformFeeBps('jpy')).toBe(0)
    expect(platformFeeAmount(10_000, 'jpy')).toBe(0)
  })

  it('charges the margin on the gross, in minor units', () => {
    expect(platformFeeAmount(10_000, 'nzd')).toBe(85)   // 0.85% of $100.00 = 85c
    expect(platformFeeAmount(5_000, 'aud')).toBe(90)    // 1.80% of $50.00 = 90c
    expect(platformFeeAmount(10_000, 'gbp')).toBe(200)  // 2.00% of £100.00 = £2
  })

  it('rounds to the nearest cent and never goes negative', () => {
    expect(platformFeeAmount(10_394, 'nzd')).toBe(88)   // 0.85% of 10394 = 88.3 → 88
    expect(platformFeeAmount(1, 'nzd')).toBe(0)         // rounds to nothing
    expect(platformFeeAmount(0, 'nzd')).toBe(0)
    expect(platformFeeAmount(-500, 'nzd')).toBe(0)
  })

  it('PLATFORM_FEE_BPS overrides every currency when set', () => {
    h.env.PLATFORM_FEE_BPS = 500 // 5%
    expect(platformFeeBps('nzd')).toBe(500)
    expect(platformFeeBps('zar')).toBe(500)
    expect(platformFeeAmount(10_000, 'nzd')).toBe(500)
  })
})

describe('estimateProcessingSurcharge — the client covers BOTH fees', () => {
  // The contract, in Karl's words: the trainer always nets what the thing costs;
  // Stripe's fee AND our margin go on top. So the gross-up rate must be
  // Stripe's rate + our margin — both are taken from the grossed-up total.

  it('nets the trainer EXACTLY the item price, in every currency', () => {
    // [amount, currency, Stripe's domestic rate, Stripe's fixed fee, our margin]
    const cases: Array<[number, string, number, number, number]> = [
      [10_000, 'nzd', 265, 30, 85],
      [10_000, 'aud', 170, 30, 180],
      [5_000, 'gbp', 150, 20, 200],
      [10_000, 'usd', 290, 30, 60],
      [25_000, 'cad', 290, 30, 60],
    ]
    for (const [amount, currency, stripeBps, fixed, ourBps] of cases) {
      const surcharge = estimateProcessingSurcharge(amount, currency)
      const clientPays = amount + surcharge
      const stripeFee = Math.round(clientPays * (stripeBps / 10_000)) + fixed
      const ourFee = platformFeeAmount(clientPays, currency)
      const trainerNets = clientPays - stripeFee - ourFee
      // Within a cent of the item price — rounding slack only, no leakage.
      expect(Math.abs(trainerNets - amount), `${currency} netted ${trainerNets} for ${amount}`)
        .toBeLessThanOrEqual(1)
    }
  })

  it('covers our margin too — a surcharge that only paid Stripe would short the trainer', () => {
    // AUD is the case that was broken: it grossed up at 2.7% while the true cost
    // is Stripe 1.7% + our 1.8% = 3.5%, so the trainer lost 0.8% of every payment.
    const stripeOnly = Math.round((10_000 + 30) / (1 - 0.017)) - 10_000
    expect(estimateProcessingSurcharge(10_000, 'aud')).toBeGreaterThan(stripeOnly)
  })

  it('is case-insensitive on currency', () => {
    expect(estimateProcessingSurcharge(10_000, 'NZD')).toBe(estimateProcessingSurcharge(10_000, 'nzd'))
  })

  it('returns 0 for zero / negative amounts (no surcharge on a free item)', () => {
    expect(estimateProcessingSurcharge(0, 'nzd')).toBe(0)
    expect(estimateProcessingSurcharge(-500, 'nzd')).toBe(0)
  })

  it('still charges at least the fixed fee on tiny amounts', () => {
    // The 30c fixed fee dominates a $1 sale — the client pays $1.35 so the
    // trainer still receives $1.00. Brutal proportionally, but correct.
    expect(estimateProcessingSurcharge(100, 'nzd')).toBe(35)
  })
})

