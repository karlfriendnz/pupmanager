// WHEN a 1:1 offering can be booked.
//
// The trainer's general availability answers "when am I working". This answers
// "and of those hours, when does THIS offering actually run" — a behaviour
// consult the trainer takes on Monday afternoons and Wednesday afternoons, plus
// a one-off on the third of September.
//
// It describes the OFFERING, not the self-service counter: the trainer's own
// booking screens read it too, so placing a session themselves lands on the
// same slots a client would have been offered.
//
// ─── The shape ──────────────────────────────────────────────────────────────
// A window is ANY_TIME, or RESTRICTED to the UNION of:
//   • ranges — WEEKLY per-day hour bands. "Monday 15:00–17:00", "Wednesday
//     13:00–19:00". SEVERAL bands may share a day, which is the only way to
//     say "Monday mornings and Monday late afternoon".
//   • dates  — ONE-OFF dated starts. "2026-09-03 at 10:00." Fires once, on that
//     calendar date. A date in the past can never produce a slot again: it is
//     KEPT (a trainer's data is never silently deleted) but ignored when
//     resolving, and the editor shows it as expired.
// Either half may be empty. Both empty is not a restriction and resolves back
// to ANY_TIME rather than taking the offering off sale.
//
// A RECURRING exact start needs no third kind: a weekday band one session long
// says it ("Tue 09:00–10:00" offers only 09:00 for a 60-minute session). That
// is exactly what the legacy `{day,time}` entries are folded into, so nothing a
// trainer configured is lost.
//
// ─── The one rule ───────────────────────────────────────────────────────────
// A window NARROWS. It can never widen. Availability, blackouts and everything
// already in the diary are applied FIRST, by the existing lib/availability
// helpers, and a window only ever removes more from what's left. There is no
// path through this file that can invent a slot the trainer is not genuinely
// free for — see `withinPackageWindow`, which is an AND on top of those checks
// and never a replacement for them. A DATED entry is no exception: naming a
// date does not make the trainer free on it.
//
// ─── One source of truth ────────────────────────────────────────────────────
// The client's picker calls `bookableStartTimes`; the self-book route calls
// `checkBookableStart`; the trainer's assign screens call
// `findNextBookableStart`. All three funnel through `withinPackageWindow`, so
// the set of allowed times is decided in exactly one place. The route can't
// offer a different answer to the screen, which is the failure this file exists
// to prevent (a crafted POST is the case that matters — the screen won't offer
// a bad time, so the screen is not the guarantee).
//
// ─── Client vs trainer ──────────────────────────────────────────────────────
// The CLIENT path hard-refuses server-side. The TRAINER path only guides: it
// offers the window's slots first and says when a pick falls outside, but never
// refuses. A trainer is the boss of their own diary — see
// `findNextBookableStart`, whose fallback is the whole point.
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

export type PackageBookingMode = 'ANY_TIME' | 'RESTRICTED'

/** One weekly band this offering runs in — "Monday 15:00 to 17:00". */
export interface BookingRange {
  /** ISO weekday, 1=Mon..7=Sun — the convention every availability row and
   *  every helper in lib/availability uses. (PackageSessionSlot's `day` is
   *  0=Sun..6=Sat; do not copy it here.) */
  day: number
  /** "HH:MM", 24h, trainer-local wall clock. */
  start: string
  end: string
}

/** One one-off start on a real calendar date — "2026-09-03 at 10:00". */
export interface DatedBookingTime {
  /** "YYYY-MM-DD", trainer-local calendar date. */
  date: string
  /** "HH:MM", 24h. */
  time: string
}

export interface PackageBookingWindow {
  mode: PackageBookingMode
  /** Weekly bands. Several may share a day. */
  ranges: BookingRange[]
  /** One-off dated starts, unioned with the bands above. */
  dates: DatedBookingTime[]
}

/** What every offering created before this feature existed means, and the
 *  default for every new one: book anywhere the trainer is free. */
