import { describe, it, expect } from 'vitest'
import {
  packageBookingWindow, bookableStartTimes, checkBookableStart, withinPackageWindow,
  validateBookingWindow, bookingWindowColumns, bookingWindowInput, describeBookingWindow,
  findNextBookableStart, trainerPickInsideWindow, isExpiredDate, windowIsAllExpired,
  ANY_TIME_WINDOW,
} from '@/lib/package-booking-window'
import { enumerateStartTimes, type AvailabilityRow, type BlackoutRow, type BusyInterval } from '@/lib/availability'

// WHEN a 1:1 offering can be booked.
//
// The rule this whole file is about: a package window NARROWS. Every test here
// either proves the default path is untouched, or proves that adding a window
// only ever REMOVES times — never adds one the trainer isn't free for.
//
// It also pins the CLIENT/TRAINER asymmetry: the client's gate refuses, the
// trainer's guide falls back. See "the TRAINER path".

// 2030-01-07 Mon (ISO 1) · 08 Tue (2) · 09 Wed (3) · 10 Thu (4) · 12 Sat (6)
const MON = '2030-01-07'
const TUE = '2030-01-08'
const WED = '2030-01-09'
const THU = '2030-01-10'
const SAT = '2030-01-12'

/** Trainer works 09:00–19:00 every day of the week. */
const ALL_WEEK: AvailabilityRow[] = [1, 2, 3, 4, 5, 6, 7].map(d => ({
  id: `s${d}`, dayOfWeek: d, date: null, startTime: '09:00', endTime: '19:00',
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
    slots: opts.slots ?? ALL_WEEK,
    blackouts: opts.blackouts ?? NO_BLACKOUTS,
    busy: opts.busy ?? NOTHING_BOOKED,
    dateStr,
    durationMins: opts.durationMins ?? 60,
    bufferMins: opts.bufferMins ?? 0,
    stepMins: 30,
    window,
  })
}

/** Karl's own example: "monday from 3-5 and wed 1-7". */
const KARLS = packageBookingWindow({
  bookingWindowMode: 'RESTRICTED',
  bookingWindowRanges: [
    { day: 1, start: '15:00', end: '17:00' },
    { day: 3, start: '13:00', end: '19:00' },
  ],
})

/** Weekly bands AND a one-off dated start at once — the union. */
const COMBINED = packageBookingWindow({
  bookingWindowMode: 'RESTRICTED',
  bookingWindowRanges: [{ day: 1, start: '15:00', end: '17:00' }],
  bookingWindowDates: [{ date: SAT, time: '10:00' }],
})

describe('packageBookingWindow — reading a stored row', () => {
  it('an offering written before this feature reads back as ANY_TIME', () => {
    // The whole migration-of-intent question: there is none. A row with no
    // window columns at all must behave exactly as it does in production today.
    expect(packageBookingWindow({})).toEqual(ANY_TIME_WINDOW)
    expect(packageBookingWindow(null)).toEqual(ANY_TIME_WINDOW)
    expect(packageBookingWindow(undefined).mode).toBe('ANY_TIME')
  })

  it('reads weekly bands, sorted and de-duplicated', () => {
    const w = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [
        { day: 3, start: '13:00', end: '19:00' },
        { day: 1, start: '15:00', end: '17:00' },
        { day: 1, start: '15:00', end: '17:00' },   // exact duplicate
      ],
    })
    expect(w.ranges).toEqual([
      { day: 1, start: '15:00', end: '17:00' },
      { day: 3, start: '13:00', end: '19:00' },
    ])
  })

  it('keeps TWO bands on the same day — a morning and an afternoon block', () => {
    const w = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [
        { day: 1, start: '15:00', end: '17:00' },
        { day: 1, start: '09:00', end: '11:00' },
      ],
    })
    expect(w.ranges).toEqual([
      { day: 1, start: '09:00', end: '11:00' },
      { day: 1, start: '15:00', end: '17:00' },
    ])
  })

  it('holds weekly bands and dated one-offs TOGETHER, not as alternatives', () => {
    expect(COMBINED.ranges).toHaveLength(1)
    expect(COMBINED.dates).toEqual([{ date: SAT, time: '10:00' }])
  })

  it('falls back to ANY_TIME rather than blocking everything when a row is unusable', () => {
    // A window that lost its content must not take a working offering off
    // sale — "no times at all, and no way to see why" is the worse failure.
    expect(packageBookingWindow({ bookingWindowMode: 'RESTRICTED' }).mode).toBe('ANY_TIME')
    expect(packageBookingWindow({
      bookingWindowMode: 'RESTRICTED', bookingWindowRanges: [], bookingWindowDates: [],
    }).mode).toBe('ANY_TIME')
  })

  it('drops junk entries from either half', () => {
    const w = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [
        { day: 1, start: '15:00', end: '17:00' },
        { day: 9, start: '15:00', end: '17:00' },   // not a weekday
        { day: 1, start: '17:00', end: '15:00' },   // backwards
        { day: 1, start: '15:00', end: '25:00' },   // not a time
        'nonsense',
      ],
      bookingWindowDates: [
        { date: SAT, time: '10:00' },
        { date: SAT, time: '10:00' },               // duplicate
        { date: '2030-02-31', time: '10:00' },      // not a real date
        { date: 'soon', time: '10:00' },
        null,
      ],
    })
    expect(w.ranges).toEqual([{ day: 1, start: '15:00', end: '17:00' }])
    expect(w.dates).toEqual([{ date: SAT, time: '10:00' }])
  })
})

