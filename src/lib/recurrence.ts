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
