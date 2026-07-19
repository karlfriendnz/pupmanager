import { describe, it, expect } from 'vitest'
import { scheduleDefaultsForRoles } from '@/lib/onboarding/schedule-defaults'

describe('scheduleDefaultsForRoles', () => {
  it('gives a groomer a midday lunch break', () => {
    const g = scheduleDefaultsForRoles(['groomer'])
    expect(g.windows).toHaveLength(2)
    // there is a real gap between the morning and afternoon windows
    expect(g.windows[0].end < g.windows[1].start).toBe(true)
    expect(g.windows[0].end).toBe('12:30')
    expect(g.windows[1].start).toBe('13:30')
  })

  it('lets a walker work straight through (no lunch split)', () => {
    const w = scheduleDefaultsForRoles(['walker'])
    expect(w.windows).toHaveLength(1)
  })

  it('gives trainers evening grid hours', () => {
    const t = scheduleDefaultsForRoles(['trainer'])
    expect(t.gridEnd).toBeGreaterThanOrEqual(20)
    expect(t.windows).toHaveLength(2) // lunch break
  })

  it('first matching trade wins for a mixed profile', () => {
    expect(scheduleDefaultsForRoles(['trainer', 'groomer'])).toEqual(scheduleDefaultsForRoles(['trainer']))
  })

  it('falls back to a plain weekday 9–5 when the trade is unknown', () => {
    const d = scheduleDefaultsForRoles([])
    expect(d.windows).toEqual([{ start: '09:00', end: '17:00' }])
    expect(d.days).toEqual([1, 2, 3, 4, 5])
  })
})
