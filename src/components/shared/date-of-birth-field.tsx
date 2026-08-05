'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  clampDobParts,
  dobYearOptions,
  daysInMonth,
  joinDobParts,
  splitDobValue,
  INCOMPLETE_DOB,
  MONTH_NAMES,
  type DobParts,
  type DobSubject,
} from '@/lib/date-of-birth'

/**
 * The date of BIRTH control: day / month / year, three selects, in that order.
 *
 * Karl, 2026-08-06: "make all date of birth fields to be 3 drop downs so d m y
 * i hate the standard interface for date of birth selections". He means
 * `<input type="date">`, which is the right control for a session date (the
 * answer is near today) and the wrong one for a birthday (the answer is years
 * back, and the native picker makes you page through them one month at a time).
 *
 * ONE component, used everywhere a birthday is asked for. Three hand-rolled
 * selects per screen is how the day counts drift and one screen ends up
 * offering 31 February.
 *
 * Contract, deliberately unchanged from the input it replaces:
 *   • `value` is `yyyy-mm-dd`, or '' / null for "not given"
 *   • `onChange` gives back `yyyy-mm-dd` when all three are picked, `''` when
 *     none are, and `INCOMPLETE_DOB` when only some are — never a silently
 *     dropped half-answer (AGENTS.md bug #1). Call `dateOfBirthError()` before
 *     submitting; the routes reject `INCOMPLETE_DOB` too (bug #3).
 *
 * Mobile-first: the three selects are a 3-column grid, so they sit on one row at
 * 390px. The month is a NAME — that is the entire point of dropdowns over a
 * picker — which is why it gets the widest column.
 */
export interface DateOfBirthFieldProps {
  /** Field name shown above the three selects. */
  label?: string
  /** Stored value: `yyyy-mm-dd`, '' or null. */
  value: string | null | undefined
  /** `yyyy-mm-dd` | '' | INCOMPLETE_DOB. */
  onChange: (value: string) => void
  /** Unique per instance — the three `<label for>`s hang off it. */
  idPrefix: string
  /** How far back the year list goes. 'dog' (30 years) by default. */
  subject?: DobSubject
  required?: boolean
  error?: string | null
  hint?: string
  disabled?: boolean
  /** Latest selectable day. Defaults to today — nobody was born tomorrow. */
  maxDate?: Date
  className?: string
}

const SELECT_CLASS =
  'h-12 w-full rounded-xl border border-slate-200 bg-white px-2 sm:px-3 text-sm text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent ' +
  'disabled:bg-slate-50 disabled:text-slate-500'

export function DateOfBirthField({
  label = 'Date of birth',
  value,
  onChange,
  idPrefix,
  subject = 'dog',
  required = false,
  error,
  hint,
  disabled = false,
  maxDate,
  className,
}: DateOfBirthFieldProps) {
  const [parts, setParts] = useState<DobParts>(() => splitDobValue(value))
  // What we last handed to `onChange`. Lets us tell "the parent re-rendered with
  // our own value" from "a different record was loaded", so typing is never
  // clobbered and a loaded record always populates the selects.
  const lastEmitted = useRef<string>(joinDobParts(splitDobValue(value)).value)

  useEffect(() => {
    const incoming = value == null ? '' : String(value)
    if (incoming === lastEmitted.current) return
    lastEmitted.current = incoming
    // Our own half-answer coming back round: the selects already show it, and
    // re-deriving from a sentinel would blank the parts the user just picked.
    if (incoming === INCOMPLETE_DOB) return
    setParts(splitDobValue(incoming))
  }, [value])

  // Today, unless told otherwise. Frozen per render so the option lists don't
  // churn.
  const max = maxDate ?? new Date()
  const maxYear = max.getFullYear()
  const maxMonth = max.getMonth() + 1
  const maxDay = max.getDate()

  const years = useMemo(() => {
    const list = dobYearOptions(subject, max)
    // A record already holding an older birthday must still show it. Without
    // this the select falls back to blank and the next save wipes a date nobody
    // touched (AGENTS.md bug #1).
    const stored = Number(parts.year)
    if (parts.year && Number.isFinite(stored) && !list.includes(stored)) {
      return [...list, stored].sort((a, b) => b - a)
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, maxYear, parts.year])

  const yearNum = parts.year ? Number(parts.year) : null
  const monthNum = parts.month ? Number(parts.month) : null

  // A birthday can't be in the future, so the lists shrink in the current year
  // rather than letting someone pick a day the route would reject.
  const monthLimit = yearNum === maxYear ? maxMonth : 12
  const dayLimit =
    yearNum === maxYear && monthNum === maxMonth
      ? maxDay
      : daysInMonth(yearNum, monthNum ?? 1)

  const days = useMemo(
    () => Array.from({ length: dayLimit }, (_, i) => i + 1),
    [dayLimit],
  )
  const months = useMemo(
    () => MONTH_NAMES.slice(0, monthLimit).map((name, i) => ({ value: i + 1, name })),
    [monthLimit],
  )

  function update(next: DobParts) {
    // Clamp before emitting: 31 January → February must become 28/29 on screen,
    // never leave as an impossible date behind the scenes.
    const clamped = clampDobParts(next)
    // The future can also be clamped away: dropping to the current year with a
    // later month still selected would otherwise emit a date after today.
    const y = clamped.year ? Number(clamped.year) : null
    let settled = clamped
    if (y === maxYear && clamped.month && Number(clamped.month) > maxMonth) {
      settled = clampDobParts({ ...settled, month: String(maxMonth) })
    }
    if (y === maxYear && Number(settled.month) === maxMonth && settled.day && Number(settled.day) > maxDay) {
      settled = { ...settled, day: String(maxDay) }
    }
    setParts(settled)
    const out = joinDobParts(settled).value
    lastEmitted.current = out
    onChange(out)
  }

  const describedBy = error ? `${idPrefix}-dob-error` : hint ? `${idPrefix}-dob-hint` : undefined

  return (
    // `min-w-0`: a <fieldset> defaults to `min-width: min-content`, which is how
    // a grid inside one refuses to shrink and pushes a 390px screen sideways.
    <fieldset className={`min-w-0 ${className ?? ''}`} disabled={disabled}>
      <legend className="mb-1.5 p-0 text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </legend>
      {/* Day · Month · Year, left to right. The month column is wider because it
          holds a name ("September"), not a number. */}
      <div className="grid grid-cols-[1fr_1.5fr_1.2fr] gap-2">
        <div>
          <label htmlFor={`${idPrefix}-dob-day`} className="sr-only">{label} — day</label>
          <select
            id={`${idPrefix}-dob-day`}
            value={parts.day}
            onChange={e => update({ ...parts, day: e.target.value })}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={SELECT_CLASS}
          >
            <option value="">Day</option>
            {days.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-dob-month`} className="sr-only">{label} — month</label>
          <select
            id={`${idPrefix}-dob-month`}
            value={parts.month}
            onChange={e => update({ ...parts, month: e.target.value })}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={SELECT_CLASS}
          >
            <option value="">Month</option>
            {months.map(m => <option key={m.value} value={m.value}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-dob-year`} className="sr-only">{label} — year</label>
          <select
            id={`${idPrefix}-dob-year`}
            value={parts.year}
            onChange={e => update({ ...parts, year: e.target.value })}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={SELECT_CLASS}
          >
            <option value="">Year</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      {error && <p id={`${idPrefix}-dob-error`} className="mt-1.5 text-xs text-red-500">{error}</p>}
      {hint && !error && <p id={`${idPrefix}-dob-hint`} className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </fieldset>
  )
}
