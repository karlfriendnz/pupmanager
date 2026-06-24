import { describe, it, expect } from 'vitest'
import { amountFor, hoursToMinutes, minutesToHours, mondayOf, money } from '@/lib/timesheets'

// Pure money/duration math for timesheets — the line-amount source of truth.

describe('amountFor — line total in cents', () => {
  it('computes hours × rate, rounded to the nearest cent', () => {
    // 90 min @ $80/h ($8000c) → 1.5h × 8000 = 12000c ($120.00)
    expect(amountFor(90, 8000)).toBe(12000)
    // 60 min @ $80/h → exactly the hourly rate
    expect(amountFor(60, 8000)).toBe(8000)
  })

  it('rounds to the nearest cent (banker-free Math.round)', () => {
    // 10 min @ $80/h → (10/60)*8000 = 1333.33… → 1333
    expect(amountFor(10, 8000)).toBe(1333)
    // 50 min @ $99/h ($9900c) → (50/60)*9900 = 8250 exactly
    expect(amountFor(50, 9900)).toBe(8250)
    // 7 min @ $123/h ($12300c) → (7/60)*12300 = 1435 exactly
    expect(amountFor(7, 12300)).toBe(1435)
  })

  it('returns 0 for zero/negative minutes', () => {
    expect(amountFor(0, 8000)).toBe(0)
    expect(amountFor(-30, 8000)).toBe(0)
  })

  it('returns 0 when the rate is null/undefined/zero (unrated line)', () => {
    expect(amountFor(60, null)).toBe(0)
    expect(amountFor(60, undefined)).toBe(0)
    expect(amountFor(60, 0)).toBe(0)
  })
})

describe('hoursToMinutes / minutesToHours round-trip', () => {
  it('converts hours to whole minutes', () => {
    expect(hoursToMinutes(1.5)).toBe(90)
    expect(hoursToMinutes(0.25)).toBe(15)
    // rounds to nearest minute
    expect(hoursToMinutes(0.111)).toBe(7) // 6.66 → 7
  })

  it('converts minutes to hours with 2dp', () => {
    expect(minutesToHours(90)).toBe(1.5)
    expect(minutesToHours(10)).toBe(0.17) // 0.1666… → 0.17
    expect(minutesToHours(0)).toBe(0)
  })
})

describe('mondayOf — canonical weekStart', () => {
  it('snaps a mid-week day back to the Monday (UTC) of its week', () => {
    // 2026-06-24 is a Wednesday → Monday 2026-06-22
    expect(mondayOf(new Date('2026-06-24T15:30:00Z')).toISOString()).toBe('2026-06-22T00:00:00.000Z')
  })

  it('leaves a Monday on the same day, time zeroed', () => {
    expect(mondayOf(new Date('2026-06-22T23:59:00Z')).toISOString()).toBe('2026-06-22T00:00:00.000Z')
  })

  it('snaps Sunday back to the PREVIOUS Monday (ISO week, Mon-start)', () => {
    // 2026-06-28 is a Sunday → Monday 2026-06-22 (six days earlier)
    expect(mondayOf(new Date('2026-06-28T12:00:00Z')).toISOString()).toBe('2026-06-22T00:00:00.000Z')
  })
})

describe('money — minor-unit formatting', () => {
  it('formats known symbol currencies', () => {
    expect(money(8050, 'nzd')).toBe('$80.50')
    expect(money(8050, 'gbp')).toBe('£80.50')
    expect(money(8050, 'eur')).toBe('€80.50')
  })

  it('defaults to nzd ($) when currency is null/undefined', () => {
    expect(money(100, null)).toBe('$1.00')
    expect(money(100, undefined)).toBe('$1.00')
  })

  it('falls back to a suffixed code for unknown currencies', () => {
    expect(money(100, 'jpy')).toBe('1.00 JPY')
  })

  it('always shows two decimal places', () => {
    expect(money(0, 'nzd')).toBe('$0.00')
    expect(money(5, 'nzd')).toBe('$0.05')
  })
})
