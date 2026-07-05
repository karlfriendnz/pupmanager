import { describe, it, expect } from 'vitest'
import {
  enumerateStartTimes,
  isTimeWithinAvailability,
  overlapsBusy,
  type AvailabilityRow,
  type BlackoutRow,
  type BusyInterval,
} from '../../src/lib/availability'

// A concrete future date used across the cases. As a one-off (date-specific)
// slot the weekday never matters, keeping the assertions deterministic.
const DATE = '2030-01-07'

function dateSlot(startTime: string, endTime: string): AvailabilityRow {
  return { id: 's', dayOfWeek: null, date: DATE, startTime, endTime }
}

describe('enumerateStartTimes', () => {
  it('walks a window from start to (end − duration) at the step', () => {
    const times = enumerateStartTimes([dateSlot('09:00', '17:00')], DATE, 60, [], 30)
    expect(times[0]).toBe('09:00')
    expect(times[times.length - 1]).toBe('16:00') // 60-min session still ends by 17:00
    expect(times).toHaveLength(15) // 09:00 → 16:00 inclusive, every 30 min
    expect(times).not.toContain('16:30') // would overrun the window
  })

  it('an 11:00–13:00 window with a 60-min session offers only 11:00/11:30/12:00 (never 2pm)', () => {
    const times = enumerateStartTimes([dateSlot('11:00', '13:00')], DATE, 60, [], 30)
    expect(times).toEqual(['11:00', '11:30', '12:00'])
    expect(times).not.toContain('14:00')
  })

  it('excludes windows too short for the session', () => {
    expect(enumerateStartTimes([dateSlot('09:00', '10:00')], DATE, 90, [], 30)).toEqual([])
  })

  it('yields nothing on a blackout day', () => {
    const blackouts: BlackoutRow[] = [{ startDate: DATE, endDate: DATE }]
    expect(enumerateStartTimes([dateSlot('09:00', '17:00')], DATE, 60, blackouts, 30)).toEqual([])
  })

  it('merges overlapping windows without duplicate start times', () => {
    const times = enumerateStartTimes(
      [dateSlot('09:00', '12:00'), dateSlot('10:00', '13:00')],
      DATE,
      60,
      [],
      30,
    )
    expect(new Set(times).size).toBe(times.length)
    expect(times).toContain('09:00')
    expect(times).toContain('12:00') // 12:00–13:00 from the second window
  })

  it('drops start times that would overlap an existing booking', () => {
    const busy: BusyInterval[] = [{ dateStr: DATE, startMin: 14 * 60, endMin: 15 * 60 }] // 14:00–15:00
    const times = enumerateStartTimes([dateSlot('09:00', '17:00')], DATE, 60, [], 30, busy)
    // A 60-min session starting 13:30/14:00/14:30 would run into the booked hour.
    expect(times).not.toContain('13:30')
    expect(times).not.toContain('14:00')
    expect(times).not.toContain('14:30')
    // Adjacent, non-overlapping starts survive: 13:00 ends 14:00, 15:00 starts on the hour.
    expect(times).toContain('13:00')
    expect(times).toContain('15:00')
  })

  it('ignores bookings on a different day', () => {
    const busy: BusyInterval[] = [{ dateStr: '2030-01-08', startMin: 14 * 60, endMin: 15 * 60 }]
    const times = enumerateStartTimes([dateSlot('09:00', '17:00')], DATE, 60, [], 30, busy)
    expect(times).toContain('14:00')
  })

  it('honours a recurring weekday slot on the matching day', () => {
    const isoDow = ((new Date(Date.UTC(2030, 0, 7)).getUTCDay() + 6) % 7) + 1
    const slot: AvailabilityRow = { id: 'r', dayOfWeek: isoDow, date: null, startTime: '08:00', endTime: '09:00' }
    expect(enumerateStartTimes([slot], DATE, 60, [], 30)).toEqual(['08:00'])
    // A different weekday's slot does not apply.
    const other: AvailabilityRow = { id: 'r2', dayOfWeek: (isoDow % 7) + 1, date: null, startTime: '08:00', endTime: '09:00' }
    expect(enumerateStartTimes([other], DATE, 60, [], 30)).toEqual([])
  })
})

describe('isTimeWithinAvailability', () => {
  const slots = [dateSlot('09:00', '17:00')]

  it('accepts a session that fits fully inside a window', () => {
    expect(isTimeWithinAvailability(slots, DATE, 10 * 60, 60)).toBe(true) // 10:00 + 60
  })

  it('accepts an in-window time even off the picker grid', () => {
    expect(isTimeWithinAvailability(slots, DATE, 9 * 60 + 7, 60)).toBe(true) // 09:07
  })

  it('rejects a session that overruns the window end', () => {
    expect(isTimeWithinAvailability(slots, DATE, 16 * 60 + 30, 60)).toBe(false) // 16:30 → 17:30
  })

  it('rejects a start before the window opens', () => {
    expect(isTimeWithinAvailability(slots, DATE, 8 * 60, 60)).toBe(false) // 08:00
  })

  it('rejects a blackout day even when the clock time fits', () => {
    const blackouts: BlackoutRow[] = [{ startDate: DATE, endDate: DATE }]
    expect(isTimeWithinAvailability(slots, DATE, 10 * 60, 60, blackouts)).toBe(false)
  })
})

describe('overlapsBusy', () => {
  const busy: BusyInterval[] = [{ dateStr: DATE, startMin: 14 * 60, endMin: 15 * 60 }] // 14:00–15:00

  it('detects a session running into a booked interval', () => {
    expect(overlapsBusy(busy, DATE, 13 * 60 + 30, 60)).toBe(true) // 13:30–14:30
  })

  it('detects a session starting inside a booked interval', () => {
    expect(overlapsBusy(busy, DATE, 14 * 60 + 15, 30)).toBe(true) // 14:15–14:45
  })

  it('allows a session that ends exactly when the booking starts (half-open)', () => {
    expect(overlapsBusy(busy, DATE, 13 * 60, 60)).toBe(false) // 13:00–14:00
  })

  it('allows a session that starts exactly when the booking ends', () => {
    expect(overlapsBusy(busy, DATE, 15 * 60, 60)).toBe(false) // 15:00–16:00
  })

  it('ignores bookings on other days', () => {
    expect(overlapsBusy(busy, '2030-01-08', 14 * 60, 60)).toBe(false)
  })
})
