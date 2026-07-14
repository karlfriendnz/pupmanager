// Pure helpers for finding the next slot a session can occupy inside a trainer's
// declared availability. Used by package-assignment flows that need to schedule
// N sessions without putting them outside the trainer's working hours.

export interface AvailabilityRow {
  id: string
  // 1=Mon … 7=Sun for recurring slots, null for one-off date-specific slots
  dayOfWeek: number | null
  // YYYY-MM-DD for one-off slots, null for recurring
  date: string | null
  // "HH:MM" 24h
  startTime: string
  endTime: string
  // 1 = weekly (default). 2 = fortnightly, etc. Only used when dayOfWeek is set.
  cadenceWeeks?: number
  // YYYY-MM-DD anchor used to compute parity for cadenceWeeks > 1.
  firstDate?: string | null
}

export interface BlackoutRow {
  startDate: string  // YYYY-MM-DD inclusive
  endDate: string    // YYYY-MM-DD inclusive
}

// An already-occupied stretch of a trainer's day (an existing booking), in
// trainer-local minutes-of-day on a specific date. The trainer runs one
// session at a time, so a proposed start that overlaps any of these is taken.
export interface BusyInterval {
  dateStr: string  // YYYY-MM-DD (trainer-local)
  startMin: number
  endMin: number
  // Turnaround gap hanging off the END of this booking (travel / clean-up).
  // Nothing may start before endMin + bufferMins. Absent/0 = back-to-back.
  bufferMins?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function jsDayToIso(d: Date): number {
  // JS getDay: 0=Sun..6=Sat. Schema: 1=Mon..7=Sun.
  const js = d.getDay()
  return js === 0 ? 7 : js
}

function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * Walk forward from `from` (a date — its time-of-day is ignored) up to
 * `maxDays` days, looking for the first availability slot wide enough for
 * `durationMins`. Returns the slot's start as a Date, or null if nothing fits.
 *
 * Selection rule when multiple slots match a given day: pick the one with the
 * earliest startTime. Slots whose endTime - startTime < durationMins are
 * skipped — a 60-minute session does not fit a 30-minute slot.
 */
// Snap a UTC date to the start of its (Mon-anchored) week. Used for cadence
// parity so the trainer's chosen "first occurrence" doesn't have to land on
// the same weekday as the slot — picking any date inside the starting week
// works.
function startOfIsoWeekUTC(date: Date): number {
  const day = date.getUTCDay()  // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day
  const m = new Date(date)
  m.setUTCDate(m.getUTCDate() + diff)
  m.setUTCHours(0, 0, 0, 0)
  return m.getTime()
}

export function slotAppliesOnDate(slot: AvailabilityRow, dateStr: string, isoDow: number): boolean {
  if (slot.date) return slot.date === dateStr
  if (slot.dayOfWeek !== isoDow) return false
  const cadence = slot.cadenceWeeks ?? 1
  if (cadence <= 1) return true
  if (!slot.firstDate) return true
  const target = new Date(`${dateStr}T00:00:00Z`)
  const anchor = new Date(`${slot.firstDate}T00:00:00Z`)
  const targetWeek = startOfIsoWeekUTC(target)
  const anchorWeek = startOfIsoWeekUTC(anchor)
  if (targetWeek < anchorWeek) return false
  const weeks = Math.round((targetWeek - anchorWeek) / (7 * DAY_MS))
  return weeks % cadence === 0
}

export function isBlackoutDate(blackouts: BlackoutRow[], dateStr: string): boolean {
  return blackouts.some(b => b.startDate <= dateStr && dateStr <= b.endDate)
}

/**
 * True when a session of `durationMins` starting at `startMin` (minutes past
 * midnight, trainer-local) on `dateStr` overlaps any existing booking. Standard
 * half-open interval overlap: startA < endB && startB < endA.
 *
 * Buffers extend BOTH sides: an existing booking blocks until its endMin +
 * its own bufferMins, and the proposed session blocks until its end + its own
 * `bufferMins` (so it can't be wedged in immediately before an existing one —
 * its turnaround would run into it). Starting at the exact minute a buffer
 * ends is allowed; a minute earlier is not.
 */
export function overlapsBusy(
  busy: BusyInterval[],
  dateStr: string,
  startMin: number,
  durationMins: number,
  bufferMins = 0,
): boolean {
  const end = startMin + durationMins + Math.max(0, bufferMins)
  return busy.some(
    b => b.dateStr === dateStr && startMin < b.endMin + Math.max(0, b.bufferMins ?? 0) && b.startMin < end,
  )
}

// ISO day-of-week (1=Mon..7=Sun) for a YYYY-MM-DD string, computed in UTC so
// it never drifts by the host's local offset.
function isoDowForDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

function minsToHM(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Every valid start time (as "HH:MM", trainer-local) on `dateStr` at which a
 * session of `durationMins` still fits fully inside one of the trainer's
 * availability windows. Windows are walked from their start to
 * (end − durationMins) in `stepMins` increments. Blackout days yield nothing,
 * as do windows too short to hold the session. Starts whose session would
 * overlap an existing booking (`busy`) are dropped — the trainer runs one
 * session at a time. Results are de-duplicated and sorted — used to populate
 * the client self-book time picker.
 *
 * `bufferMins` is the turnaround gap the proposed session carries (from its
 * package). It never has to fit inside the availability window — it's the
 * trainer's own reset time, not client-facing — but it DOES block the slot
 * from butting up against an existing booking, and existing bookings' buffers
 * block it back.
 */
export function enumerateStartTimes(
  slots: AvailabilityRow[],
  dateStr: string,
  durationMins: number,
  blackouts: BlackoutRow[] = [],
  stepMins = 30,
  busy: BusyInterval[] = [],
  bufferMins = 0,
): string[] {
  if (durationMins <= 0) return []
  if (isBlackoutDate(blackouts, dateStr)) return []
  const isoDow = isoDowForDateStr(dateStr)
  const out = new Set<number>()
  for (const slot of slots) {
    if (!slotAppliesOnDate(slot, dateStr, isoDow)) continue
    const start = timeToMins(slot.startTime)
    const last = timeToMins(slot.endTime) - durationMins
    for (let t = start; t <= last; t += stepMins) {
      if (overlapsBusy(busy, dateStr, t, durationMins, bufferMins)) continue
      out.add(t)
    }
  }
  return [...out].sort((a, b) => a - b).map(minsToHM)
}

/**
 * Server-side guard: does a session of `durationMins` starting at `startMin`
 * (minutes past midnight, trainer-local) on `dateStr` sit fully inside an
 * availability window and outside any blackout? Unlike enumerateStartTimes this
 * does NOT require the start to fall on the picker's step grid — any instant
 * genuinely inside a window is accepted; everything else is rejected.
 */
export function isTimeWithinAvailability(
  slots: AvailabilityRow[],
  dateStr: string,
  startMin: number,
  durationMins: number,
  blackouts: BlackoutRow[] = [],
): boolean {
  if (durationMins <= 0) return false
  if (isBlackoutDate(blackouts, dateStr)) return false
  const isoDow = isoDowForDateStr(dateStr)
  const end = startMin + durationMins
  return slots.some(
    s =>
      slotAppliesOnDate(s, dateStr, isoDow) &&
      startMin >= timeToMins(s.startTime) &&
      end <= timeToMins(s.endTime),
  )
}

export function findNextAvailable(
  slots: AvailabilityRow[],
  from: Date,
  durationMins: number,
  maxDays = 60,
  blackouts: BlackoutRow[] = [],
): Date | null {
  // Strip the time portion of `from` — we work in whole days.
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)

  for (let i = 0; i < maxDays; i++) {
    const day = new Date(cursor.getTime() + i * DAY_MS)
    const dateStr = toDateStr(day)
    if (isBlackoutDate(blackouts, dateStr)) continue
    const isoDow = jsDayToIso(day)

    const candidates = slots
      .filter(s => slotAppliesOnDate(s, dateStr, isoDow))
      .filter(s => timeToMins(s.endTime) - timeToMins(s.startTime) >= durationMins)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))

    if (candidates.length === 0) continue

    const chosen = candidates[0]
    const [h, m] = chosen.startTime.split(':').map(Number)
    const result = new Date(day)
    result.setHours(h, m, 0, 0)
    return result
  }

  return null
}
