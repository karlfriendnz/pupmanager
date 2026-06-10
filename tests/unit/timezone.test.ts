import { describe, it, expect } from 'vitest'

// Pure-logic tests — the timezone helpers take no DB/env, so no mocking needed.
// These guard the most dangerous class of bug in the app: day-boundary queries
// landing in the wrong UTC window (which is exactly what broke the route day
// picker), and DST offsets being ignored.
import { zonedToUtc, startOfDayInTz, endOfDayInTz, todayInTz } from '../../src/lib/timezone'

describe('startOfDayInTz', () => {
  it('maps NZ midnight (UTC+12, no DST in June) to the prior-day noon UTC', () => {
    // 2026-06-10 00:00 Pacific/Auckland === 2026-06-09 12:00:00 UTC
    expect(startOfDayInTz('2026-06-10', 'Pacific/Auckland').toISOString())
      .toBe('2026-06-09T12:00:00.000Z')
  })

  it('handles NZDT (UTC+13) in January', () => {
    // 2026-01-10 00:00 Pacific/Auckland (daylight time, +13) === 2026-01-09 11:00 UTC
    expect(startOfDayInTz('2026-01-10', 'Pacific/Auckland').toISOString())
      .toBe('2026-01-09T11:00:00.000Z')
  })

  it('is DST-aware for America/New_York (EDT in summer, EST in winter)', () => {
    // EDT = UTC-4 → midnight is 04:00 UTC
    expect(startOfDayInTz('2026-07-01', 'America/New_York').toISOString())
      .toBe('2026-07-01T04:00:00.000Z')
    // EST = UTC-5 → midnight is 05:00 UTC
    expect(startOfDayInTz('2026-01-01', 'America/New_York').toISOString())
      .toBe('2026-01-01T05:00:00.000Z')
  })

  it('treats UTC as a no-op', () => {
    expect(startOfDayInTz('2026-06-10', 'UTC').toISOString())
      .toBe('2026-06-10T00:00:00.000Z')
  })
})

describe('endOfDayInTz', () => {
  it('is the last millisecond of the local day, in UTC', () => {
    // 2026-06-10 23:59:59.999 Pacific/Auckland === 2026-06-10 11:59:59.999 UTC
    expect(endOfDayInTz('2026-06-10', 'Pacific/Auckland').toISOString())
      .toBe('2026-06-10T11:59:59.999Z')
  })

  it('brackets a full local day with startOfDayInTz (≈24h apart)', () => {
    const start = startOfDayInTz('2026-06-10', 'Pacific/Auckland').getTime()
    const end = endOfDayInTz('2026-06-10', 'Pacific/Auckland').getTime()
    const hours = (end - start) / 3_600_000
    expect(hours).toBeGreaterThan(23.99)
    expect(hours).toBeLessThan(24)
  })
})

describe('zonedToUtc', () => {
  it('round-trips a specific wall-clock time in NZ to the right UTC instant', () => {
    // 2026-06-10 09:00 NZST (+12) === 2026-06-09 21:00 UTC
    expect(zonedToUtc(2026, 6, 10, 9, 0, 'Pacific/Auckland').toISOString())
      .toBe('2026-06-09T21:00:00.000Z')
  })
})

describe('todayInTz', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayInTz('Pacific/Auckland')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('agrees with the UTC calendar date when asked for UTC', () => {
    const now = new Date()
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
    expect(todayInTz('UTC')).toBe(expected)
  })
})
