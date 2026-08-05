import { describe, it, expect } from 'vitest'
import {
  packageBookingWindow, bookableStartTimes, checkBookableStart, withinPackageWindow,
  validateBookingWindow, bookingWindowColumns, bookingWindowInput, describeBookingWindow,
  ANY_TIME_WINDOW,
} from '@/lib/package-booking-window'
import { enumerateStartTimes, type AvailabilityRow, type BlackoutRow, type BusyInterval } from '@/lib/availability'

// WHEN a client may self-book a 1:1 offering.
//
// The rule this whole file is about: a package window NARROWS. Every test here
// either proves the default path is untouched, or proves that adding a window
// only ever REMOVES times — never adds one the trainer isn't free for.

// 2030-01-07 Mon (ISO 1) · 08 Tue (2) · 09 Wed (3) · 10 Thu (4)
const MON = '2030-01-07'
const TUE = '2030-01-08'
const WED = '2030-01-09'
const THU = '2030-01-10'

/** Trainer works 09:00–17:00 every weekday. */
const WEEKDAYS: AvailabilityRow[] = [1, 2, 3, 4, 5].map(d => ({
  id: `s${d}`, dayOfWeek: d, date: null, startTime: '09:00', endTime: '17:00',
}))

const NO_BLACKOUTS: BlackoutRow[] = []
const NOTHING_BOOKED: BusyInterval[] = []

function times(dateStr: string, window = ANY_TIME_WINDOW, opts: {
  slots?: AvailabilityRow[]
  blackouts?: BlackoutRow[]
  busy?: BusyInterval[]
  durationMins?: number
  bufferMins?: number
} = {}) {
  return bookableStartTimes({
    slots: opts.slots ?? WEEKDAYS,
    blackouts: opts.blackouts ?? NO_BLACKOUTS,
    busy: opts.busy ?? NOTHING_BOOKED,
    dateStr,
    durationMins: opts.durationMins ?? 60,
    bufferMins: opts.bufferMins ?? 0,
    stepMins: 30,
    window,
  })
}

const WEEKLY = packageBookingWindow({
  bookingWindowMode: 'WEEKLY_WINDOW',
  bookingWindowDays: [2, 4],
  bookingWindowStart: '09:00',
  bookingWindowEnd: '13:00',
})

const EXACT = packageBookingWindow({
  bookingWindowMode: 'EXACT_TIMES',
  bookingWindowTimes: [
    { day: 2, time: '09:00' },
    { day: 2, time: '10:30' },
    { day: 4, time: '14:00' },
  ],
})

describe('packageBookingWindow — reading a stored row', () => {
  it('an offering written before this feature reads back as ANY_TIME', () => {
    // The whole migration-of-intent question: there is none. A row with no
    // window columns at all must behave exactly as it does in production today.
    expect(packageBookingWindow({})).toEqual(ANY_TIME_WINDOW)
    expect(packageBookingWindow(null)).toEqual(ANY_TIME_WINDOW)
    expect(packageBookingWindow(undefined).mode).toBe('ANY_TIME')
  })

  it('normalises and de-duplicates a weekly window', () => {
    const w = packageBookingWindow({
      bookingWindowMode: 'WEEKLY_WINDOW',
      bookingWindowDays: [4, 2, 2],
      bookingWindowStart: '09:00',
      bookingWindowEnd: '13:00',
    })
    expect(w.days).toEqual([2, 4])
  })

  it('falls back to ANY_TIME rather than blocking everything when a row is unusable', () => {
    // A window that lost its hours must not take a working offering off sale —
    // "no times at all, and no way to see why" is the worse failure.
    expect(packageBookingWindow({ bookingWindowMode: 'WEEKLY_WINDOW', bookingWindowDays: [2] }).mode).toBe('ANY_TIME')
    expect(packageBookingWindow({ bookingWindowMode: 'EXACT_TIMES', bookingWindowTimes: [] }).mode).toBe('ANY_TIME')
    expect(packageBookingWindow({
      bookingWindowMode: 'WEEKLY_WINDOW', bookingWindowDays: [2],
      bookingWindowStart: '13:00', bookingWindowEnd: '09:00',
    }).mode).toBe('ANY_TIME')
  })

  it('drops junk entries from the exact-times column', () => {
    const w = packageBookingWindow({
      bookingWindowMode: 'EXACT_TIMES',
      bookingWindowTimes: [
        { day: 2, time: '09:00' },
        { day: 9, time: '09:00' },       // not a weekday
        { day: 2, time: '25:00' },       // not a time
        { day: 2, time: '09:00' },       // duplicate
        'nonsense',
      ],
    })
    expect(w.times).toEqual([{ day: 2, time: '09:00' }])
  })
})

