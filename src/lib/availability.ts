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
export function findNextAvailable(
  slots: AvailabilityRow[],
  from: Date,
  durationMins: number,
  maxDays = 60
): Date | null {
  // Strip the time portion of `from` — we work in whole days.
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)

  for (let i = 0; i < maxDays; i++) {
    const day = new Date(cursor.getTime() + i * DAY_MS)
    const dateStr = toDateStr(day)
    const isoDow = jsDayToIso(day)

    const candidates = slots
      .filter(s => (s.date ? s.date === dateStr : s.dayOfWeek === isoDow))
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
