import { describe, it, expect } from 'vitest'
import { buildRepeatOptions, rruleToSummary, parseRule, cadenceFromRule } from '@/lib/recurrence'

describe('buildRepeatOptions', () => {
  it('names the day off a base date (Google-Calendar style)', () => {
    // 2026-07-21 is a Tuesday.
    const opts = buildRepeatOptions(new Date(2026, 6, 21))
    expect(opts.find(o => o.label === 'Weekly on Tuesday')?.value).toBe('FREQ=WEEKLY;BYDAY=TU')
    expect(opts.some(o => o.value === 'CUSTOM')).toBe(true)
    expect(opts[0]).toEqual({ label: 'Does not repeat', value: 'NONE' })
  })

  it('falls back to generic labels with no date', () => {
    const opts = buildRepeatOptions(null)
    expect(opts.find(o => o.value === 'FREQ=WEEKLY')?.label).toBe('Weekly')
  })
})

describe('rruleToSummary', () => {
  it('does not repeat for empty/NONE', () => {
    expect(rruleToSummary('')).toBe('Does not repeat')
    expect(rruleToSummary('NONE')).toBe('Does not repeat')
  })
  it('weekly on a day', () => {
    expect(rruleToSummary('FREQ=WEEKLY;BYDAY=TU')).toBe('Repeats every week on Tuesday')
  })
  it('interval + multiple days + count', () => {
    expect(rruleToSummary('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=8'))
      .toBe('Repeats every 2 weeks on Monday and Wednesday for 8 occurrences')
  })
  it('monthly by day-of-month', () => {
    expect(rruleToSummary('FREQ=MONTHLY;BYMONTHDAY=15')).toBe('Repeats every month on day 15')
  })
})

describe('parseRule', () => {
  it('splits into parts', () => {
    expect(parseRule('FREQ=WEEKLY;INTERVAL=2')).toEqual({ FREQ: 'WEEKLY', INTERVAL: '2' })
  })
  it('empty for none', () => {
    expect(parseRule('NONE')).toEqual({})
  })
})

describe('cadenceFromRule (bridge to sessionCount/weeksBetween)', () => {
  it('weekly interval maps to weeksBetween; count maps to sessionCount', () => {
    expect(cadenceFromRule('FREQ=WEEKLY;INTERVAL=2;COUNT=8')).toEqual({ sessionCount: 8, weeksBetween: 2 })
  })
  it('no count = ongoing (0)', () => {
    expect(cadenceFromRule('FREQ=WEEKLY;BYDAY=TU')).toEqual({ sessionCount: 0, weeksBetween: 1 })
  })
  it('non-weekly frequencies fall back to weeksBetween 1', () => {
    expect(cadenceFromRule('FREQ=MONTHLY;COUNT=6')).toEqual({ sessionCount: 6, weeksBetween: 1 })
  })
})
