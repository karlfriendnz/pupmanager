/**
 * Date of BIRTH — the one place that knows how a birthday is split, joined and
 * checked.
 *
 * A birthday is not a scheduling date. `<input type="date">` is right for "when
 * is this session" (the answer is near today), and miserable for "when was this
 * dog born" (the answer is years back, and the native picker makes you page
 * through them). Karl, 2026-08-06: "make all date of birth fields to be 3 drop
 * downs so d m y i hate the standard interface for date of birth selections".
 *
 * So birthdays get three selects — day, month name, year — via
 * `<DateOfBirthField>` (components/shared/date-of-birth-field.tsx). This module
 * is the logic behind it, kept separate from React so the leap-year and
 * partial-date rules are unit-testable and so the API ROUTES can share the exact
 * same parser (AGENTS.md bug #3 — validation in the browser is not validation).
 *
 * The wire format is unchanged: `yyyy-mm-dd`, exactly what `type="date"` used to
 * emit. No column, payload or route contract moved.
 */

/** Month names, index 0 = January. The whole point of dropdowns over a picker. */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/**
 * What the field emits while it is HALF filled in — a day and a month but no
 * year, say.
 *
 * It deliberately is NOT `''`. An empty string means "they left it blank", and
 * dropping a half-typed birthday into that bucket is how a field the user
 * touched vanishes on save (AGENTS.md bug #1). This value is not a date in any
 * format, so `parseDobInput` rejects it and every route that uses it answers
 * 400 rather than writing null. Screens should call `dateOfBirthError()` before
 * submitting and show the message instead.
 */
export const INCOMPLETE_DOB = 'incomplete-date-of-birth'

/** The oldest birthday any route will accept — matches the long-standing dog rule. */
export const MIN_DOB_YEAR = 1970

export interface DobParts {
  /** '' or '1'–'31'. */
  day: string
  /** '' or '1'–'12'. */
  month: string
  /** '' or a four-digit year. */
  year: string
}

export const EMPTY_DOB_PARTS: DobParts = { day: '', month: '', year: '' }

/** How far back each kind of birthday can plausibly go. */
export const DOB_YEAR_SPAN = {
  /** The oldest dog ever recorded was 29. 30 leaves room and keeps the list short. */
  dog: 30,
  /** People: a full lifetime. Unused today (no person carries a birthday yet). */
  person: 120,
} as const

export type DobSubject = keyof typeof DOB_YEAR_SPAN

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * How many days a month has.
 *
 * `year` may be null — the year select can still be empty while someone is
 * picking a day. February then offers 29, because refusing the 29th before you
 * know the year would be refusing a real birthday. Once the year arrives the
 * field clamps (see `clampDobParts`), so 29 February 2021 can never be
 * submitted.
 */
