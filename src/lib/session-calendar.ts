/**
 * Pure calendar + selection logic for picking sessions out of a class run.
 *
 * It lives here rather than inside the booking wizard because it is the part
 * that can actually be wrong: a casual class runs on the TRAINER's calendar,
 * and a client in another zone must see the same days the trainer published.
 * Every day here is a trainer-local `YYYY-MM-DD` derived through
 * `utcToZonedDateAndMinutes` — never `new Date(iso).getDate()`, which reads the
 * VIEWER's zone and slides an NZ evening class onto the previous day for anyone
 * west of it.
 *
 * All month arithmetic is done on the string parts via `Date.UTC`, so nothing
 * in this file can be tipped by a daylight-saving boundary either.
 */

import { utcToZonedDateAndMinutes } from './timezone'

/** The only fields the calendar needs. Kept structural so the wizard's richer
 *  session type satisfies it without a cast. */
export interface CalendarSession {
  id: string
  /** UTC instant, ISO 8601. */
  at: string
  /** Null = uncapped. 0 = full. */
  spacesLeft: number | null
  /** This client already holds this session. */
  booked: boolean
}

/**
 * Whether a session is on offer.
 *
 * This is the ONE rule, copied verbatim from the flat list it replaces: a
 * session already held is theirs (not on offer again) and a full one would be
 * refused at checkout. A picker that let either through would be worse than
 * the wall it replaces, so both ends read this function.
 */
export function isSelectableSession(s: CalendarSession): boolean {
  return !s.booked && s.spacesLeft !== 0
}

export interface SessionDay<T extends CalendarSession> {
  /** Trainer-local calendar day, `YYYY-MM-DD`. */
  dateStr: string
  /** That day's sessions, earliest first. */
  sessions: T[]
  /** How many of them can still be picked. */
  selectableCount: number
}

/**
 * Bucket a run's sessions into trainer-local days, earliest day first and
 * earliest session first inside each day.
 */
export function groupSessionsByDay<T extends CalendarSession>(sessions: T[], tz: string): SessionDay<T>[] {
  const byDate = new Map<string, { at: number; s: T }[]>()
  for (const s of sessions) {
    const { dateStr } = utcToZonedDateAndMinutes(new Date(s.at), tz)
    const arr = byDate.get(dateStr) ?? []
    arr.push({ at: new Date(s.at).getTime(), s })
    byDate.set(dateStr, arr)
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([dateStr, rows]) => {
      const ordered = rows.sort((a, b) => a.at - b.at).map(r => r.s)
      return {
        dateStr,
        sessions: ordered,
        selectableCount: ordered.filter(isSelectableSession).length,
      }
    })
}

/** `YYYY-MM-DD` → `YYYY-MM`. */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7)
}

const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** `2026-08` → `August 2026`. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTH_LONG[m - 1]} ${y}`
}

/**
 * The weeks of a month as trainer-local date strings, Monday-anchored, padded
 * out of the neighbouring months so every row holds seven days.
 *
 * Six rows would keep the grid a fixed height, but it also draws a whole empty
 * week under most months. The grid is only as tall as the month needs.
 */
export function monthGrid(month: string): string[][] {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  // getUTCDay: 0=Sun. Monday-anchored offset back to the start of that week.
  const lead = (first.getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7

  const weeks: string[][] = []
  for (let i = 0; i < cells; i++) {
    const d = new Date(Date.UTC(y, m - 1, 1 - lead + i))
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    if (i % 7 === 0) weeks.push([])
    weeks[weeks.length - 1].push(dateStr)
  }
  return weeks
}

/**
 * Every month the run touches, earliest first — the months the ‹ › arrows are
 * allowed to reach. A class that finishes in October can't page into November;
 * there is nothing there, and an arrow that leads to an empty grid reads as a
 * broken screen.
 */
export function monthsWithSessions<T extends CalendarSession>(days: SessionDay<T>[]): string[] {
  const out: string[] = []
  for (const d of days) {
    const mo = monthOf(d.dateStr)
    if (out[out.length - 1] !== mo) out.push(mo)
  }
  return [...new Set(out)].sort()
}

/**
 * The day the picker should open on: the first that still has something to
 * pick, falling back to the first day at all (so a fully-booked run still
 * opens somewhere rather than on a blank panel).
 */
export function defaultOpenDay<T extends CalendarSession>(days: SessionDay<T>[]): string | null {
  return days.find(d => d.selectableCount > 0)?.dateStr ?? days[0]?.dateStr ?? null
}

/** How many of a given day's sessions are in the current selection. */
export function picksOnDay<T extends CalendarSession>(day: SessionDay<T>, selectedIds: readonly string[]): number {
  const chosen = new Set(selectedIds)
  return day.sessions.reduce((n, s) => (chosen.has(s.id) ? n + 1 : n), 0)
}

/**
 * The chosen sessions in calendar order, whatever order they were tapped in.
 *
 * This is the answer to "which four did I pick?", and it has to survive paging
 * to another month — so it is derived from the whole run, not from the day on
 * screen.
 */
export function selectedInOrder<T extends CalendarSession>(
  days: SessionDay<T>[],
  selectedIds: readonly string[],
): { dateStr: string; session: T }[] {
  const chosen = new Set(selectedIds)
  const out: { dateStr: string; session: T }[] = []
  for (const day of days) {
    for (const s of day.sessions) if (chosen.has(s.id)) out.push({ dateStr: day.dateStr, session: s })
  }
  return out
}

/** Every session on offer across the run, in calendar order — what "Select all" means. */
export function allSelectableIds<T extends CalendarSession>(days: SessionDay<T>[]): string[] {
  const out: string[] = []
  for (const day of days) for (const s of day.sessions) if (isSelectableSession(s)) out.push(s.id)
  return out
}