describe('migrating the old shapes — nothing a trainer set is dropped', () => {
  // Two legacy shapes, both folded at READ time as well as in SQL, because
  // production is behind on migrations and a row this deploy hasn't reached
  // must still resolve to the window it always had.
  it('reads a legacy single-band row as the equivalent per-day bands', () => {
    // Before per-day ranges, ONE start/end applied to every day in the list.
    const w = packageBookingWindow({
      bookingWindowMode: 'WEEKLY_WINDOW',
      bookingWindowDays: [4, 2],
      bookingWindowStart: '09:00',
      bookingWindowEnd: '13:00',
    })
    expect(w.mode).toBe('RESTRICTED')
    expect(w.ranges).toEqual([
      { day: 2, start: '09:00', end: '13:00' },
      { day: 4, start: '09:00', end: '13:00' },
    ])
  })

  it('a legacy single-band row books exactly the times it always did', () => {
    const legacy = packageBookingWindow({
      bookingWindowMode: 'WEEKLY_WINDOW',
      bookingWindowDays: [2], bookingWindowStart: '09:00', bookingWindowEnd: '13:00',
    })
    const migrated = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [{ day: 2, start: '09:00', end: '13:00' }],
    })
    expect(times(TUE, legacy)).toEqual(times(TUE, migrated))
    expect(times(TUE, legacy)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00'])
  })

  it('converts a legacy WEEKDAY exact start into a band one session long', () => {
    // "Tue 09:00 exactly" for a 60-minute session is "Tue 09:00–10:00" — one
    // row kind instead of two, and the same single bookable start.
    const w = packageBookingWindow({
      bookingWindowMode: 'EXACT_TIMES',
      bookingWindowTimes: [{ day: 2, time: '09:00' }],
      durationMins: 60,
    })
    expect(w.mode).toBe('RESTRICTED')
    expect(w.ranges).toEqual([{ day: 2, start: '09:00', end: '10:00' }])
    expect(times(TUE, w)).toEqual(['09:00'])
  })

  it('clamps a late legacy exact start instead of wrapping past midnight', () => {
    const w = packageBookingWindow({
      bookingWindowMode: 'EXACT_TIMES',
      bookingWindowTimes: [{ day: 2, time: '23:30' }],
      durationMins: 60,
    })
    expect(w.ranges).toEqual([{ day: 2, start: '23:30', end: '23:59' }])
  })

  it('keeps BOTH a legacy exact start and a modern band — they are different rules', () => {
    const w = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [{ day: 1, start: '15:00', end: '17:00' }],
      bookingWindowTimes: [{ day: 2, time: '09:00' }],
      durationMins: 60,
    })
    expect(w.ranges).toEqual([
      { day: 1, start: '15:00', end: '17:00' },
      { day: 2, start: '09:00', end: '10:00' },
    ])
  })

  it('does NOT fold the legacy single band in when modern bands exist', () => {
    // A migrated row keeps both column sets for a while. Folding both would
    // double the window.
    const w = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [{ day: 1, start: '15:00', end: '17:00' }],
      bookingWindowDays: [2], bookingWindowStart: '09:00', bookingWindowEnd: '13:00',
    })
    expect(w.ranges).toEqual([{ day: 1, start: '15:00', end: '17:00' }])
  })

  it('a legacy row that lost its hours reverts to ANY_TIME', () => {
    expect(packageBookingWindow({
      bookingWindowMode: 'WEEKLY_WINDOW', bookingWindowDays: [2],
    }).mode).toBe('ANY_TIME')
  })
})

