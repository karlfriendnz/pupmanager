import { describe, it, expect, vi } from 'vitest'

// Stub infra so importing the modules doesn't spin up a real PrismaClient.
vi.mock('../../src/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/generated/prisma', () => ({}))

import { noteToStart } from '../../src/lib/demo-seed'
import { generateSessionDates } from '../../src/lib/class-runs'

// Dates are built with the local-time constructor and asserted with
// getDay()/getHours(), so these are timezone-independent.
const WED_JUN_3 = () => new Date(2026, 5, 3, 9, 0, 0) // 2026-06-03 is a Wednesday

describe('noteToStart — aligns a class start to its scheduleNote', () => {
  it('snaps forward to the named weekday and sets the time (Thursday 7pm)', () => {
    const d = noteToStart(WED_JUN_3(), 'Thursdays · 7:00pm')
    expect(d.getDay()).toBe(4)        // Thursday
    expect(d.getDate()).toBe(4)       // Jun 4 — one day after the Wed base
    expect(d.getHours()).toBe(19)
    expect(d.getMinutes()).toBe(0)
  })

  it('handles am times (Saturday 10am)', () => {
    const d = noteToStart(WED_JUN_3(), 'Saturdays · 10:00am')
    expect(d.getDay()).toBe(6)
    expect(d.getHours()).toBe(10)
  })

  it('wraps around the week (Tuesday from a Wednesday base → next Tuesday)', () => {
    const d = noteToStart(WED_JUN_3(), 'Tuesdays · 6:00pm')
    expect(d.getDay()).toBe(2)
    expect(d.getDate()).toBe(9)       // 6 days forward
    expect(d.getHours()).toBe(18)
  })

  it('same weekday as the base stays on the base date (diff 0)', () => {
    const d = noteToStart(WED_JUN_3(), 'Wednesdays · 9:00am')
    expect(d.getDate()).toBe(3)
    expect(d.getHours()).toBe(9)
  })

  it('12-hour edges: 12:00pm = noon, 12:00am = midnight', () => {
    expect(noteToStart(WED_JUN_3(), 'Sundays · 12:00pm').getHours()).toBe(12)
    expect(noteToStart(WED_JUN_3(), 'Mondays · 12:00am').getHours()).toBe(0)
  })

  it('no weekday in the note → keeps the base day, applies the time', () => {
    const d = noteToStart(WED_JUN_3(), 'Weekly · 6:00pm')
    expect(d.getDate()).toBe(3)       // unchanged
    expect(d.getHours()).toBe(18)
  })

  it('no time in the note → defaults to 18:00', () => {
    const d = noteToStart(WED_JUN_3(), 'Thursdays')
    expect(d.getDay()).toBe(4)
    expect(d.getHours()).toBe(18)
    expect(d.getMinutes()).toBe(0)
  })
})

describe('class session series keeps the aligned weekday', () => {
  it('weekly sessions all fall on the note weekday at the note time', () => {
    const start = noteToStart(WED_JUN_3(), 'Thursdays · 7:00pm')
    const dates = generateSessionDates(start, 6, 1)
    expect(dates).toHaveLength(6)
    for (const d of dates) {
      expect(d.getDay()).toBe(4)      // every session is a Thursday
      expect(d.getHours()).toBe(19)
    }
  })

  it('fortnightly sessions also stay on the same weekday', () => {
    const start = noteToStart(WED_JUN_3(), 'Saturdays · 10:00am')
    const dates = generateSessionDates(start, 4, 2)
    expect(dates.map(d => d.getDay())).toEqual([6, 6, 6, 6])
    // 2 weeks apart
    expect((dates[1].getTime() - dates[0].getTime()) / 86_400_000).toBe(14)
  })
})
