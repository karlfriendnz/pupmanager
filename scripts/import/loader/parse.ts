/**
 * Pure parsing / shaping helpers used by the loader. No database, no I/O beyond
 * reading the optional extract file — so these can be unit-tested directly.
 *
 * Lifted unchanged from scripts/prime/import-plan.ts: the merge semantics of the
 * one-off import are the part that is known to be correct, and generalising the
 * toolkit must not quietly change them.
 */
import crypto from 'crypto'
import { readFileSync } from 'fs'
import type { PlanConsult, PlanCourse, PlanPerson } from './types'

export const SESSIONS_PER_COURSE: Record<string, number> = {
  'Early Learning': 5,
  'School Pups': 5,
  'Top Teens': 5,
}
export const SESSIONS_PER_COURSE_DEFAULT = 5
export const WEEKS_BETWEEN = 1
export const DEFAULT_DURATION_MINS = 60
export const FALLBACK_YEAR = 2025
/** Courses rebuilt from contact notes (no spreadsheet header row) are marked so the trainer can find them. */
export const RECONSTRUCTED_SUFFIX = ' [reconstructed]'
export const UNKNOWN_CONSULT_DATE = new Date(FALLBACK_YEAR, 0, 1)
export const UNNAMED_DOG = 'Unnamed dog'
export const LEAD_STATUS = 'NEW'

/**
 * Placeholder address for a person with no email in any source. Matches the
 * app's pattern but the 16 hex digits are DERIVED FROM THE PLAN PERSON ID rather
 * than random, so a re-run recognises the same person instead of creating a
 * second copy. Still unique per person and still on the no-email domain, so it
 * can never merge with anyone.
 *
 * `namespace` keeps two different clients' person ids from colliding.
 */
export function placeholderEmail(personId: string, namespace = 'import'): string {
  const hex = crypto.createHash('md5').update(`${namespace}:${personId}`).digest('hex').slice(0, 16)
  return `noemail-${hex}@no-email.pupmanager.app`
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * `deceasedAt` is an ISO date, the literal string "unknown", or null.
 *
 * "unknown" is real data, not a bug: the client's records say the dog died but
 * not when. Dropping the value would lose the fact entirely, and coercing it
 * would invent a death date — so the column stays null and the fact goes into
 * the dog's notes, where everything without a column of its own lives.
 *
 * Anything else unparseable is treated the same way rather than thrown, because
 * one bad cell must not cost the household its record.
 */
export function parseDeceasedAt(raw: string | null | undefined): { date: Date | null; note: string | null } {
  const v = (raw ?? '').trim()
  if (!v) return { date: null, note: null }
  if (ISO_DATE.test(v)) {
    const d = new Date(`${v}T00:00:00`)
    if (!isNaN(d.getTime())) return { date: d, note: null }
  }
  if (v.toLowerCase() === 'unknown') {
    return { date: null, note: 'Deceased — date unknown (recorded as "unknown" in the source).' }
  }
  return { date: null, note: `Deceased — date could not be read from the source: "${v}".` }
}

export const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
}

export function parseDayMonth(date: string | null): { dom: number; monthIndex: number } | null {
  if (!date) return null
  const m = date.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]+)/)
  if (!m) return null
  const dom = parseInt(m[1], 10)
  const mi = MONTHS[m[2].toLowerCase()]
  if (mi == null || !dom) return null
  return { dom, monthIndex: mi }
}

function parseTimeToken(tok: string): { h: number; m: number; mer: 'am' | 'pm' | null } | null {
  const t = tok.trim().toLowerCase()
  if (!t) return null
  const mer = /pm/.test(t) ? 'pm' : /am/.test(t) ? 'am' : null
  const nums = t.replace(/[^0-9:]/g, '')
  if (!nums) return null
  const [hStr, mStr] = nums.split(':')
  const h = parseInt(hStr, 10)
  if (isNaN(h)) return null
  const m = mStr ? parseInt(mStr, 10) : 0
  return { h, m: isNaN(m) ? 0 : m, mer }
}