describe('ANY_TIME — the default path is untouched', () => {
  it('returns exactly what enumerateStartTimes has always returned', () => {
    const legacy = enumerateStartTimes(ALL_WEEK, TUE, 60, NO_BLACKOUTS, 30, NOTHING_BOOKED, 0)
    expect(times(TUE)).toEqual(legacy)
    expect(times(TUE)[0]).toBe('09:00')
    expect(times(TUE).at(-1)).toBe('18:00')
  })

  it('accepts an off-grid start on the server, as it always has', () => {
    // 09:20 is not on the picker's 30-minute grid, but it is genuinely inside
    // the trainer's hours. Refusing it now would break bookings that work today.
    expect(checkBookableStart({
      slots: ALL_WEEK, blackouts: NO_BLACKOUTS, busy: NOTHING_BOOKED,
      dateStr: TUE, startMin: 9 * 60 + 20, durationMins: 60, window: ANY_TIME_WINDOW,
    }).ok).toBe(true)
  })
})

describe('weekly bands — "Monday 3–5 and Wednesday 1–7"', () => {
  it('offers each day its OWN hours', () => {
    // The thing the single-band shape could not say.
    expect(times(MON, KARLS)).toEqual(['15:00', '15:30', '16:00'])
    expect(times(WED, KARLS)).toEqual([
      '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
      '16:00', '16:30', '17:00', '17:30', '18:00',
    ])
  })

  it('offers nothing on a day with no band', () => {
    expect(times(TUE, KARLS)).toEqual([])
    expect(times(SAT, KARLS)).toEqual([])
  })

  it('is a strict subset of what the day offered without a window', () => {
    const withWindow = times(MON, KARLS)
    const without = times(MON)
    expect(withWindow.every(t => without.includes(t))).toBe(true)
    expect(withWindow.length).toBeLessThan(without.length)
  })

  it('unions TWO bands on the same day', () => {
    const twice = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [
        { day: 1, start: '09:00', end: '11:00' },
        { day: 1, start: '15:00', end: '17:00' },
      ],
    })
    expect(times(MON, twice)).toEqual(['09:00', '09:30', '10:00', '15:00', '15:30', '16:00'])
  })

  it('does not double-list a time two overlapping bands both cover', () => {
    const overlapping = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [
        { day: 1, start: '09:00', end: '12:00' },
        { day: 1, start: '10:00', end: '13:00' },
      ],
    })
    const out = times(MON, overlapping)
    expect(out).toEqual([...new Set(out)])
    expect(out).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00'])
  })

  it('cannot open an hour the trainer does not work', () => {
    // The band says Monday 15:00–17:00; the trainer stops at 16:00. The answer
    // is the INTERSECTION, not the band.
    const shortMon: AvailabilityRow[] = [{ id: 'x', dayOfWeek: 1, date: null, startTime: '09:00', endTime: '16:00' }]
    expect(times(MON, KARLS, { slots: shortMon })).toEqual(['15:00'])
  })

  it('cannot open a day the trainer does not work at all', () => {
    const tuesdayOnly: AvailabilityRow[] = [{ id: 'x', dayOfWeek: 2, date: null, startTime: '09:00', endTime: '19:00' }]
    expect(times(MON, KARLS, { slots: tuesdayOnly })).toEqual([])
  })

  it('requires the WHOLE session to fit inside the band', () => {
    // A 90-minute session can't start at 16:00 and run past a 17:00 band end.
    expect(times(MON, KARLS, { durationMins: 90 })).toEqual(['15:00', '15:30'])
  })

  it('a blackout still empties the day, band or not', () => {
    const blackouts: BlackoutRow[] = [{ startDate: MON, endDate: MON }]
    expect(times(MON, KARLS, { blackouts })).toEqual([])
    expect(times(MON, ANY_TIME_WINDOW, { blackouts })).toEqual([])
  })

  it('an existing booking still removes its hour from inside the band', () => {
    const busy: BusyInterval[] = [{ dateStr: MON, startMin: 15 * 60, endMin: 16 * 60 }]
    const out = times(MON, KARLS, { busy })
    expect(out).not.toContain('15:00')
    expect(out).toContain('16:00')
  })
})