export const ANY_TIME_WINDOW: PackageBookingWindow = { mode: 'ANY_TIME', ranges: [], dates: [] }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const YMD = /^\d{4}-\d{2}-\d{2}$/

function isHhmm(v: unknown): v is string {
  return typeof v === 'string' && HHMM.test(v)
}

function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !YMD.test(v)) return false
  // Reject 2026-02-31 and friends: a date the trainer can never reach would sit
  // in the editor looking like a live rule and never produce a slot.
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function isIsoDay(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7
}

function sortRanges(a: BookingRange, b: BookingRange): number {
  return a.day - b.day || a.start.localeCompare(b.start) || a.end.localeCompare(b.end)
}

function sortDates(a: DatedBookingTime, b: DatedBookingTime): number {
  return a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
}

/** "HH:MM" that is `mins` after `time`, clamped at 23:59 so a late start can
 *  never wrap past midnight into an end BEFORE its start. */
function addMinsClamped(time: string, mins: number): string {
  const total = Math.min(hhmmToMins(time) + Math.max(1, mins), 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * A stored Package row (or an API payload) → the window, normalised.
 *
 * Defensive on purpose: these are Json columns, so a row written before the
 * feature, half-written by a script, or hand-edited must still resolve to
 * something. Anything that doesn't parse falls back to ANY_TIME — the mode that
 * changes nothing — rather than to a window that would silently block booking.
 *
 * It also folds in BOTH legacy shapes, because production is behind on
 * migrations and a row the deploy hasn't reached must still resolve to the
 * window it always had:
 *   • bookingWindowDays + one start/end → one band per day;
 *   • bookingWindowTimes `{day,time}`   → a band one session long.
 * The SQL migrations do the identical thing; this is the belt to their braces.
 */
export function packageBookingWindow(pkg: {
  bookingWindowMode?: string | null
  bookingWindowRanges?: unknown
  bookingWindowDates?: unknown
  /** Session length, used only to fold a legacy weekday exact start into a
   *  band. Absent falls back to an hour, which is this app's default session. */
  durationMins?: number | null
  // Legacy — see above.
  bookingWindowTimes?: unknown
  bookingWindowDays?: unknown
  bookingWindowStart?: string | null
  bookingWindowEnd?: string | null
} | null | undefined): PackageBookingWindow {
  const mode = pkg?.bookingWindowMode
  if (!mode || mode === 'ANY_TIME') return ANY_TIME_WINDOW

  // ── Weekly bands ──────────────────────────────────────────────────────────
  const rangeRows = Array.isArray(pkg?.bookingWindowRanges) ? pkg!.bookingWindowRanges : []
  const seenRange = new Set<string>()
  const ranges: BookingRange[] = []
  const addRange = (day: number, start: string, end: string) => {
    if (hhmmToMins(end) <= hhmmToMins(start)) return
    const key = `${day}:${start}:${end}`
    if (seenRange.has(key)) return
    seenRange.add(key)
    ranges.push({ day, start, end })
  }
  for (const r of rangeRows) {
    if (!r || typeof r !== 'object') continue
    const { day, start, end } = r as { day?: unknown; start?: unknown; end?: unknown }
    if (!isIsoDay(day) || !isHhmm(start) || !isHhmm(end)) continue
    addRange(day, start, end)
  }

  // ── Legacy fold 1: a weekday exact start → a band one session long ────────
  // Always applied, not only when there are no modern ranges: these are a
  // DIFFERENT rule from the bands, so dropping them when a band exists would
  // lose a time the trainer set. The dedupe above makes a double-migration a
  // no-op.
  const duration = typeof pkg?.durationMins === 'number' && pkg.durationMins > 0 ? pkg.durationMins : 60
  const legacyTimes = Array.isArray(pkg?.bookingWindowTimes) ? pkg!.bookingWindowTimes : []
  for (const t of legacyTimes) {
    if (!t || typeof t !== 'object') continue
    const { day, time } = t as { day?: unknown; time?: unknown }
    if (!isIsoDay(day) || !isHhmm(time)) continue
    addRange(day, time, addMinsClamped(time, duration))
  }

  // ── Legacy fold 2: one band applied to a list of days ─────────────────────
  // Only when nothing above produced a band, so a migrated row can't take the
  // same band twice.
  if (ranges.length === 0) {
    const legacyStart = isHhmm(pkg?.bookingWindowStart) ? pkg!.bookingWindowStart! : null
    const legacyEnd = isHhmm(pkg?.bookingWindowEnd) ? pkg!.bookingWindowEnd! : null
    const legacyDays = Array.isArray(pkg?.bookingWindowDays) ? pkg!.bookingWindowDays.filter(isIsoDay) : []
    if (legacyStart && legacyEnd) {
      for (const day of [...new Set(legacyDays)]) addRange(day, legacyStart, legacyEnd)
    }
  }

  // ── One-off dated starts ──────────────────────────────────────────────────
  const dateRows = Array.isArray(pkg?.bookingWindowDates) ? pkg!.bookingWindowDates : []
  const seenDate = new Set<string>()
  const dates: DatedBookingTime[] = []
  for (const d of dateRows) {
    if (!d || typeof d !== 'object') continue
    const { date, time } = d as { date?: unknown; time?: unknown }
    if (!isYmd(date) || !isHhmm(time)) continue
    const key = `${date}:${time}`
    if (seenDate.has(key)) continue
    seenDate.add(key)
    dates.push({ date, time })
  }

  // Restricted to nothing is not a restriction. A row that lost its window must
  // not take a working offering off sale with no way for the trainer to see why.
  if (ranges.length === 0 && dates.length === 0) return ANY_TIME_WINDOW

  ranges.sort(sortRanges)
  dates.sort(sortDates)
  return { mode: 'RESTRICTED', ranges, dates }
}

/**
 * THE narrowing predicate. Does a session of `durationMins` starting at
 * `startMin` (minutes past trainer-local midnight) on `dateStr` fall inside
 * what this offering is on offer for?
 *
 * The union: inside ANY weekly band, or exactly ON any dated start.
 *
 * Says NOTHING about the trainer's availability, blackouts or existing
 * bookings — those are checked separately and always. This only ever subtracts.
 * A past dated entry simply never matches a future date, so it drops out here
 * with no special case.
 */
export function withinPackageWindow(
  window: PackageBookingWindow,
  dateStr: string,
  startMin: number,
  durationMins: number,
): boolean {
  if (window.mode === 'ANY_TIME') return true
  const dow = isoDowForDateStr(dateStr)
  // Inside a band — the WHOLE session must fit, the same rule the availability
  // window itself applies, so "3–5" never means a 90-minute session running to
  // half past five.
  const inRange = window.ranges.some(
    r => r.day === dow && startMin >= hhmmToMins(r.start) && startMin + durationMins <= hhmmToMins(r.end),
  )
  if (inRange) return true
  // Or ON a dated start, that date, to the minute.
  return window.dates.some(d => d.date === dateStr && hhmmToMins(d.time) === startMin)
}

export interface BookableTimesArgs {
  slots: AvailabilityRow[]
  blackouts: BlackoutRow[]
  busy: BusyInterval[]
  dateStr: string
  durationMins: number
  /** The offering's turnaround gap — blocks it butting against a booking. */
  bufferMins?: number
  /** Picker granularity for the weekly half. The dated half ignores it — those
   *  starts are named outright and need not sit on any grid. */
  stepMins?: number
  window: PackageBookingWindow
}

/**
 * Every start time ("HH:MM", trainer-local) this offering may be booked at on
 * `dateStr`. The single entry point for every picker.
 *
 * ANY_TIME returns exactly what enumerateStartTimes has always returned — the
 * default path is byte-for-byte unchanged.
 *
 * RESTRICTED returns the union of the two halves:
 *   • the bands take that same availability-anchored grid and FILTER it, so
 *     nothing can be added;
 *   • the dated starts begin from the NAMED time instead (10:20 on the third is
 *     a perfectly reasonable thing for a trainer to say, and no grid would
 *     produce it) and then go through the identical availability, blackout and
 *     collision checks. Starting from the smaller set is still narrowing: a
 *     named time survives only if the trainer is genuinely free for it.
 */
export function bookableStartTimes(args: BookableTimesArgs): string[] {
  const { slots, blackouts, busy, dateStr, durationMins, window } = args
  const buffer = args.bufferMins ?? 0
  const step = args.stepMins ?? 30

  const grid = enumerateStartTimes(slots, dateStr, durationMins, blackouts, step, busy, buffer)
  if (window.mode === 'ANY_TIME') return grid

  const dow = isoDowForDateStr(dateStr)
  const out = new Set<string>()

  // Half one — the weekly bands, as a filter over the grid.
  if (window.ranges.some(r => r.day === dow)) {
    for (const time of grid) {
      if (withinPackageWindow(window, dateStr, hhmmToMins(time), durationMins)) out.add(time)
    }
  }

  // Half two — the dated starts, each through the same gates the grid already
  // passed. Added even when a band already produced them; the Set dedupes.
  for (const d of window.dates) {
    if (d.date !== dateStr) continue
    const startMin = hhmmToMins(d.time)
    if (!isTimeWithinAvailability(slots, dateStr, startMin, durationMins, blackouts)) continue
    if (overlapsBusy(busy, dateStr, startMin, durationMins, buffer)) continue
    out.add(d.time)
  }

  return [...out].sort()
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

// ─── The trainer's own booking paths ────────────────────────────────────────

/** Local YYYY-MM-DD, matching findNextAvailable's local-day arithmetic — the
 *  trainer's assign screens work in browser-local days, not trainer-tz days. */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A dated entry whose date has been and gone. Kept in storage — a trainer's
 *  data is never silently deleted — but it can never produce a slot again, so
 *  the editor greys it out rather than showing it as a live rule. */
export function isExpiredDate(entry: DatedBookingTime, today: string): boolean {
  return entry.date < today
}

/** True when a RESTRICTED window's only content is dated entries that have all
 *  expired — it looks configured and offers nothing. The zero-slot preview
 *  catches this too; this names it for the editor. */
export function windowIsAllExpired(window: PackageBookingWindow, today: string): boolean {
  if (window.mode === 'ANY_TIME') return false
  if (window.ranges.length > 0) return false
  return window.dates.length > 0 && window.dates.every(d => isExpiredDate(d, today))
}

export interface NextBookableArgs {
  slots: AvailabilityRow[]
  blackouts?: BlackoutRow[]
  busy?: BusyInterval[]
  /** Search starts on this DAY; its time of day is ignored. */
  from: Date
  durationMins: number
  bufferMins?: number
  stepMins?: number
  maxDays?: number
  window: PackageBookingWindow
}

/**
 * The earliest moment this offering can next be placed, walking forward from
 * `from` — the trainer-side counterpart to the client's picker.
 *
 * ─── GUIDES, DOES NOT BLOCK ─────────────────────────────────────────────────
 * When the window yields nothing at all in the search span, this falls back to
 * the trainer's plain availability and reports `insideWindow: false`. It never
 * returns null just because the offering's own hours are busy, or because the
 * trainer set a window they can't honour this month, or because every dated
 * entry has expired.
 *
 * That asymmetry is deliberate and is the design decision of this whole file.
 * The CLIENT path hard-refuses an out-of-window time server-side, because the
 * window is a promise made to clients. The TRAINER is the person who made the
 * promise and the only one who can knowingly break it — refusing to let them
 * put a session in their own diary would be the app telling its owner no. So
 * they get the window's slots offered FIRST, and a warning when one lands
 * outside.
 */
export function findNextBookableStart(args: NextBookableArgs): { at: Date; insideWindow: boolean } | null {
  const { slots } = args
  const blackouts = args.blackouts ?? []
  const busy = args.busy ?? []
  const maxDays = args.maxDays ?? 60
  const cursor = new Date(args.from)
  cursor.setHours(0, 0, 0, 0)

  const search = (window: PackageBookingWindow): Date | null => {
    for (let i = 0; i < maxDays; i++) {
      const day = new Date(cursor)
      day.setDate(day.getDate() + i)
      const found = bookableStartTimes({
        slots, blackouts, busy,
        dateStr: localDateStr(day),
        durationMins: args.durationMins,
        bufferMins: args.bufferMins,
        stepMins: args.stepMins,
        window,
      })
      if (found.length === 0) continue
      const [h, m] = found[0].split(':').map(Number)
      const at = new Date(day)
      at.setHours(h, m, 0, 0)
      return at
    }
    return null
  }

  const inWindow = search(args.window)
  if (inWindow) return { at: inWindow, insideWindow: true }
  if (args.window.mode === 'ANY_TIME') return null
  // Nothing in the offering's own hours. Don't stop the trainer — place it in
  // their general availability and let the screen say so.
  const anywhere = search(ANY_TIME_WINDOW)
  return anywhere ? { at: anywhere, insideWindow: false } : null
}

/**
 * Does a time the TRAINER picked sit inside the offering's window? For the
 * warning on their screen — never for a refusal. Always true when there is no
 * window, so callers need no special case.
 */
export function trainerPickInsideWindow(
  window: PackageBookingWindow,
  at: Date,
  durationMins: number,
): boolean {
  if (window.mode === 'ANY_TIME') return true
  return withinPackageWindow(window, localDateStr(at), at.getHours() * 60 + at.getMinutes(), durationMins)
}

// ─── Describing it ──────────────────────────────────────────────────────────

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** ISO weekday → short name, for the trainer's summary line. */
export function isoDayName(day: number): string {
  return DAY_NAMES[day - 1] ?? '?'
}

/** "2026-09-03" → "3 Sep". Derived from the string, never via a Date with a
 *  timezone — a noon-UTC instant tips onto the wrong day for NZ. */
export function shortDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const month = MONTH_NAMES[m - 1] ?? '?'
  const thisYear = new Date().getFullYear()
  return y === thisYear ? `${d} ${month}` : `${d} ${month} ${y}`
}

/** One plain sentence describing the window, for the offering form, the
 *  offering list and the trainer's out-of-window warning. */
export function describeBookingWindow(window: PackageBookingWindow): string {
  if (window.mode === 'ANY_TIME') return 'Any time you’re free'
  const parts = [
    ...window.ranges.map(r => `${isoDayName(r.day)} ${r.start}–${r.end}`),
    ...window.dates.map(d => `${shortDateLabel(d.date)} ${d.time}`),
  ]
  return parts.join(' · ')
}

// ─── Guards ─────────────────────────────────────────────────────────────────
// Shared by the trainer's form AND the two package APIs. The form showing a
// message is not what makes a rule true (see AGENTS.md #3) — the route calls
// the identical function, so the two cannot drift into disagreeing.

/** The raw shape both the form and the API validate before storing. */
export interface BookingWindowInput {
  mode: PackageBookingMode
  ranges: BookingRange[]
  dates: DatedBookingTime[]
}

/** A partial API payload → the full input shape, with absent halves empty
 *  rather than undefined. */
export function bookingWindowInput(raw?: {
  mode: PackageBookingMode
  ranges?: BookingRange[]
  dates?: DatedBookingTime[]
} | null): BookingWindowInput {
  if (!raw) return { mode: 'ANY_TIME', ranges: [], dates: [] }
  return { mode: raw.mode, ranges: raw.ranges ?? [], dates: raw.dates ?? [] }
}

/**
 * `null` when the window is storable, otherwise the sentence to show. Rules:
 * a restricted window must actually contain something, every band must run
 * forwards, every date must be a real date, and nothing may be listed twice.
 *
 * Two bands on the SAME day are fine — that is the point of per-day ranges —
 * and so are overlapping bands: they describe the same hours twice, which
 * produces the same set of slots, so refusing them would be pedantry that
 * blocks a save for no benefit. Identical bands are silently de-duplicated.
 *
 * A date in the PAST is NOT refused. The trainer may be editing an offering
 * that has run; making them delete history to save a price change would be
 * hostile. It simply stops producing slots, and the editor says "expired".
 */
export function validateBookingWindow(input: BookingWindowInput): string | null {
  if (input.mode === 'ANY_TIME') return null
  if (input.ranges.length === 0 && input.dates.length === 0) {
    return 'Add at least one day, or one exact date and time.'
  }
  for (const r of input.ranges) {
    if (!isIsoDay(r.day) || !isHhmm(r.start) || !isHhmm(r.end)) return 'Those days and times aren’t valid.'
    if (hhmmToMins(r.end) <= hhmmToMins(r.start)) {
      return `${isoDayName(r.day)} has to end after it starts.`
    }
  }
  const seen = new Set<string>()
  for (const d of input.dates) {
    if (!isYmd(d.date)) return 'Pick a real date for every exact start time.'
    if (!isHhmm(d.time)) return 'Pick a start time for every exact date.'
    const key = `${d.date}:${d.time}`
    if (seen.has(key)) return `${shortDateLabel(d.date)} at ${d.time} is listed twice.`
    seen.add(key)
  }
  return null
}

/**
 * A band / dated start as it sits in the Json column. The index signature is
 * what makes it assignable to Prisma's InputJsonValue — a plain interface is
 * not, and the routes would need a cast at every call site.
 */
export interface StoredRange {
  [key: string]: string | number
  day: number
  start: string
  end: string
}
export interface StoredDate {
  [key: string]: string
  date: string
  time: string
}

/** What the window becomes on the row. */
export interface BookingWindowColumns {
  bookingWindowMode: PackageBookingMode
  bookingWindowRanges: StoredRange[]
  bookingWindowDates: StoredDate[]
  // The legacy columns are always CLEARED. Their meaning has moved into the two
  // above, and leaving stale content behind would have the reader's legacy
  // folds quietly resurrect it.
  bookingWindowTimes: never[]
  bookingWindowDays: number[]
  bookingWindowStart: null
  bookingWindowEnd: null
}

/** The columns to write, from a validated input. */
export function bookingWindowColumns(input: BookingWindowInput): BookingWindowColumns {
  const cleared: Pick<
    BookingWindowColumns,
    'bookingWindowTimes' | 'bookingWindowDays' | 'bookingWindowStart' | 'bookingWindowEnd'
  > = { bookingWindowTimes: [], bookingWindowDays: [], bookingWindowStart: null, bookingWindowEnd: null }

  if (input.mode !== 'RESTRICTED' || (input.ranges.length === 0 && input.dates.length === 0)) {
    return { bookingWindowMode: 'ANY_TIME', bookingWindowRanges: [], bookingWindowDates: [], ...cleared }
  }
  const seenRange = new Set<string>()
  const ranges: StoredRange[] = []
  for (const r of [...input.ranges].sort(sortRanges)) {
    const key = `${r.day}:${r.start}:${r.end}`
    if (seenRange.has(key)) continue
    seenRange.add(key)
    ranges.push({ day: r.day, start: r.start, end: r.end })
  }
  const seenDate = new Set<string>()
  const dates: StoredDate[] = []
  for (const d of [...input.dates].sort(sortDates)) {
    const key = `${d.date}:${d.time}`
    if (seenDate.has(key)) continue
    seenDate.add(key)
    dates.push({ date: d.date, time: d.time })
  }
  return { bookingWindowMode: 'RESTRICTED', bookingWindowRanges: ranges, bookingWindowDates: dates, ...cleared }
}
