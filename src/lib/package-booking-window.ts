// WHEN a client may self-book a 1:1 offering.
//
// The trainer's general availability answers "when am I working". This answers
// "and of those hours, which ones is THIS offering on offer in" — a puppy
// assessment the trainer only wants to run on Tuesday and Thursday mornings, or
// only at 9:00 and 10:30 sharp.
//
// ─── The one rule ───────────────────────────────────────────────────────────
// A package window NARROWS. It can never widen. Availability, blackouts and
// everything already in the diary are applied FIRST, by the existing
// lib/availability helpers, and a window only ever removes more from what's
// left. There is no path through this file that can invent a slot the trainer
// is not genuinely free for — see `withinPackageWindow`, which is an AND on top
// of those checks and never a replacement for them.
//
// ─── One source of truth ────────────────────────────────────────────────────
// The client's picker calls `bookableStartTimes`; the self-book route calls
// `checkBookableStart`. Both funnel through `withinPackageWindow`, so the set
// of allowed times is decided in exactly one place. The route can't offer a
// different answer to the screen, which is the failure this file exists to
// prevent (a crafted POST is the case that matters — the screen won't offer a
// bad time, so the screen is not the guarantee).
//
// This mirrors how the public booking page already chooses its availability
// source (lib/booking-slots.ts, fetchBookingSlots) rather than inventing a
// second design for the same idea.
import {
  enumerateStartTimes,
  isTimeWithinAvailability,
  overlapsBusy,
  isoDowForDateStr,
  hhmmToMins,
  type AvailabilityRow,
  type BlackoutRow,
  type BusyInterval,
} from './availability'

export type PackageBookingMode = 'ANY_TIME' | 'WEEKLY_WINDOW' | 'EXACT_TIMES'

/** One named start on an EXACT_TIMES offering — "Tuesday, 09:00". */
export interface ExactBookingTime {
  /** ISO weekday, 1=Mon..7=Sun — the same convention every availability row
   *  and every helper in lib/availability uses. (PackageSessionSlot's `day` is
   *  0=Sun..6=Sat; do not copy it here.) */
  day: number
  /** "HH:MM", 24h, trainer-local wall clock. */
  time: string
}

export interface PackageBookingWindow {
  mode: PackageBookingMode
  /** WEEKLY_WINDOW: ISO weekdays the offering runs on. */
  days: number[]
  /** WEEKLY_WINDOW: "HH:MM" bounds. The WHOLE session must fit between them. */
  startTime: string | null
  endTime: string | null
  /** EXACT_TIMES: the named starts. */
  times: ExactBookingTime[]
}

/** What every offering created before this feature existed means, and the
 *  default for every new one: pick from the trainer's general availability. */