describe('one-off dated starts, unioned with the weekly bands', () => {
  it('offers the band on its weekday and the dated start on its date', () => {
    expect(times(MON, COMBINED)).toEqual(['15:00', '15:30', '16:00'])
    expect(times(SAT, COMBINED)).toEqual(['10:00'])
  })

  it('fires on that DATE only, not every week', () => {
    // The difference from a weekday rule. 2030-01-19 is also a Saturday.
    expect(times('2030-01-19', COMBINED)).toEqual([])
  })

  it('offers nothing on a day neither half mentions', () => {
    expect(times(WED, COMBINED)).toEqual([])
  })

  it('a dated start survives only if the trainer is free for it', () => {
    const noSaturday: AvailabilityRow[] = [{ id: 'x', dayOfWeek: 1, date: null, startTime: '09:00', endTime: '19:00' }]
    expect(times(SAT, COMBINED, { slots: noSaturday })).toEqual([])
    expect(times(MON, COMBINED, { slots: noSaturday })).toEqual(['15:00', '15:30', '16:00'])
  })

  it('a dated start is dropped when it has been booked', () => {
    expect(times(SAT, COMBINED, { busy: [{ dateStr: SAT, startMin: 10 * 60, endMin: 11 * 60 }] })).toEqual([])
  })

  it('a dated start is dropped on a blacked-out day', () => {
    expect(times(SAT, COMBINED, { blackouts: [{ startDate: SAT, endDate: SAT }] })).toEqual([])
  })

  it('respects the turnaround buffer hanging off an existing booking', () => {
    // A booking ending at 09:45 with a 30-minute turnaround blocks a 10:00 start.
    const busy: BusyInterval[] = [{ dateStr: SAT, startMin: 8 * 60 + 45, endMin: 9 * 60 + 45, bufferMins: 30 }]
    expect(times(SAT, COMBINED, { busy })).toEqual([])
  })

  it('offers a start that no 30-minute grid would produce', () => {
    // A trainer is entitled to say "10:20 on the twelfth". The grid would never
    // generate it, which is why the dated half starts from the NAMED time — and
    // it still has to survive the availability checks.
    const odd = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowDates: [{ date: SAT, time: '10:20' }],
    })
    expect(times(SAT, odd)).toEqual(['10:20'])
    expect(times(SAT, ANY_TIME_WINDOW)).not.toContain('10:20')
  })

  it('a dated start INSIDE a band appears exactly once', () => {
    const both = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [{ day: 1, start: '15:00', end: '17:00' }],
      bookingWindowDates: [{ date: MON, time: '15:30' }],
    })
    expect(times(MON, both)).toEqual(['15:00', '15:30', '16:00'])
  })
})

describe('a dated start that has been and gone', () => {
  // Kept in storage — a trainer's data is never silently deleted — but it can
  // never produce a slot again.
  const past = packageBookingWindow({
    bookingWindowMode: 'RESTRICTED',
    bookingWindowDates: [{ date: '2020-01-04', time: '10:00' }],
  })

  it('is still stored and still readable', () => {
    expect(past.dates).toEqual([{ date: '2020-01-04', time: '10:00' }])
  })

  it('produces no slot on any future day', () => {
    for (const d of [MON, TUE, WED, THU, SAT]) expect(times(d, past)).toEqual([])
  })

  it('is reported as expired so the editor can grey it out', () => {
    expect(isExpiredDate({ date: '2020-01-04', time: '10:00' }, '2030-01-07')).toBe(true)
    expect(isExpiredDate({ date: SAT, time: '10:00' }, '2030-01-07')).toBe(false)
    // Today itself is not expired — a later slot today is still bookable.
    expect(isExpiredDate({ date: MON, time: '10:00' }, MON)).toBe(false)
  })

  it('names the "configured but offers nothing" case', () => {
    // Which is what the zero-slot preview would otherwise report with no cause.
    expect(windowIsAllExpired(past, '2030-01-07')).toBe(true)
    expect(windowIsAllExpired(COMBINED, '2030-01-07')).toBe(false)
    expect(windowIsAllExpired(KARLS, '2030-01-07')).toBe(false)
    expect(windowIsAllExpired(ANY_TIME_WINDOW, '2030-01-07')).toBe(false)
  })

  it('does not disable the weekly half it sits beside', () => {
    const mixed = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [{ day: 1, start: '15:00', end: '17:00' }],
      bookingWindowDates: [{ date: '2020-01-04', time: '10:00' }],
    })
    expect(times(MON, mixed)).toEqual(['15:00', '15:30', '16:00'])
    expect(windowIsAllExpired(mixed, '2030-01-07')).toBe(false)
  })
})

