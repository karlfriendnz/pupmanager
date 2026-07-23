import { describe, it, expect } from 'vitest'
import {
  buildRepeatOptions, rruleToSummary, parseRule, cadenceFromRule,
  expandRule, rollForwardToWeekday, OPEN_ENDED_OCCURRENCES,
} from '@/lib/recurrence'

// Local-date helper — expandRule is date-only, so build dates the same way.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day)
const iso = (x: Date) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`

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

describe('rollForwardToWeekday', () => {
  it('leaves a date already on the wanted weekday alone', () => {
    // 2026-07-21 is a Tuesday (day 2).
    expect(iso(rollForwardToWeekday(d(2026, 7, 21), 2))).toBe('2026-07-21')
  })
  it('moves forward, never back', () => {
    // Tuesday → the next Saturday (day 6), not the previous one.
    expect(iso(rollForwardToWeekday(d(2026, 7, 21), 6))).toBe('2026-07-25')
    // Tuesday → Monday is 6 days ahead, not yesterday.
    expect(iso(rollForwardToWeekday(d(2026, 7, 21), 1))).toBe('2026-07-27')
  })
})

describe('expandRule', () => {
  const start = d(2026, 7, 21) // a Tuesday

  it('a one-off yields just the start date', () => {
    expect(expandRule('', start).map(iso)).toEqual(['2026-07-21'])
    expect(expandRule('NONE', start).map(iso)).toEqual(['2026-07-21'])
  })

  it('weekly repeats every 7 days, capped by COUNT', () => {
    expect(expandRule('FREQ=WEEKLY;BYDAY=TU;COUNT=3', start).map(iso)).toEqual([
      '2026-07-21', '2026-07-28', '2026-08-04',
    ])
  })

  it('honours INTERVAL', () => {
    expect(expandRule('FREQ=WEEKLY;INTERVAL=2;COUNT=3', start).map(iso)).toEqual([
      '2026-07-21', '2026-08-04', '2026-08-18',
    ])
  })

  it('stops at UNTIL even when COUNT would allow more', () => {
    const out = expandRule('FREQ=WEEKLY;COUNT=10;UNTIL=20260805', start).map(iso)
    expect(out).toEqual(['2026-07-21', '2026-07-28', '2026-08-04'])
  })

  it('an open-ended rule generates a rolling horizon, not forever', () => {
    // This is what makes a drop-in class bookable: no COUNT, no UNTIL, but the
    // client still needs months of sessions to pick from.
    const out = expandRule('FREQ=WEEKLY;BYDAY=TU', start)
    expect(out).toHaveLength(OPEN_ENDED_OCCURRENCES)
    expect(iso(out[0])).toBe('2026-07-21')
  })

  it('respects an explicit max below the default horizon', () => {
    expect(expandRule('FREQ=WEEKLY', start, 2).map(iso)).toEqual(['2026-07-21', '2026-07-28'])
    expect(expandRule('FREQ=WEEKLY', start, 0)).toEqual([])
  })

  it('multi-day weekly emits each listed weekday, in order', () => {
    // Mon + Wed, starting from a Tuesday: the first Monday is next week, so the
    // Wednesday of the START week comes first.
    const out = expandRule('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4', start).map(iso)
    expect(out).toEqual(['2026-07-22', '2026-07-27', '2026-07-29', '2026-08-03'])
  })

  it('daily steps a day at a time', () => {
    expect(expandRule('FREQ=DAILY;COUNT=3', start).map(iso)).toEqual([
      '2026-07-21', '2026-07-22', '2026-07-23',
    ])
  })

  it('monthly by day-of-month clamps to short months', () => {
    // The 31st: August has one, September doesn't — it must not roll into October.
    const out = expandRule('FREQ=MONTHLY;COUNT=3', d(2026, 7, 31)).map(iso)
    expect(out).toEqual(['2026-07-31', '2026-08-31', '2026-09-30'])
  })

  it('monthly on the nth weekday (Google-Calendar style)', () => {
    // "the third Tuesday" — 2026-07-21 is the 3rd Tuesday of July.
    const out = expandRule('FREQ=MONTHLY;BYDAY=3TU;COUNT=3', start).map(iso)
    expect(out).toEqual(['2026-07-21', '2026-08-18', '2026-09-15'])
  })

  it('monthly on the LAST weekday', () => {
    const out = expandRule('FREQ=MONTHLY;BYDAY=-1FR;COUNT=2', d(2026, 7, 31)).map(iso)
    expect(out).toEqual(['2026-07-31', '2026-08-28'])
  })

  it('never emits a date before the start', () => {
    for (const rule of ['FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5', 'FREQ=MONTHLY;BYDAY=1MO;COUNT=3']) {
      for (const out of expandRule(rule, start)) {
        expect(out.getTime()).toBeGreaterThanOrEqual(start.getTime())
      }
    }
  })

  it('an UNTIL already in the past yields nothing, and terminates', () => {
    expect(expandRule('FREQ=WEEKLY;UNTIL=20260101', start)).toEqual([])
    expect(expandRule('FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260101', start)).toEqual([])
  })
})