export const ANY_TIME_WINDOW: PackageBookingWindow = {
  mode: 'ANY_TIME',
  days: [],
  startTime: null,
  endTime: null,
  times: [],
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function isHhmm(v: unknown): v is string {
  return typeof v === 'string' && HHMM.test(v)
}

function isIsoDay(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7
}

/**
 * A stored Package row (or an API payload) → the window, normalised.
 *
 * Defensive on purpose: these are two Json columns, so a row written before the
 * feature, half-written by a script, or hand-edited must still resolve to
 * something. Anything that doesn't parse falls back to ANY_TIME — the mode that
 * changes nothing — rather than to a window that would silently block booking.
 */
export function packageBookingWindow(pkg: {
  bookingWindowMode?: string | null
  bookingWindowDays?: unknown
  bookingWindowStart?: string | null
  bookingWindowEnd?: string | null
  bookingWindowTimes?: unknown
} | null | undefined): PackageBookingWindow {
  const mode = pkg?.bookingWindowMode
  if (mode === 'WEEKLY_WINDOW') {
    const days = Array.isArray(pkg?.bookingWindowDays)
      ? [...new Set(pkg!.bookingWindowDays.filter(isIsoDay))].sort((a, b) => a - b)
      : []
    const startTime = isHhmm(pkg?.bookingWindowStart) ? pkg!.bookingWindowStart! : null
    const endTime = isHhmm(pkg?.bookingWindowEnd) ? pkg!.bookingWindowEnd! : null
    // An unusable window is NOT treated as "block everything" — a row that lost
    // its hours would take a working offering off sale with no way for the
    // trainer to see why. It reverts to the mode that changes nothing.
    if (days.length === 0 || !startTime || !endTime || hhmmToMins(endTime) <= hhmmToMins(startTime)) {
      return ANY_TIME_WINDOW
    }
    return { mode: 'WEEKLY_WINDOW', days, startTime, endTime, times: [] }
  }
  if (mode === 'EXACT_TIMES') {
    const raw = Array.isArray(pkg?.bookingWindowTimes) ? pkg!.bookingWindowTimes : []
    const seen = new Set<string>()
    const times: ExactBookingTime[] = []
    for (const t of raw) {
      if (!t || typeof t !== 'object') continue
      const { day, time } = t as { day?: unknown; time?: unknown }
      if (!isIsoDay(day) || !isHhmm(time)) continue
      const key = `${day}:${time}`
      if (seen.has(key)) continue
      seen.add(key)
      times.push({ day, time })
    }
    if (times.length === 0) return ANY_TIME_WINDOW
    times.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
    return { mode: 'EXACT_TIMES', days: [], startTime: null, endTime: null, times }
  }
  return ANY_TIME_WINDOW
}

/**
 * THE narrowing predicate. Does a session of `durationMins` starting at
 * `startMin` (minutes past trainer-local midnight) on `dateStr` fall inside
 * what this offering is on offer for?
 *
 * Says NOTHING about the trainer's availability, blackouts or existing
 * bookings — those are checked separately and always. This only ever subtracts.
 */
export function withinPackageWindow(
  window: PackageBookingWindow,
  dateStr: string,
  startMin: number,
  durationMins: number,
): boolean {
  if (window.mode === 'ANY_TIME') return true
  const dow = isoDowForDateStr(dateStr)
  if (window.mode === 'WEEKLY_WINDOW') {
    if (!window.days.includes(dow)) return false
    if (!window.startTime || !window.endTime) return false
    // The whole session must fit — the same rule the availability window itself
    // applies, so "9am–1pm" never means a 90-minute session running to 2pm.
    return startMin >= hhmmToMins(window.startTime) && startMin + durationMins <= hhmmToMins(window.endTime)
  }
  // EXACT_TIMES — the start must BE one of the named ones, to the minute.
  return window.times.some(t => t.day === dow && hhmmToMins(t.time) === startMin)
}

export interface BookableTimesArgs {
  slots: AvailabilityRow[]
  blackouts: BlackoutRow[]
  busy: BusyInterval[]
  dateStr: string
  durationMins: number
  /** The offering's turnaround gap — blocks it butting against a booking. */
  bufferMins?: number
  /** Picker granularity for ANY_TIME / WEEKLY_WINDOW. Ignored by EXACT_TIMES,
   *  whose starts are named outright and need not sit on any grid. */
  stepMins?: number
  window: PackageBookingWindow
}

/**
 * Every start time ("HH:MM", trainer-local) a client may book this offering at
 * on `dateStr`. The single entry point for the picker.
 *
 * ANY_TIME returns exactly what enumerateStartTimes has always returned — the
 * default path is byte-for-byte unchanged.
 *
 * WEEKLY_WINDOW takes that same list and filters it, so nothing can be added.
 *
 * EXACT_TIMES starts from the NAMED times instead of the step grid (10:20 is a
 * perfectly reasonable thing for a trainer to name, and no grid would produce
 * it) and then puts each one through the identical availability, blackout and
 * collision checks. Starting from the smaller set is still narrowing: a named
 * time survives only if the trainer is genuinely free for it.
 */
export function bookableStartTimes(args: BookableTimesArgs): string[] {
  const { slots, blackouts, busy, dateStr, durationMins, window } = args
  const buffer = args.bufferMins ?? 0
  const step = args.stepMins ?? 30

  if (window.mode === 'EXACT_TIMES') {
    const dow = isoDowForDateStr(dateStr)
    return window.times
      .filter(t => t.day === dow)
      .map(t => t.time)
      .filter(time => {
        const startMin = hhmmToMins(time)
        // Same three gates the general path applies, in the same order.
        if (!isTimeWithinAvailability(slots, dateStr, startMin, durationMins, blackouts)) return false
        if (overlapsBusy(busy, dateStr, startMin, durationMins, buffer)) return false
        return true
      })
      .sort()
  }

  const all = enumerateStartTimes(slots, dateStr, durationMins, blackouts, step, busy, buffer)
  if (window.mode === 'ANY_TIME') return all
  return all.filter(time => withinPackageWindow(window, dateStr, hhmmToMins(time), durationMins))
}

/** Why a chosen time can't be booked. Distinct reasons because the client
 *  deserves a distinct sentence — "that's just been taken" and "we don't run
 *  that offering then" are different problems with different next steps. */
export type UnbookableReason = 'unavailable' | 'taken' | 'outside-window'

export interface CheckStartArgs {
  slots: AvailabilityRow[]
  blackouts: BlackoutRow[]
  busy: BusyInterval[]
  dateStr: string
  /** Minutes past trainer-local midnight. */
  startMin: number
  durationMins: number
  bufferMins?: number
  window: PackageBookingWindow
}

/**
 * The server's single check on a chosen instant. Deliberately NOT implemented
 * as "is it in bookableStartTimes": an ANY_TIME booking has never had to land
 * on the picker's 30-minute grid, and making it do so now would start refusing
 * times that book fine today. The three gates are applied directly instead, and
 * the third is the very same `withinPackageWindow` the picker filters with.
 */
export function checkBookableStart(args: CheckStartArgs): { ok: true } | { ok: false; reason: UnbookableReason } {
  const { slots, blackouts, busy, dateStr, startMin, durationMins, window } = args
  if (!isTimeWithinAvailability(slots, dateStr, startMin, durationMins, blackouts)) {
    return { ok: false, reason: 'unavailable' }
  }
  if (overlapsBusy(busy, dateStr, startMin, durationMins, args.bufferMins ?? 0)) {
    return { ok: false, reason: 'taken' }
  }
  if (!withinPackageWindow(window, dateStr, startMin, durationMins)) {
    return { ok: false, reason: 'outside-window' }
  }
  return { ok: true }
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** ISO weekday → short name, for the trainer's summary line. */
export function isoDayName(day: number): string {
  return DAY_NAMES[day - 1] ?? '?'
}

/** One plain sentence describing the window, for the offering form and the
 *  offering list. Never shown to clients — they see the times themselves. */
export function describeBookingWindow(window: PackageBookingWindow): string {
  if (window.mode === 'WEEKLY_WINDOW') {
    return `${window.days.map(isoDayName).join(', ')} · ${window.startTime}–${window.endTime}`
  }
  if (window.mode === 'EXACT_TIMES') {
    return window.times.map(t => `${isoDayName(t.day)} ${t.time}`).join(', ')
  }
  return 'Any time you’re free'
}

// ─── Guards ─────────────────────────────────────────────────────────────────
// Shared by the trainer's form AND the two package APIs. The form showing a
// message is not what makes a rule true (see AGENTS.md #3) — the route calls
// the identical function, so the two cannot drift into disagreeing.

/** The raw shape both the form and the API validate before storing. */
export interface BookingWindowInput {
  mode: PackageBookingMode
  days: number[]
  startTime: string | null
  endTime: string | null
  times: ExactBookingTime[]
}

/** A partial API payload → the full input shape, with the absent halves of the
 *  chosen mode as empty rather than undefined. */
export function bookingWindowInput(raw?: {
  mode: PackageBookingMode
  days?: number[]
  startTime?: string | null
  endTime?: string | null
  times?: ExactBookingTime[]
} | null): BookingWindowInput {
  if (!raw) return { ...ANY_TIME_WINDOW }
  return {
    mode: raw.mode,
    days: raw.days ?? [],
    startTime: raw.startTime ?? null,
    endTime: raw.endTime ?? null,
    times: raw.times ?? [],
  }
}

/**
 * `null` when the window is storable, otherwise the sentence to show. Rules:
 * a non-ANY_TIME window must actually contain something, its hours must run
 * forwards, and it must not name the same start twice.
 */
export function validateBookingWindow(input: BookingWindowInput): string | null {
  if (input.mode === 'ANY_TIME') return null
  if (input.mode === 'WEEKLY_WINDOW') {
    if (input.days.length === 0) return 'Pick at least one day clients can book this on.'
    if (input.days.some(d => !isIsoDay(d))) return 'Those days aren’t valid.'
    if (!isHhmm(input.startTime) || !isHhmm(input.endTime)) return 'Set a start and end time for the window.'
    if (hhmmToMins(input.endTime!) <= hhmmToMins(input.startTime!)) return 'The window has to end after it starts.'
    return null
  }
  if (input.times.length === 0) return 'Add at least one start time clients can book.'
  if (input.times.some(t => !isIsoDay(t.day) || !isHhmm(t.time))) return 'Those start times aren’t valid.'
  const seen = new Set<string>()
  for (const t of input.times) {
    const key = `${t.day}:${t.time}`
    if (seen.has(key)) return `${isoDayName(t.day)} ${t.time} is listed twice.`
    seen.add(key)
  }
  return null
}

/**
 * An exact time as it sits in the Json column. The index signature is what
 * makes it assignable to Prisma's InputJsonValue — a plain interface is not,
 * and the routes would need a cast at every call site.
 */
export interface StoredExactTime {
  [key: string]: string | number
  day: number
  time: string
}

/** What the two Json columns and three scalars become. */
export interface BookingWindowColumns {
  bookingWindowMode: PackageBookingMode
  bookingWindowDays: number[]
  bookingWindowStart: string | null
  bookingWindowEnd: string | null
  bookingWindowTimes: StoredExactTime[]
}

/** The columns to write, from a validated input. Modes clear each other's
 *  fields, so switching back to "any time" leaves no window behind to be
 *  resurrected by a later mode change. */
export function bookingWindowColumns(input: BookingWindowInput): BookingWindowColumns {
  if (input.mode === 'WEEKLY_WINDOW') {
    return {
      bookingWindowMode: 'WEEKLY_WINDOW',
      bookingWindowDays: [...new Set(input.days)].sort((a, b) => a - b),
      bookingWindowStart: input.startTime,
      bookingWindowEnd: input.endTime,
      bookingWindowTimes: [],
    }
  }
  if (input.mode === 'EXACT_TIMES') {
    return {
      bookingWindowMode: 'EXACT_TIMES',
      bookingWindowDays: [],
      bookingWindowStart: null,
      bookingWindowEnd: null,
      bookingWindowTimes: [...input.times]
        .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
        .map(t => ({ day: t.day, time: t.time })),
    }
  }
  return {
    bookingWindowMode: 'ANY_TIME',
    bookingWindowDays: [],
    bookingWindowStart: null,
    bookingWindowEnd: null,
    bookingWindowTimes: [],
  }
}