describe('checkBookableStart — the CLIENT-side gate, which refuses', () => {
  const base = {
    slots: ALL_WEEK, blackouts: NO_BLACKOUTS, busy: NOTHING_BOOKED, durationMins: 60,
  }

  it('accepts a time inside a band', () => {
    expect(checkBookableStart({ ...base, dateStr: MON, startMin: 15 * 60, window: KARLS })).toEqual({ ok: true })
  })

  it('refuses a crafted time outside every band, with its own reason', () => {
    // Genuinely inside the trainer's hours (11:00 on a Monday) — the ONLY thing
    // wrong with it is that this offering is not sold then.
    expect(checkBookableStart({ ...base, dateStr: MON, startMin: 11 * 60, window: KARLS }))
      .toEqual({ ok: false, reason: 'outside-window' })
  })

  it('refuses a crafted time on a day with no band', () => {
    expect(checkBookableStart({ ...base, dateStr: TUE, startMin: 15 * 60, window: KARLS }))
      .toEqual({ ok: false, reason: 'outside-window' })
  })

  it('refuses a near-miss of a dated start', () => {
    expect(checkBookableStart({ ...base, dateStr: SAT, startMin: 10 * 60 + 1, window: COMBINED }))
      .toEqual({ ok: false, reason: 'outside-window' })
    expect(checkBookableStart({ ...base, dateStr: SAT, startMin: 10 * 60, window: COMBINED })).toEqual({ ok: true })
  })

  it('refuses the dated start’s time on a DIFFERENT date', () => {
    expect(checkBookableStart({ ...base, dateStr: '2030-01-19', startMin: 10 * 60, window: COMBINED }))
      .toEqual({ ok: false, reason: 'outside-window' })
  })

  it('still reports unavailable and taken ahead of the window', () => {
    // The window never SOFTENS the checks that came before it.
    expect(checkBookableStart({ ...base, dateStr: MON, startMin: 20 * 60, window: KARLS }))
      .toEqual({ ok: false, reason: 'unavailable' })
    expect(checkBookableStart({
      ...base, dateStr: MON, startMin: 15 * 60, window: KARLS,
      busy: [{ dateStr: MON, startMin: 15 * 60, endMin: 16 * 60 }],
    })).toEqual({ ok: false, reason: 'taken' })
  })

  it('agrees with the picker on every time the picker offers', () => {
    // One source of truth, asserted: nothing on screen can be refused by the
    // route, and this is the assertion that keeps it that way.
    for (const window of [ANY_TIME_WINDOW, KARLS, COMBINED]) {
      for (const dateStr of [MON, TUE, WED, THU, SAT]) {
        for (const t of times(dateStr, window)) {
          const [h, m] = t.split(':').map(Number)
          expect(checkBookableStart({ ...base, dateStr, startMin: h * 60 + m, window })).toEqual({ ok: true })
        }
      }
    }
  })
})

