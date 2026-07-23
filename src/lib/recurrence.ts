// Recurrence rules for repeating classes — an RRULE-string model and the
// human summaries around it, ported from the FM-Events repeating-event design
// (composables/useRepeatOptions.ts) that Karl likes.
//
// A rule is a subset of the iCalendar RRULE grammar, e.g.
//   FREQ=WEEKLY;BYDAY=TU              → every Tuesday
//   FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=8
// '' / 'NONE' means "does not repeat" (a one-off).

export type RepeatOption = { label: string; value: string }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_ABBR = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth']

// Weekday order used by the custom picker (Mon-first, matching the UI).
export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
export const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

/** The preset dropdown options. When a base date is known the weekly/monthly
 * presets name the actual day ("Weekly on Tuesday"), like Google Calendar. */
export function buildRepeatOptions(date: Date | null): RepeatOption[] {
  if (!date) return [
    { label: 'Does not repeat', value: 'NONE' },
    { label: 'Daily', value: 'FREQ=DAILY' },
    { label: 'Weekly', value: 'FREQ=WEEKLY' },
    { label: 'Monthly', value: 'FREQ=MONTHLY' },
    { label: 'Every weekday (Mon–Fri)', value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { label: 'Custom…', value: 'CUSTOM' },
  ]

  const dow = date.getDay()
  const dayName = DAYS[dow]
  const dayAbbr = DAY_ABBR[dow]
  const dayNum = date.getDate()
  const monthName = MONTHS[date.getMonth()]
  const nth = Math.ceil(dayNum / 7)
  const nthLabel = ORDINALS[nth - 1]

  return [
    { label: 'Does not repeat', value: 'NONE' },
    { label: 'Daily', value: 'FREQ=DAILY' },
    { label: `Weekly on ${dayName}`, value: `FREQ=WEEKLY;BYDAY=${dayAbbr}` },
    { label: `Monthly on day ${dayNum}`, value: `FREQ=MONTHLY;BYMONTHDAY=${dayNum}` },
    { label: `Monthly on the ${nthLabel} ${dayName}`, value: `FREQ=MONTHLY;BYDAY=${nth}${dayAbbr}` },
    { label: `Annually on ${monthName} ${dayNum}`, value: 'FREQ=YEARLY' },
    { label: 'Every weekday (Mon–Fri)', value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { label: 'Custom…', value: 'CUSTOM' },
  ]
}

/** Plain-English one-liner for a rule, for the live summary + chips. */
export function rruleToSummary(rrule: string, fmtDate?: (d: Date) => string): string {
  if (!rrule || rrule === 'NONE' || rrule === '') return 'Does not repeat'
  const parts: Record<string, string> = {}
  rrule.split(';').forEach(p => { const [k, v] = p.split('='); parts[k] = v })

  const freqWord: Record<string, string> = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }
  const dayNames: Record<string, string> = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' }

  const interval = parseInt(parts['INTERVAL'] ?? '1')
  const freq = parts['FREQ']
  const freqLabel = freqWord[freq] ?? freq?.toLowerCase() ?? 'week'

  let s = interval === 1 ? `Repeats every ${freqLabel}` : `Repeats every ${interval} ${freqLabel}s`

  if (parts['BYDAY']) {
    const days = parts['BYDAY'].split(',').map(d => dayNames[d.replace(/^-?\d+/, '')] ?? d)
    if (days.length === 1) s += ` on ${days[0]}`
    else s += ` on ${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`
  }
  if (parts['BYMONTHDAY']) s += ` on day ${parts['BYMONTHDAY']}`

  if (parts['COUNT']) {
    const n = parseInt(parts['COUNT'])
    s += ` for ${n} occurrence${n === 1 ? '' : 's'}`
  } else if (parts['UNTIL']) {
    const u = parts['UNTIL']
    const date = new Date(Number(u.slice(0, 4)), Number(u.slice(4, 6)) - 1, Number(u.slice(6, 8)))
    s += fmtDate ? ` until ${fmtDate(date)}` : ` until ${date.toLocaleDateString()}`
  }
  return s
}

/** Parse a rule string into its parts (empty object for none). */
export function parseRule(rrule: string): Record<string, string> {
  if (!rrule || rrule === 'NONE') return {}
  return Object.fromEntries(rrule.split(';').map(p => p.split('=')) as [string, string][])
}

/**
 * Bridge a recurrence rule to the package's existing (sessionCount, weeksBetween)
 * cadence, so a class configured with the repeat picker still generates the
 * right session series through the current generator.
 *
 * - sessionCount = COUNT if the rule ends "after N", else 0 (ongoing — the
 *   trainer picks an end when they schedule a run).
 * - weeksBetween = the weekly interval (INTERVAL for FREQ=WEEKLY), else 1.
 *
 * Weekly is the overwhelming case for classes; other frequencies map to a
 * best-effort weeksBetween until full RRULE session-generation lands.
 */
export function cadenceFromRule(rrule: string): { sessionCount: number; weeksBetween: number } {
  const p = parseRule(rrule)
  const count = p['COUNT'] ? Math.max(0, parseInt(p['COUNT'])) : 0
  const interval = p['INTERVAL'] ? Math.max(1, parseInt(p['INTERVAL'])) : 1
  const weeksBetween = p['FREQ'] === 'WEEKLY' ? interval : 1
  return { sessionCount: count, weeksBetween }
}

// ─── Expansion ───────────────────────────────────────────────────────────────

/**
 * How many occurrences we generate ahead for a rule that never ends. A drop-in
 * class typically runs indefinitely, so "every Tuesday" has to stop somewhere:
 * we lay down a rolling horizon and top it up later, the same way ongoing
 * packages work. Deliberately generous enough that a client browsing the
 * booking wizard always sees months of bookable sessions.
 */
export const OPEN_ENDED_OCCURRENCES = 12

/** Move `d` forward to the next date whose weekday is `day` (0=Sun…6=Sat).
 *  Returns `d` itself when it's already on that weekday. Date-only maths. */
export function rollForwardToWeekday(d: Date, day: number): Date {
  const out = new Date(d)
  const delta = (((day - out.getDay()) % 7) + 7) % 7
  out.setDate(out.getDate() + delta)
  return out
}

function parseUntil(v: string | undefined): Date | null {
  if (!v || v.length < 8) return null
  const d = new Date(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)))
  return Number.isNaN(d.getTime()) ? null : d
}