export function daysInMonth(year: number | null, month: number): number {
  if (month < 1 || month > 12) return 31
  if (month === 2) return year == null || isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** Split a stored `yyyy-mm-dd` into the three selects. Anything else → empty. */
export function splitDobValue(value: string | null | undefined): DobParts {
  if (!value) return { ...EMPTY_DOB_PARTS }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return { ...EMPTY_DOB_PARTS }
  return {
    year: m[1],
    month: String(Number(m[2])),
    day: String(Number(m[3])),
  }
}

export type DobState = 'empty' | 'partial' | 'complete'

/**
 * Join the three selects back into what gets stored.
 *
 * Three outcomes, and only three:
 *   • nothing picked        → `''`             (an optional field left alone)
 *   • some of it picked     → `INCOMPLETE_DOB` (loud, so it can't be dropped)
 *   • all of it, and real   → `yyyy-mm-dd`
 *
 * An impossible combination (31 February) counts as `partial`, not `complete`.
 * The UI can't produce one — the day list is filtered by the chosen month — but
 * this function is also the last word for anything that calls it directly.
 */
export function joinDobParts(parts: DobParts): { value: string; state: DobState } {
  const day = Number(parts.day)
  const month = Number(parts.month)
  const year = Number(parts.year)
  const picked = [parts.day, parts.month, parts.year].filter(p => p !== '' && p != null)

  if (picked.length === 0) return { value: '', state: 'empty' }
  if (picked.length < 3) return { value: INCOMPLETE_DOB, state: 'partial' }

  const real =
    Number.isInteger(year) && year >= 1 &&
    Number.isInteger(month) && month >= 1 && month <= 12 &&
    Number.isInteger(day) && day >= 1 && day <= daysInMonth(year, month)
  if (!real) return { value: INCOMPLETE_DOB, state: 'partial' }

  const pad = (n: number) => String(n).padStart(2, '0')
  return { value: `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`, state: 'complete' }
}

/**
 * Keep the parts self-consistent after a change.
 *
 * Picking 31 January and then switching to February has to go somewhere. We
 * CLAMP the day (31 → 28/29) rather than clearing it: clearing throws away a
 * choice the user deliberately made and reads as the field breaking, while a
 * clamp is visible on screen — the day select simply now says 28 — so nothing is
 * submitted that the user can't see.
 */
export function clampDobParts(parts: DobParts): DobParts {
  const month = Number(parts.month)
  const day = Number(parts.day)
  if (!parts.month || !parts.day) return parts
  const year = parts.year ? Number(parts.year) : null
  const max = daysInMonth(year, month)
  return day > max ? { ...parts, day: String(max) } : parts
}

/** A `yyyy-mm-dd` as a real UTC-midnight Date, or null if it isn't one. */
export function parseDobDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(date.getTime())) return null
  // `Date.UTC(2021, 1, 31)` silently rolls over to 3 March. Re-check the parts
  // so a rolled-over date is rejected instead of stored as a different day.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
}

export interface DobLimits {
  /** Earliest acceptable year. Defaults to 1970 — the rule the dog routes already had. */
  minYear?: number
  /** Latest acceptable day. Defaults to now: nobody was born tomorrow. */
  maxDate?: Date
}

/**
 * THE server-side parser. Every route that stores a birthday goes through here,
 * so the browser and the API can't disagree about what a date of birth is.
 *
 * `{ ok: true, value: null }` means "they didn't give one", which is a legal
 * answer for an optional field. `{ ok: false }` means the caller sent something
 * that is not a date we will store — including `INCOMPLETE_DOB`, which is how a
 * half-filled field arrives.
 */
export function parseDobInput(
  value: string | null | undefined,
  limits: DobLimits = {},
): { ok: true; value: Date | null } | { ok: false } {
  if (value == null) return { ok: true, value: null }
  const trimmed = String(value).trim()
  if (trimmed === '') return { ok: true, value: null }

  const date = parseDobDate(trimmed)
  if (!date) return { ok: false }

  const maxDate = limits.maxDate ?? new Date()
  if (date.getTime() > maxDate.getTime()) return { ok: false }
  if (date.getUTCFullYear() < (limits.minYear ?? MIN_DOB_YEAR)) return { ok: false }
  return { ok: true, value: date }
}

/**
 * What to tell someone about the birthday they just picked, or null if it's fine.
 *
 * Screens call this before they submit. The routes still re-check with
 * `parseDobInput` — this is the friendly message, not the guard.
 */
export function dateOfBirthError(
  value: string | null | undefined,
  opts: DobLimits & { required?: boolean; label?: string } = {},
): string | null {
  const label = opts.label ?? 'Date of birth'
  const raw = value == null ? '' : String(value).trim()

  if (raw === '') return opts.required ? `${label} is required.` : null
  if (raw === INCOMPLETE_DOB) return `Finish the ${label.toLowerCase()} — pick a day, a month and a year.`

  const parsed = parseDobInput(raw, opts)
  if (!parsed.ok) return `Enter a real ${label.toLowerCase()}.`
  return null
}

/**
 * The years to offer, newest first. Derived from the clock — never hard-coded,
 * or the list quietly stops including this year on 1 January.
 */
export function dobYearOptions(subject: DobSubject = 'dog', now: Date = new Date()): number[] {
  const latest = now.getFullYear()
  const earliest = Math.max(latest - DOB_YEAR_SPAN[subject], MIN_DOB_YEAR)
  const years: number[] = []
  for (let y = latest; y >= earliest; y--) years.push(y)
  return years
}