describe('the TRAINER path — guides, never blocks', () => {
  // The decision this asymmetry encodes: a window is a promise made to CLIENTS,
  // so the client route hard-refuses. The TRAINER is the person who made the
  // promise and the only one who can knowingly break it, so their screens steer
  // into the window and warn — they never refuse.
  const MONDAY = new Date(2030, 0, 7)   // local, like the assign modals

  it('places a session on the offering’s own hours when it can', () => {
    const hit = findNextBookableStart({
      slots: ALL_WEEK, from: MONDAY, durationMins: 60, window: KARLS,
    })
    expect(hit?.insideWindow).toBe(true)
    expect(hit?.at.getDay()).toBe(1)          // Monday
    expect(hit?.at.getHours()).toBe(15)       // the band's first slot, not 09:00
  })

  it('skips forward to the next day the offering actually runs', () => {
    const wedOnly = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [{ day: 3, start: '13:00', end: '19:00' }],
    })
    const hit = findNextBookableStart({ slots: ALL_WEEK, from: MONDAY, durationMins: 60, window: wedOnly })
    expect(hit?.at.getDay()).toBe(3)
    expect(hit?.at.getHours()).toBe(13)
    expect(hit?.insideWindow).toBe(true)
  })

  it('lands on a one-off dated start when that is what the offering has', () => {
    const dated = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED', bookingWindowDates: [{ date: SAT, time: '10:20' }],
    })
    const hit = findNextBookableStart({ slots: ALL_WEEK, from: MONDAY, durationMins: 60, window: dated })
    expect(hit?.at.getDay()).toBe(6)
    expect(hit?.at.getHours()).toBe(10)
    expect(hit?.at.getMinutes()).toBe(20)
    expect(hit?.insideWindow).toBe(true)
  })

  it('FALLS BACK rather than refusing when the window yields nothing', () => {
    // The trainer works Tuesdays only; the offering says Monday afternoons.
    // A client would be offered nothing. The trainer still gets a session.
    const tuesdayOnly: AvailabilityRow[] = [{ id: 'x', dayOfWeek: 2, date: null, startTime: '09:00', endTime: '17:00' }]
    const hit = findNextBookableStart({
      slots: tuesdayOnly, from: MONDAY, durationMins: 60, window: KARLS,
    })
    expect(hit).not.toBeNull()
    expect(hit?.insideWindow).toBe(false)     // …and the screen says so
    expect(hit?.at.getDay()).toBe(2)
  })

  it('FALLS BACK when every dated start has expired', () => {
    const past = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED', bookingWindowDates: [{ date: '2020-01-04', time: '10:00' }],
    })
    const hit = findNextBookableStart({ slots: ALL_WEEK, from: MONDAY, durationMins: 60, window: past })
    expect(hit).not.toBeNull()
    expect(hit?.insideWindow).toBe(false)
  })

  it('falls back when the window’s own hours are all taken', () => {
    const busy: BusyInterval[] = []
    // Block Monday 15:00–17:00 and Wednesday 13:00–19:00 for the whole search.
    const ds = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    for (let w = 0; w < 10; w++) {
      busy.push({ dateStr: ds(new Date(2030, 0, 7 + w * 7)), startMin: 15 * 60, endMin: 17 * 60 })
      busy.push({ dateStr: ds(new Date(2030, 0, 9 + w * 7)), startMin: 13 * 60, endMin: 19 * 60 })
    }
    const hit = findNextBookableStart({
      slots: ALL_WEEK, busy, from: MONDAY, durationMins: 60, maxDays: 60, window: KARLS,
    })
    expect(hit).not.toBeNull()
    expect(hit?.insideWindow).toBe(false)
  })

  it('returns null only when there is no availability at all', () => {
    expect(findNextBookableStart({ slots: [], from: MONDAY, durationMins: 60, window: KARLS })).toBeNull()
    expect(findNextBookableStart({ slots: [], from: MONDAY, durationMins: 60, window: ANY_TIME_WINDOW })).toBeNull()
  })

  it('behaves exactly like plain availability when there is no window', () => {
    const hit = findNextBookableStart({ slots: ALL_WEEK, from: MONDAY, durationMins: 60, window: ANY_TIME_WINDOW })
    expect(hit?.at.getHours()).toBe(9)
    expect(hit?.insideWindow).toBe(true)
  })

  it('flags a pinned time the trainer chose outside the window — without refusing it', () => {
    expect(trainerPickInsideWindow(KARLS, new Date(2030, 0, 7, 15, 30), 60)).toBe(true)
    expect(trainerPickInsideWindow(KARLS, new Date(2030, 0, 7, 11, 0), 60)).toBe(false)
    // A dated one-off is matched on its date.
    expect(trainerPickInsideWindow(COMBINED, new Date(2030, 0, 12, 10, 0), 60)).toBe(true)
    expect(trainerPickInsideWindow(COMBINED, new Date(2030, 0, 19, 10, 0), 60)).toBe(false)
    // No window = nothing to be outside of.
    expect(trainerPickInsideWindow(ANY_TIME_WINDOW, new Date(2030, 0, 7, 11, 0), 60)).toBe(true)
  })
})