/** The nth (1-based) occurrence of `weekday` in the month of `ref`. nth < 0
 *  counts back from the end (-1 = last). Null when the month has no such date. */
function nthWeekdayOfMonth(ref: Date, weekday: number, nth: number): Date | null {
  const year = ref.getFullYear()
  const month = ref.getMonth()
  const days: number[] = []
  const cursor = new Date(year, month, 1)
  while (cursor.getMonth() === month) {
    if (cursor.getDay() === weekday) days.push(cursor.getDate())
    cursor.setDate(cursor.getDate() + 1)
  }
  const dayNum = nth > 0 ? days[nth - 1] : days[days.length + nth]
  return dayNum ? new Date(year, month, dayNum) : null
}

/**
 * Expand a recurrence rule into concrete dates, starting at `from` (which is
 * always the first occurrence). Supports the subset this app writes:
 * FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY (incl. "2TU"/"-1FR" for
 * monthly), BYMONTHDAY, COUNT and UNTIL.
 *
 * The series ends at whichever comes first: COUNT, UNTIL, or `max` (the
 * open-ended horizon). '' / 'NONE' yields the single date.
 *
 * Pure and date-only — unit-tested in tests/unit/recurrence.test.ts.
 */
export function expandRule(
  rrule: string,
  from: Date,
  max: number = OPEN_ENDED_OCCURRENCES,
): Date[] {
  const cap = Math.max(0, Math.floor(max))
  if (cap === 0) return []
  if (!rrule || rrule === 'NONE') return [new Date(from)]

  const p = parseRule(rrule)
  const freq = p['FREQ']
  if (!freq) return [new Date(from)]

  const interval = p['INTERVAL'] ? Math.max(1, parseInt(p['INTERVAL'])) : 1
  const count = p['COUNT'] ? Math.max(0, parseInt(p['COUNT'])) : null
  const until = parseUntil(p['UNTIL'])
  // How many we're allowed to emit: COUNT when the rule says so, else the cap.
  const limit = count === null ? cap : Math.min(count, cap)
  if (limit === 0) return []

  const byDay = p['BYDAY'] ? p['BYDAY'].split(',').filter(Boolean) : []
  const out: Date[] = []
  const push = (d: Date): boolean => {
    if (until && d.getTime() > until.getTime()) return false
    out.push(new Date(d))
    return out.length < limit
  }

  if (freq === 'WEEKLY' && byDay.length > 1) {
    // A multi-day weekly rule ("Mon and Wed"): walk week by week, emitting each
    // listed weekday that falls on or after the start.
    const wanted = byDay
      .map((c) => DAY_ABBR.indexOf(c.replace(/^-?\d+/, '')))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)
    // Anchor on the Sunday of `from`'s week so every week is scanned the same way.
    const weekStart = new Date(from)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    for (let w = 0; out.length < limit; w += interval) {
      const base = new Date(weekStart)
      base.setDate(base.getDate() + w * 7)
      let roomLeft = true
      for (const wd of wanted) {
        const d = new Date(base)
        d.setDate(d.getDate() + wd)
        if (d.getTime() < from.getTime()) continue
        roomLeft = push(d)
        if (!roomLeft) break
      }
      if (!roomLeft) break
      // Guard against a rule that can never emit (e.g. UNTIL already passed).
      if (w > (limit + 1) * 7 * interval) break
    }
    return out
  }

  // Single-track frequencies: step the cursor by one interval each time.
  const monthlyWeekday = freq === 'MONTHLY' && byDay.length === 1 ? byDay[0] : null
  const nth = monthlyWeekday ? parseInt(monthlyWeekday.replace(/[A-Z]+$/, '') || '1') : 1
  const monthlyDow = monthlyWeekday ? DAY_ABBR.indexOf(monthlyWeekday.replace(/^-?\d+/, '')) : -1

  for (let i = 0; out.length < limit; i++) {
    let d: Date
    if (freq === 'DAILY') {
      d = new Date(from)
      d.setDate(d.getDate() + i * interval)
    } else if (freq === 'WEEKLY') {
      d = new Date(from)
      d.setDate(d.getDate() + i * 7 * interval)
    } else if (freq === 'MONTHLY') {
      // setMonth on the 1st, then apply the day rule — stepping months from a
      // 31st would otherwise skip February.
      const ref = new Date(from.getFullYear(), from.getMonth() + i * interval, 1)
      if (monthlyDow >= 0) {
        const hit = nthWeekdayOfMonth(ref, monthlyDow, nth)
        if (!hit) continue
        d = hit
      } else {
        const dom = p['BYMONTHDAY'] ? parseInt(p['BYMONTHDAY']) : from.getDate()
        // Clamp to the month's length so "the 31st" lands on the 30th/28th.
        const lastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate()
        d = new Date(ref.getFullYear(), ref.getMonth(), Math.min(dom, lastDay))
      }
    } else {
      d = new Date(from.getFullYear() + i * interval, from.getMonth(), from.getDate())
    }
    if (d.getTime() < from.getTime()) continue
    if (!push(d)) break
    // Backstop: never loop more than a sane multiple of the target count.
    if (i > limit * 3 + 24) break
  }
  return out
}
