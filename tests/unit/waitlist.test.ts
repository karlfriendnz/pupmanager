import { describe, it, expect, vi } from 'vitest'

// Pure-logic test: stub prisma so importing the module doesn't spin up a
// real client (matches founder/class-runs test pattern).
vi.mock('../../src/lib/prisma', () => ({ prisma: {} }))

import { matchesOpening, nextPriority, type WaitlistPrefs } from '../../src/lib/waitlist'

const ANY: WaitlistPrefs = {
  preferredDays: [],
  preferredTimeStart: null,
  preferredTimeEnd: null,
  earliestStart: null,
}

describe('matchesOpening', () => {
  it('no constraints → matches anything', () => {
    expect(matchesOpening(ANY, { date: new Date('2026-06-01'), weekday: 1, time: '09:00' })).toBe(true)
  })

  it('respects preferred weekdays', () => {
    const p = { ...ANY, preferredDays: [2, 4] } // Tue/Thu
    expect(matchesOpening(p, { date: new Date('2026-06-02'), weekday: 2, time: '10:00' })).toBe(true)
    expect(matchesOpening(p, { date: new Date('2026-06-01'), weekday: 1, time: '10:00' })).toBe(false)
  })

  it('respects the time window', () => {
    const p = { ...ANY, preferredTimeStart: '17:00', preferredTimeEnd: '20:00' }
    expect(matchesOpening(p, { date: new Date('2026-06-01'), weekday: 1, time: '18:30' })).toBe(true)
    expect(matchesOpening(p, { date: new Date('2026-06-01'), weekday: 1, time: '09:00' })).toBe(false)
    expect(matchesOpening(p, { date: new Date('2026-06-01'), weekday: 1, time: '21:00' })).toBe(false)
  })

  it('open-ended time bounds (only start, or only end)', () => {
    expect(matchesOpening({ ...ANY, preferredTimeStart: '12:00' }, { date: new Date(), weekday: 3, time: '13:00' })).toBe(true)
    expect(matchesOpening({ ...ANY, preferredTimeStart: '12:00' }, { date: new Date(), weekday: 3, time: '11:00' })).toBe(false)
    expect(matchesOpening({ ...ANY, preferredTimeEnd: '12:00' }, { date: new Date(), weekday: 3, time: '11:00' })).toBe(true)
  })

  it('respects earliest start date', () => {
    const p = { ...ANY, earliestStart: new Date('2026-07-01') }
    expect(matchesOpening(p, { date: new Date('2026-07-05'), weekday: 1, time: '09:00' })).toBe(true)
    expect(matchesOpening(p, { date: new Date('2026-06-20'), weekday: 1, time: '09:00' })).toBe(false)
  })

  it('all constraints must hold together', () => {
    const p: WaitlistPrefs = {
      preferredDays: [6],
      preferredTimeStart: '08:00',
      preferredTimeEnd: '12:00',
      earliestStart: new Date('2026-06-01'),
    }
    expect(matchesOpening(p, { date: new Date('2026-06-06'), weekday: 6, time: '09:30' })).toBe(true)
    // right day + time but too early
    expect(matchesOpening(p, { date: new Date('2026-05-30'), weekday: 6, time: '09:30' })).toBe(false)
  })
})

describe('nextPriority', () => {
  it('starts at 0 for an empty list', () => {
    expect(nextPriority(null)).toBe(0)
    expect(nextPriority(undefined)).toBe(0)
  })
  it('appends after the current max', () => {
    expect(nextPriority(4)).toBe(5)
  })
})