describe('withinPackageWindow — the narrowing predicate alone', () => {
  it('says yes to everything under ANY_TIME', () => {
    expect(withinPackageWindow(ANY_TIME_WINDOW, MON, 3 * 60, 60)).toBe(true)
  })

  it('knows nothing about availability — narrowing only', () => {
    // 03:00 on a Monday: no trainer works then, and this predicate still says
    // "inside the window" — because deciding availability is not its job. That
    // separation is what makes it impossible for it to WIDEN anything.
    const allDay = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED',
      bookingWindowRanges: [{ day: 1, start: '00:00', end: '23:59' }],
    })
    expect(withinPackageWindow(allDay, MON, 3 * 60, 60)).toBe(true)
    // …and the full gate still refuses it.
    expect(checkBookableStart({
      slots: ALL_WEEK, blackouts: NO_BLACKOUTS, busy: NOTHING_BOOKED,
      dateStr: MON, startMin: 3 * 60, durationMins: 60, window: allDay,
    })).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('a dated entry cannot widen either — naming a date is not being free on it', () => {
    const dated = packageBookingWindow({
      bookingWindowMode: 'RESTRICTED', bookingWindowDates: [{ date: SAT, time: '03:00' }],
    })
    expect(withinPackageWindow(dated, SAT, 3 * 60, 60)).toBe(true)
    expect(times(SAT, dated)).toEqual([])   // the trainer starts at 09:00
  })
})

describe('validateBookingWindow — the guard the form and the API share', () => {
  it('lets any-time through with nothing set', () => {
    expect(validateBookingWindow(bookingWindowInput({ mode: 'ANY_TIME' }))).toBeNull()
  })

  it('refuses a restricted window with nothing in either half', () => {
    expect(validateBookingWindow(bookingWindowInput({ mode: 'RESTRICTED' })))
      .toMatch(/at least one/i)
    expect(validateBookingWindow(bookingWindowInput({ mode: 'RESTRICTED', ranges: [], dates: [] })))
      .toMatch(/at least one/i)
  })

  it('accepts a restricted window with ONLY weekly bands', () => {
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'RESTRICTED', ranges: [{ day: 1, start: '15:00', end: '17:00' }],
    }))).toBeNull()
  })

  it('accepts a restricted window with ONLY dated starts', () => {
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'RESTRICTED', dates: [{ date: SAT, time: '10:00' }],
    }))).toBeNull()
  })

  it('refuses a band that ends before it starts', () => {
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'RESTRICTED', ranges: [{ day: 1, start: '17:00', end: '15:00' }],
    }))).toMatch(/end after it starts/i)
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'RESTRICTED', ranges: [{ day: 1, start: '15:00', end: '15:00' }],
    }))).toMatch(/end after it starts/i)
  })

  it('allows two bands on the same day — that is the point', () => {
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'RESTRICTED',
      ranges: [{ day: 1, start: '09:00', end: '11:00' }, { day: 1, start: '15:00', end: '17:00' }],
    }))).toBeNull()
  })

  it('refuses a date that is not a real day', () => {
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'RESTRICTED', dates: [{ date: '2030-02-31', time: '10:00' }],
    }))).toMatch(/real date/i)
  })

  it('refuses a duplicated dated start', () => {
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'RESTRICTED', dates: [{ date: SAT, time: '10:00' }, { date: SAT, time: '10:00' }],
    }))).toMatch(/listed twice/i)
  })

  it('allows the same clock time on two different dates', () => {
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'RESTRICTED', dates: [{ date: SAT, time: '10:00' }, { date: MON, time: '10:00' }],
    }))).toBeNull()
  })

  it('does NOT refuse a date in the past', () => {
    // Making a trainer delete history to save an unrelated change would be
    // hostile. It just stops producing slots and reads as expired.
    expect(validateBookingWindow(bookingWindowInput({
      mode: 'RESTRICTED', dates: [{ date: '2020-01-04', time: '10:00' }],
    }))).toBeNull()
  })
})