function to24h(h: number, mer: 'am' | 'pm' | null): number {
  if (mer === 'pm') return h < 12 ? h + 12 : h
  if (mer === 'am') return h === 12 ? 0 : h
  return h
}

/** "2:00 - 3:00PM" → { startH:14, startM:0, durationMins:60 }. */
export function parseTimeRange(time: string | null): { startH: number; startM: number; durationMins: number } {
  const fallback = { startH: 10, startM: 0, durationMins: DEFAULT_DURATION_MINS }
  if (!time) return fallback
  const parts = time.split(/[-–—]/).map(s => s.trim()).filter(Boolean)
  const start = parseTimeToken(parts[0] ?? '')
  if (!start) return fallback
  const end = parts[1] ? parseTimeToken(parts[1]) : null
  const startMer = start.mer ?? end?.mer ?? null
  const startH = to24h(start.h, startMer)
  let durationMins = DEFAULT_DURATION_MINS
  if (end) {
    const endMer = end.mer ?? startMer
    const endH = to24h(end.h, endMer)
    const diff = endH * 60 + end.m - (startH * 60 + start.m)
    durationMins = diff > 0 ? diff : DEFAULT_DURATION_MINS
  }
  return { startH, startM: start.m, durationMins }
}

export function composeAddress(p: PlanPerson): string | null {
  const addr = p.address?.trim() || ''
  const city = p.city?.trim() || ''
  const post = p.postcode?.trim() || ''
  const parts: string[] = []
  if (addr) parts.push(addr)
  if (city && !addr.toLowerCase().includes(city.toLowerCase())) parts.push(city)
  if (post && !addr.includes(post)) parts.push(post)
  const joined = parts.join(', ').trim()
  return joined || null
}

export function consultLabel(c: PlanConsult): string {
  const when = [c.month, c.year].filter(Boolean).join(' ')
  return `${c.service}${when ? ` — ${when}` : ''}`
}

/**
 * Everything about a person that has no column of its own, as labelled lines on
 * ClientProfile.notes. Access codes are labelled so they can never be mistaken
 * for free text; AF refs, waitlist rows and 1:1 history are kept verbatim.
 */