describe('ANY_TIME — the default path is untouched', () => {
  it('returns exactly what enumerateStartTimes has always returned', () => {
    const legacy = enumerateStartTimes(WEEKDAYS, TUE, 60, NO_BLACKOUTS, 30, NOTHING_BOOKED, 0)
    expect(times(TUE)).toEqual(legacy)
    expect(times(TUE)[0]).toBe('09:00')
    expect(times(TUE).at(-1)).toBe('16:00')
  })

  it('accepts an off-grid start on the server, as it always has', () => {
    // 09:20 is not on the picker's 30-minute grid, but it is genuinely inside
    // the trainer's hours. Refusing it now would break bookings that work today.
    const res = checkBookableStart({
      slots: WEEKDAYS, blackouts: NO_BLACKOUTS, busy: NOTHING_BOOKED,
      dateStr: TUE, startMin: 9 * 60 + 20, durationMins: 60, window: ANY_TIME_WINDOW,
    })
    expect(res.ok).toBe(true)
  })
})

describe('WEEKLY_WINDOW — narrows, never widens', () => {
  it('offers nothing on a day outside the window', () => {
    expect(times(MON, WEEKLY)).toEqual([])   // Monday isn't Tue/Thu
    expect(times(WED, WEEKLY)).toEqual([])
  })

  it('offers only the hours inside the window on a day that is', () => {
    // 09:00–13:00 with a 60-minute session: the last start that FITS is 12:00.
    expect(times(TUE, WEEKLY)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00'])
  })

  it('is a strict subset of what the same day offered without a window', () => {
    const withWindow = times(TUE, WEEKLY)
    const without = times(TUE)
    expect(withWindow.every(t => without.includes(t))).toBe(true)
    expect(withWindow.length).toBeLessThan(without.length)
  })

  it('cannot open an hour the trainer does not work', () => {
    // The window says 09:00–13:00 on Tuesday; the trainer only works 11:00–15:00.
    // The answer is the INTERSECTION, not the window.
    const lateStart: AvailabilityRow[] = [{ id: 'x', dayOfWeek: 2, date: null, startTime: '11:00', endTime: '15:00' }]
    expect(times(TUE, WEEKLY, { slots: lateStart })).toEqual(['11:00', '11:30', '12:00'])
  })

  it('cannot open a day the trainer does not work at all', () => {
    const tuesdayOnly: AvailabilityRow[] = [{ id: 'x', dayOfWeek: 2, date: null, startTime: '09:00', endTime: '17:00' }]
    expect(times(THU, WEEKLY, { slots: tuesdayOnly })).toEqual([])
  })

  it('requires the WHOLE session to fit inside the window', () => {
    // A 90-minute session can't start at 12:00 and run to 13:30.
    expect(times(TUE, WEEKLY, { durationMins: 90 }).at(-1)).toBe('11:30')
  })

  it('a blackout still empties the day, window or not', () => {
    const blackouts: BlackoutRow[] = [{ startDate: TUE, endDate: TUE }]
    expect(times(TUE, WEEKLY, { blackouts })).toEqual([])
    expect(times(TUE, ANY_TIME_WINDOW, { blackouts })).toEqual([])
  })

  it('an existing booking still removes its hour from inside the window', () => {
    const busy: BusyInterval[] = [{ dateStr: TUE, startMin: 10 * 60, endMin: 11 * 60 }]
    const out = times(TUE, WEEKLY, { busy })
    expect(out).not.toContain('10:00')
    expect(out).not.toContain('09:30')   // would run into it
    expect(out).toContain('11:00')       // free again
  })
})

describe('EXACT_TIMES — narrows, never widens', () => {
  it('offers only the named starts for that weekday', () => {
    expect(times(TUE, EXACT)).toEqual(['09:00', '10:30'])
    expect(times(THU, EXACT)).toEqual(['14:00'])
    expect(times(MON, EXACT)).toEqual([])
  })

  it('drops a named start the trainer is not actually available for', () => {
    // Thursday 14:00 is named, but the trainer finishes at 13:00 that day.
    const shortThu: AvailabilityRow[] = [
      { id: 'a', dayOfWeek: 2, date: null, startTime: '09:00', endTime: '17:00' },
      { id: 'b', dayOfWeek: 4, date: null, startTime: '09:00', endTime: '13:00' },
    ]
    expect(times(THU, EXACT, { slots: shortThu })).toEqual([])
    expect(times(TUE, EXACT, { slots: shortThu })).toEqual(['09:00', '10:30'])
  })

  it('drops a named start on a blacked-out day', () => {
    expect(times(TUE, EXACT, { blackouts: [{ startDate: TUE, endDate: TUE }] })).toEqual([])
  })

  it('drops a named start that has already been booked', () => {
    const busy: BusyInterval[] = [{ dateStr: TUE, startMin: 9 * 60, endMin: 10 * 60 }]
    expect(times(TUE, EXACT, { busy })).toEqual(['10:30'])
  })

  it('respects the turnaround buffer hanging off an existing booking', () => {
    // A booking ending at 10:15 with a 30-minute turnaround blocks 10:30.
    const busy: BusyInterval[] = [{ dateStr: TUE, startMin: 9 * 60 + 15, endMin: 10 * 60 + 15, bufferMins: 30 }]
    expect(times(TUE, EXACT, { busy })).toEqual([])
  })

  it('offers a named start that no 30-minute grid would produce', () => {
    // A trainer is entitled to say "10:20". The grid would never generate it,
    // which is why exact times start from the NAMED set rather than filtering
    // the grid — and it still has to survive the availability checks.
    const odd = packageBookingWindow({
      bookingWindowMode: 'EXACT_TIMES',
      bookingWindowTimes: [{ day: 2, time: '10:20' }],
    })
    expect(times(TUE, odd)).toEqual(['10:20'])
    expect(times(TUE, ANY_TIME_WINDOW)).not.toContain('10:20')
  })
})

describe('checkBookableStart — the server-side gate', () => {
  const base = {
    slots: WEEKDAYS, blackouts: NO_BLACKOUTS, busy: NOTHING_BOOKED,
    dateStr: TUE, durationMins: 60,
  }

  it('accepts a time inside the window', () => {
    expect(checkBookableStart({ ...base, startMin: 10 * 60, window: WEEKLY })).toEqual({ ok: true })
  })

  it('refuses a crafted time outside a weekly window with its own reason', () => {
    // Genuinely inside the trainer's hours (15:00 on a Tuesday) — the ONLY
    // thing wrong with it is that this offering is not sold at that hour.
    expect(checkBookableStart({ ...base, startMin: 15 * 60, window: WEEKLY }))
      .toEqual({ ok: false, reason: 'outside-window' })
  })

  it('refuses a crafted time on a day outside a weekly window', () => {
    expect(checkBookableStart({ ...base, dateStr: WED, startMin: 10 * 60, window: WEEKLY }))
      .toEqual({ ok: false, reason: 'outside-window' })
  })

  it('refuses a near-miss of a named exact time', () => {
    // 09:01 is one minute off a named 09:00 — an exact time means exact.
    expect(checkBookableStart({ ...base, startMin: 9 * 60 + 1, window: EXACT }))
      .toEqual({ ok: false, reason: 'outside-window' })
    expect(checkBookableStart({ ...base, startMin: 9 * 60, window: EXACT })).toEqual({ ok: true })
  })

  it('still reports unavailable and taken ahead of the window', () => {
    // The window never SOFTENS the checks that came before it.
    expect(checkBookableStart({ ...base, startMin: 18 * 60, window: WEEKLY }))
      .toEqual({ ok: false, reason: 'unavailable' })
    expect(checkBookableStart({
      ...base, startMin: 10 * 60, window: WEEKLY,
      busy: [{ dateStr: TUE, startMin: 10 * 60, endMin: 11 * 60 }],
    })).toEqual({ ok: false, reason: 'taken' })
  })

  it('agrees with the picker on every time the picker offers', () => {
    // One source of truth, asserted: nothing on screen can be refused by the
    // route, and this is the assertion that keeps it that way.
    for (const window of [ANY_TIME_WINDOW, WEEKLY, EXACT]) {
      for (const dateStr of [MON, TUE, WED, THU]) {
        for (const t of times(dateStr, window)) {
          const [h, m] = t.split(':').map(Number)
          expect(checkBookableStart({ ...base, dateStr, startMin: h * 60 + m, window })).toEqual({ ok: true })
        }
      }
    }
  })
})

describe('withinPackageWindow — the narrowing predicate alone', () => {
  it('says yes to everything under ANY_TIME', () => {
    expect(withinPackageWindow(ANY_TIME_WINDOW, MON, 3 * 60, 60)).toBe(true)
  })

  it('knows nothing about availability — narrowing only', () => {
    // 03:00 on a Tuesday: no trainer works then, and this predicate still says
    // "inside the window" — because deciding availability is not its job. That
    // separation is what makes it impossible for it to WIDEN anything.
    const allDay = packageBookingWindow({
      bookingWindowMode: 'WEEKLY_WINDOW', bookingWindowDays: [2],
      bookingWindowStart: '00:00', bookingWindowEnd: '23:59',
    })
    expect(withinPackageWindow(allDay, TUE, 3 * 60, 60)).toBe(true)
    // …and the full gate still refuses it.
    expect(checkBookableStart({
      slots: WEEKDAYS, blackouts: NO_BLACKOUTS, busy: NOTHING_BOOKED,
      dateStr: TUE, startMin: 3 * 60, durationMins: 60, window: allDay,
    })).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('validateBookingWindow — the guard the form and the API share', () => {
  it('lets any-time through with nothing set', () => {
    expect(validateBookingWindow(bookingWindowInput({ mode: 'ANY_TIME' }))).toBeNull()
  })

  it('refuses a weekly window with no days', () => {
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'WEEKLY_WINDOW', days: [], startTime: '09:00', endTime: '13:00',
    }))).toMatch(/at least one day/i)
  })

  it('refuses a weekly window with no hours', () => {
    expect(validateBookingWindow(bookingWindowInput({ mode: 'WEEKLY_WINDOW', days: [2] })))
      .toMatch(/start and end/i)
  })

  it('refuses an end that is not after the start', () => {
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'WEEKLY_WINDOW', days: [2], startTime: '13:00', endTime: '09:00',
    }))).toMatch(/end after it starts/i)
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'WEEKLY_WINDOW', days: [2], startTime: '09:00', endTime: '09:00',
    }))).toMatch(/end after it starts/i)
  })

  it('refuses exact-times with nothing named', () => {
    expect(validateBookingWindow(bookingWindowInput({ mode: 'EXACT_TIMES', times: [] })))
      .toMatch(/at least one start time/i)
  })

  it('refuses a duplicated start time', () => {
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'EXACT_TIMES', times: [{ day: 2, time: '09:00' }, { day: 2, time: '09:00' }],
    }))).toMatch(/listed twice/i)
  })

  it('allows the same clock time on two different days', () => {
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'EXACT_TIMES', times: [{ day: 2, time: '09:00' }, { day: 4, time: '09:00' }],
    }))).toBeNull()
  })
})