describe('round trip — set it, save it, reload it, identical', () => {
  // The single most repeated bug in this codebase is a field that saved fine
  // and came back different. The only proof is the whole loop.
  it('weekly bands survive storage and read back the same', () => {
    const chosen = bookingWindowInput({
      mode: 'RESTRICTED',
      ranges: [{ day: 3, start: '13:00', end: '19:00' }, { day: 1, start: '15:00', end: '17:00' }],
    })
    expect(validateBookingWindow(chosen)).toBeNull()
    expect(packageBookingWindow(bookingWindowColumns(chosen))).toEqual(KARLS)
  })

  it('the union survives storage and reads back the same', () => {
    const chosen = bookingWindowInput({
      mode: 'RESTRICTED',
      ranges: [{ day: 1, start: '15:00', end: '17:00' }],
      dates: [{ date: SAT, time: '10:00' }],
    })
    expect(packageBookingWindow(bookingWindowColumns(chosen))).toEqual(COMBINED)
  })

  it('two bands on one day survive storage', () => {
    const chosen = bookingWindowInput({
      mode: 'RESTRICTED',
      ranges: [{ day: 1, start: '15:00', end: '17:00' }, { day: 1, start: '09:00', end: '11:00' }],
    })
    expect(packageBookingWindow(bookingWindowColumns(chosen)).ranges).toEqual([
      { day: 1, start: '09:00', end: '11:00' },
      { day: 1, start: '15:00', end: '17:00' },
    ])
  })

  it('an expired dated entry survives storage — never silently dropped', () => {
    const chosen = bookingWindowInput({
      mode: 'RESTRICTED', dates: [{ date: '2020-01-04', time: '10:00' }],
    })
    expect(packageBookingWindow(bookingWindowColumns(chosen)).dates)
      .toEqual([{ date: '2020-01-04', time: '10:00' }])
  })

  it('always clears the legacy columns, so no old rule can be resurrected', () => {
    const stored = bookingWindowColumns(bookingWindowInput({
      mode: 'RESTRICTED', ranges: [{ day: 1, start: '15:00', end: '17:00' }],
    }))
    expect(stored.bookingWindowTimes).toEqual([])
    expect(stored.bookingWindowDays).toEqual([])
    expect(stored.bookingWindowStart).toBeNull()
    expect(stored.bookingWindowEnd).toBeNull()
  })

  it('going back to any-time clears both halves', () => {
    expect(bookingWindowColumns(bookingWindowInput({ mode: 'ANY_TIME' }))).toEqual({
      bookingWindowMode: 'ANY_TIME',
      bookingWindowRanges: [],
      bookingWindowDates: [],
      bookingWindowTimes: [],
      bookingWindowDays: [],
      bookingWindowStart: null,
      bookingWindowEnd: null,
    })
  })

  it('the resolved window is what the picker and the gate both then use', () => {
    const reloaded = packageBookingWindow(bookingWindowColumns(bookingWindowInput({
      mode: 'RESTRICTED', ranges: [{ day: 1, start: '15:00', end: '17:00' }],
    })))
    expect(times(MON, reloaded)).toEqual(['15:00', '15:30', '16:00'])
    expect(checkBookableStart({
      slots: ALL_WEEK, blackouts: NO_BLACKOUTS, busy: NOTHING_BOOKED,
      dateStr: MON, startMin: 17 * 60, durationMins: 60, window: reloaded,
    })).toEqual({ ok: false, reason: 'outside-window' })
  })
})

describe('describeBookingWindow', () => {
  it('says what the trainer chose, in their words', () => {
    expect(describeBookingWindow(KARLS)).toBe('Mon 15:00–17:00 · Wed 13:00–19:00')
    expect(describeBookingWindow(COMBINED)).toBe('Mon 15:00–17:00 · 12 Jan 2030 10:00')
    expect(describeBookingWindow(ANY_TIME_WINDOW)).toMatch(/any time/i)
  })
})
