// Server-side timezone helpers. Vercel's Node runtime is UTC, so we can't
// rely on the host's local time when rendering times for trainers who live
// elsewhere — every formatter and day-bounds calc has to take an explicit
// IANA tz.

/**
 * Returns the UTC instant whose wall-clock value in `tz` equals the given
 * Y-M-D h:m. Used to compute "midnight in trainer's timezone" for queries.
 */
export function zonedToUtc(
  year: number,
  month: number,  // 1-12
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const wantMs = Date.UTC(year, month - 1, day, hour, minute, 0)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(wantMs))
  const got: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') got[p.type] = p.value
  const gotMs = Date.UTC(
    Number(got.year), Number(got.month) - 1, Number(got.day),
    Number(got.hour), Number(got.minute), Number(got.second),
  )
  return new Date(2 * wantMs - gotMs)
}

/** Returns the UTC instant for midnight on YYYY-MM-DD in the given tz. */
export function startOfDayInTz(dateStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return zonedToUtc(y, m, d, 0, 0, tz)
}

/** Returns the UTC instant for 23:59:59 on YYYY-MM-DD in the given tz. */
export function endOfDayInTz(dateStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  // 23:59 then bump to .999 ms — the millisecond part doesn't affect zonedToUtc.
  const r = zonedToUtc(y, m, d, 23, 59, tz)
  r.setUTCMilliseconds(999)
  r.setUTCSeconds(59)
  return r
}

/**
 * Splits a UTC instant into its wall-clock parts in `tz`: the YYYY-MM-DD date
 * and the minute-of-day (0..1439). Used to compare a client-chosen booking
 * instant against a trainer's availability windows (which are stored as
 * trainer-local HH:MM).
 */
export function utcToZonedDateAndMinutes(d: Date, tz: string): { dateStr: string; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const got: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') got[p.type] = p.value
  return {
    dateStr: `${got.year}-${got.month}-${got.day}`,
    minuteOfDay: Number(got.hour) * 60 + Number(got.minute),
  }
}

/** Returns YYYY-MM-DD for "today" in the given timezone. */
export function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const got: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') got[p.type] = p.value
  return `${got.year}-${got.month}-${got.day}`
}