describe('round trip — set it, save it, reload it, identical', () => {
  // The single most repeated bug in this codebase is a field that saved fine
  // and came back different. The only proof is the whole loop.
  it('a weekly window survives storage and reads back the same', () => {
    const chosen = bookingWindowInput({
      mode: 'WEEKLY_WINDOW', days: [4, 2], startTime: '09:00', endTime: '13:00',
    })
    expect(validateBookingWindow(chosen)).toBeNull()
    const stored = bookingWindowColumns(chosen)
    expect(packageBookingWindow(stored)).toEqual({
      mode: 'WEEKLY_WINDOW', days: [2, 4], startTime: '09:00', endTime: '13:00', times: [],
    })
  })

  it('exact times survive storage and read back the same', () => {
    const chosen = bookingWindowInput({
      mode: 'EXACT_TIMES',
      times: [{ day: 4, time: '14:00' }, { day: 2, time: '09:00' }, { day: 2, time: '10:30' }],
    })
    expect(validateBookingWindow(chosen)).toBeNull()
    const stored = bookingWindowColumns(chosen)
    expect(packageBookingWindow(stored)).toEqual(EXACT)
  })

  it('switching mode clears the other mode’s fields', () => {
    // Otherwise a trainer who tried exact times, switched to a weekly window
    // and later switched back would find the old times waiting for them.
    const stored = bookingWindowColumns(bookingWindowInput({
      mode: 'WEEKLY_WINDOW', days: [2], startTime: '09:00', endTime: '13:00',
      times: [{ day: 2, time: '09:00' }],
    }))
    expect(stored.bookingWindowTimes).toEqual([])
    const back = bookingWindowColumns(bookingWindowInput({ mode: 'ANY_TIME' }))
    expect(back).toEqual({
      bookingWindowMode: 'ANY_TIME',
      bookingWindowDays: [],
      bookingWindowStart: null,
      bookingWindowEnd: null,
      bookingWindowTimes: [],
    })
  })

  it('the resolved window is what the picker and the gate both then use', () => {
    const stored = bookingWindowColumns(bookingWindowInput({
      mode: 'WEEKLY_WINDOW', days: [2], startTime: '09:00', endTime: '11:00',
    }))
    const reloaded = packageBookingWindow(stored)
    expect(times(TUE, reloaded)).toEqual(['09:00', '09:30', '10:00'])
    expect(checkBookableStart({
      slots: WEEKDAYS, blackouts: NO_BLACKOUTS, busy: NOTHING_BOOKED,
      dateStr: TUE, startMin: 11 * 60, durationMins: 60, window: reloaded,
    })).toEqual({ ok: false, reason: 'outside-window' })
  })
})

describe('describeBookingWindow', () => {
  it('says what the trainer chose, in their words', () => {
    expect(describeBookingWindow(WEEKLY)).toBe('Tue, Thu · 09:00–13:00')
    expect(describeBookingWindow(EXACT)).toBe('Tue 09:00, Tue 10:30, Thu 14:00')
    expect(describeBookingWindow(ANY_TIME_WINDOW)).toMatch(/any time/i)
  })
})
