import { describe, it, expect } from 'vitest'
import {
  canPricePerSession,
  totalFromPerSession,
  resolvePackagePricing,
  PER_SESSION_MIN_SESSIONS,
} from '@/lib/session-pricing'

// Per-session pricing is an INTENT sitting over an unchanged total.
//
// `priceCents` is what the rest of the app bills on, so the thing worth testing
// is that it always ends up agreeing with the per-session figure the trainer
// typed — including the two cases where the arithmetic would otherwise lie: an
// ongoing offering (no session count to multiply by) and a session count that
// changes after the price was set.

const $ = (dollars: number) => dollars * 100

describe('whether per-session pricing is on offer at all', () => {
  it('is offered once there is more than one session', () => {
    expect(canPricePerSession(2)).toBe(true)
    expect(canPricePerSession(6)).toBe(true)
    expect(canPricePerSession(PER_SESSION_MIN_SESSIONS)).toBe(true)
  })

  it('is not offered for a single session — the per-session price IS the total', () => {
    expect(canPricePerSession(1)).toBe(false)
  })

  it('is not offered for an ongoing offering, which has no session count', () => {
    expect(canPricePerSession(0)).toBe(false)
  })

  it('is not offered for a count that cannot be read', () => {
    expect(canPricePerSession(null)).toBe(false)
    expect(canPricePerSession(undefined)).toBe(false)
    expect(canPricePerSession(Number.NaN)).toBe(false)
  })
})

describe('the total a per-session price adds up to', () => {
  it('multiplies out', () => {
    expect(totalFromPerSession($(30), 4)).toBe($(120))
  })

  it('is null when there is no per-session price', () => {
    expect(totalFromPerSession(null, 4)).toBeNull()
    expect(totalFromPerSession(undefined, 4)).toBeNull()
  })

  it('is null for an ongoing offering rather than zero', () => {
    expect(totalFromPerSession($(30), 0)).toBeNull()
  })

  it('stays in whole cents', () => {
    // 33.33 a session across 3 sessions — no fractional cent may survive.
    expect(totalFromPerSession(3333, 3)).toBe(9999)
    expect(Number.isInteger(totalFromPerSession(3333, 3)!)).toBe(true)
  })
})

describe('settling an offering price', () => {
  it('leaves a lump-sum price exactly as it was', () => {
    expect(resolvePackagePricing({ priceCents: $(120), sessionCount: 4 }))
      .toEqual({ priceCents: $(120), pricePerSessionCents: null })
  })

  it('keeps an unpriced offering unpriced', () => {
    expect(resolvePackagePricing({ priceCents: null, sessionCount: 4 }))
      .toEqual({ priceCents: null, pricePerSessionCents: null })
  })

  it('derives the total from the per-session price, and keeps the intent', () => {
    expect(resolvePackagePricing({ pricePerSessionCents: $(30), sessionCount: 4 }))
      .toEqual({ priceCents: $(120), pricePerSessionCents: $(30) })
  })

  it('ignores a stale total when a per-session price is set', () => {
    // The lump-sum field still holds an old figure; the per-session price wins.
    expect(resolvePackagePricing({ pricePerSessionCents: $(30), priceCents: $(999), sessionCount: 4 }))
      .toEqual({ priceCents: $(120), pricePerSessionCents: $(30) })
  })

  it('re-totals when the session count changes — the whole point', () => {
    const priced = resolvePackagePricing({ pricePerSessionCents: $(30), sessionCount: 4 })
    expect(priced).toEqual({ priceCents: $(120), pricePerSessionCents: $(30) })

    // The trainer lengthens the course. Re-settling from the stored intent is
    // what stops $120 outliving the four sessions it was the total for.
    const grown = resolvePackagePricing({
      pricePerSessionCents: priced.pricePerSessionCents,
      priceCents: priced.priceCents,
      sessionCount: 6,
    })
    expect(grown).toEqual({ priceCents: $(180), pricePerSessionCents: $(30) })

    const shrunk = resolvePackagePricing({
      pricePerSessionCents: grown.pricePerSessionCents,
      priceCents: grown.priceCents,
      sessionCount: 3,
    })
    expect(shrunk).toEqual({ priceCents: $(90), pricePerSessionCents: $(30) })
  })

  it('collapses to a plain total when the offering drops to one session', () => {
    // One session at $30 IS $30 — the derived figure is right, but there is
    // nothing left for "per session" to express, so the intent is dropped.
    expect(resolvePackagePricing({ pricePerSessionCents: $(30), priceCents: $(120), sessionCount: 1 }))
      .toEqual({ priceCents: $(30), pricePerSessionCents: null })
  })

  it('never zeroes an ongoing offering — 0 sessions keeps the total it had', () => {
    // The dangerous case: 0 x $30 = $0 would wipe a real price on save.
    expect(resolvePackagePricing({ pricePerSessionCents: $(30), priceCents: $(120), sessionCount: 0 }))
      .toEqual({ priceCents: $(120), pricePerSessionCents: null })
  })

  it('leaves an ongoing offering unpriced rather than free', () => {
    expect(resolvePackagePricing({ pricePerSessionCents: $(30), priceCents: null, sessionCount: 0 }))
      .toEqual({ priceCents: null, pricePerSessionCents: null })
  })

  it('drops the intent when the session count cannot be read', () => {
    expect(resolvePackagePricing({ pricePerSessionCents: $(30), priceCents: $(120), sessionCount: null }))
      .toEqual({ priceCents: $(120), pricePerSessionCents: null })
  })

  it('is idempotent — re-saving an unchanged offering changes nothing', () => {
    const once = resolvePackagePricing({ pricePerSessionCents: $(30), sessionCount: 4 })
    const twice = resolvePackagePricing({ ...once, sessionCount: 4 })
    expect(twice).toEqual(once)
  })

  it('handles a free per-session price without being mistaken for unpriced', () => {
    expect(resolvePackagePricing({ pricePerSessionCents: 0, sessionCount: 4 }))
      .toEqual({ priceCents: 0, pricePerSessionCents: 0 })
  })
})