export function buildNotes(p: PlanPerson): string | null {
  const lines: string[] = []
  if (p.notes?.trim()) lines.push(p.notes.trim())
  if (p.company?.trim()) lines.push(`Business: ${p.company.trim()}`)
  for (const code of p.accessCodes ?? []) lines.push(`Access code: ${code.trim()}`)
  for (const ref of p.afRefs ?? []) {
    lines.push(`AF ref: ${ref.number ? `#${ref.number}` : '(number missing)'} — ${ref.raw}`)
  }
  for (const w of p.waitlist ?? []) {
    const extra = [w.dogRaw, w.breedAge, w.notes].map(s => s?.trim()).filter(Boolean).join(' · ')
    lines.push(`Waitlist: ${w.category}${extra ? ` — ${extra}` : ''}`)
  }
  for (const c of p.oneToOneConsults ?? []) {
    lines.push(`1:1: ${consultLabel(c)} — "${c.raw}"`)
  }
  for (const f of p.flags ?? []) lines.push(`Import note: ${f}`)
  const joined = lines.join('\n').trim()
  return joined || null
}

/**
 * The plan carries each spreadsheet course's day+month but no year. Recover it
 * from the extract file: take the most common booking year among that course's
 * enrolments, and for courses with no dated booking roll the year forward per
 * level when the month goes backwards.
 *
 * The extract file is optional — without it every spreadsheet course falls back
 * to roll-forward from FALLBACK_YEAR, which is recorded as a problem.
 */
export function inferCourseYears(
  courses: PlanCourse[],
  extractedPath: string | null | undefined,
  problems: string[],
): Map<string, number> {
  // The plan calls this `externalId`; the first build called it
  // `spreadsheetCourseId`. Accept both so an older plan still dates correctly.
  const externalIdOf = (c: PlanCourse): number | null => {
    const v = c.externalId ?? c.spreadsheetCourseId
    if (v == null) return null
    const n = typeof v === 'number' ? v : parseInt(String(v), 10)
    return isNaN(n) ? null : n
  }

  let yearBySpreadsheetId = new Map<number, number>()
  if (extractedPath) {
    try {
      const extracted = JSON.parse(readFileSync(extractedPath, 'utf-8')) as {
        enrolments: { courseId: number; dateBooked: string | null }[]
      }
      const counts = new Map<number, Map<number, number>>()
      for (const e of extracted.enrolments ?? []) {
        const m = e.dateBooked?.match(/^(\d{4})-\d{2}-\d{2}$/)
        if (!m) continue
        const y = parseInt(m[1], 10)
        if (!counts.has(e.courseId)) counts.set(e.courseId, new Map())
        const inner = counts.get(e.courseId)!
        inner.set(y, (inner.get(y) ?? 0) + 1)
      }
      yearBySpreadsheetId = new Map(
        [...counts].map(([cid, inner]) => [
          cid,
          [...inner.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0],
        ]),
      )
    } catch {
      problems.push(`Could not read ${extractedPath} — spreadsheet course years fell back to roll-forward only.`)
    }
  } else {
    problems.push('No extract file supplied — spreadsheet course years fell back to roll-forward only.')
  }

  const out = new Map<string, number>()
  const byLevel = new Map<string, PlanCourse[]>()
  for (const c of courses) {
    if (c.origin !== 'spreadsheet') continue
    if (!byLevel.has(c.level)) byLevel.set(c.level, [])
    byLevel.get(c.level)!.push(c)
  }
  for (const [, list] of byLevel) {
    const ordered = [...list].sort((a, b) => (externalIdOf(a) ?? 0) - (externalIdOf(b) ?? 0))
    let running: number | null = null
    let prevMonth: number | null = null
    for (const c of ordered) {
      const dm = parseDayMonth(c.date)
      const ext = externalIdOf(c)
      const known = ext != null ? yearBySpreadsheetId.get(ext) : undefined
      let year: number
      if (known != null) {
        year = known
        running = known
      } else if (running == null) {
        year = FALLBACK_YEAR
        running = FALLBACK_YEAR
      } else {
        if (dm && prevMonth != null && dm.monthIndex < prevMonth) running += 1
        year = running
      }
      if (dm) prevMonth = dm.monthIndex
      out.set(c.id, year)
    }
  }
  return out
}

export function courseStart(c: PlanCourse, year: number): { start: Date; durationMins: number } {
  const { startH, startM, durationMins } = parseTimeRange(c.time)
  if (c.origin === 'spreadsheet') {
    const dm = parseDayMonth(c.date)
    return {
      start: new Date(year, dm ? dm.monthIndex : 0, dm ? dm.dom : 1, startH, startM, 0, 0),
      durationMins,
    }
  }
  // Reconstructed course: only a month + year were recoverable from the notes.
  const mi = c.month ? MONTHS[c.month.trim().toLowerCase()] ?? 0 : 0
  const y = c.year ? parseInt(c.year, 10) || FALLBACK_YEAR : FALLBACK_YEAR
  return { start: new Date(y, mi, 1, startH, startM, 0, 0), durationMins }
}

export function runName(c: PlanCourse): string {
  return c.origin === 'invented' ? `${c.name}${RECONSTRUCTED_SUFFIX}` : c.name
}

export function consultStart(c: PlanConsult): Date {
  if (!c.year) return UNKNOWN_CONSULT_DATE
  const y = parseInt(c.year, 10)
  if (!y) return UNKNOWN_CONSULT_DATE
  const mi = c.month ? MONTHS[c.month.trim().toLowerCase()] ?? 0 : 0
  return new Date(y, mi, 1, 0, 0, 0, 0)
}

/** "June 10, 2024 at 3:14:20 PM NZST" → Date (best effort; null if unparseable). */
export function parseSubscriberDate(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null
  const cleaned = raw.replace(/\s+at\s+/i, ' ').replace(/\s+[A-Z]{3,4}$/, '')
  const d = new Date(cleaned)
  return isNaN(d.getTime()) ? null : d
}
