import { describe, it, expect } from 'vitest'
import {
  clampDobParts,
  dateOfBirthError,
  daysInMonth,
  dobYearOptions,
  isLeapYear,
  joinDobParts,
  parseDobDate,
  parseDobInput,
  splitDobValue,
  INCOMPLETE_DOB,
  MIN_DOB_YEAR,
  MONTH_NAMES,
} from '@/lib/date-of-birth'

/**
 * Karl asked for three dropdowns (day / month / year) instead of the native
 * date picker on every date of BIRTH. These tests pin the three things that
 * break when a date is assembled by hand:
 *
 *   • the day counts, including February in a leap year
 *   • what happens to 31 January when the month changes to February
 *   • a half-picked date, which must never quietly become "no date"
 *
 * Plus the round trip — an already-stored birthday has to come back out of the
 * three selects byte-for-byte identical, or the next save wipes a field nobody
 * touched (AGENTS.md bug #1).
 */

describe('leap years', () => {
  it('knows the century rule', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2023)).toBe(false)
    expect(isLeapYear(1900)).toBe(false) // divisible by 100, not by 400
    expect(isLeapYear(2000)).toBe(true)  // divisible by 400
  })
})

describe('daysInMonth', () => {
  it('gives every month its real length', () => {
    const lengths = MONTH_NAMES.map((_, i) => daysInMonth(2023, i + 1))
    expect(lengths).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
  })

  it('gives February 29 days in a leap year and 28 otherwise', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2023, 2)).toBe(28)
    expect(daysInMonth(1900, 2)).toBe(28)
    expect(daysInMonth(2000, 2)).toBe(29)
  })

  it('offers 29 February while the year is still unpicked', () => {
    // Refusing the 29th before you know the year would refuse a real birthday.
    expect(daysInMonth(null, 2)).toBe(29)
  })
})

describe('joinDobParts', () => {
  it('composes a complete pick into yyyy-mm-dd, zero-padded', () => {
    expect(joinDobParts({ day: '5', month: '3', year: '2021' }))
      .toEqual({ value: '2021-03-05', state: 'complete' })
  })

  it('is empty only when nothing at all is picked', () => {
    expect(joinDobParts({ day: '', month: '', year: '' }))
      .toEqual({ value: '', state: 'empty' })
  })

  it('flags a half-picked date rather than dropping it', () => {
    // Day + month, no year — the case that must NOT silently submit as null.
    expect(joinDobParts({ day: '14', month: '6', year: '' }))
      .toEqual({ value: INCOMPLETE_DOB, state: 'partial' })
    expect(joinDobParts({ day: '', month: '6', year: '2020' }).state).toBe('partial')
    expect(joinDobParts({ day: '14', month: '', year: '2020' }).state).toBe('partial')
    expect(joinDobParts({ day: '', month: '', year: '2020' }).state).toBe('partial')
  })

  it('refuses 31 February even when all three are filled in', () => {
    expect(joinDobParts({ day: '31', month: '2', year: '2021' }).state).toBe('partial')
    expect(joinDobParts({ day: '29', month: '2', year: '2023' }).state).toBe('partial')
    expect(joinDobParts({ day: '29', month: '2', year: '2024' }).state).toBe('complete')
    expect(joinDobParts({ day: '31', month: '4', year: '2020' }).state).toBe('partial')
  })
})

describe('clampDobParts', () => {
  it('pulls 31 January back to 28 when the month becomes February', () => {
    // Clamp, not clear: the new day is visible in the select, so nothing is
    // submitted that the user cannot see.
    expect(clampDobParts({ day: '31', month: '2', year: '2023' }))
      .toEqual({ day: '28', month: '2', year: '2023' })
  })

  it('allows the 29th when the year is a leap year', () => {
    expect(clampDobParts({ day: '31', month: '2', year: '2024' }))
      .toEqual({ day: '29', month: '2', year: '2024' })
  })

  it('clamps 31 to 30 in a 30-day month', () => {
    expect(clampDobParts({ day: '31', month: '9', year: '2022' }).day).toBe('30')
  })

  it('leaves a day that already fits, and any incomplete pick, alone', () => {
    expect(clampDobParts({ day: '15', month: '2', year: '2023' }).day).toBe('15')
    expect(clampDobParts({ day: '31', month: '', year: '' }).day).toBe('31')
    expect(clampDobParts({ day: '', month: '2', year: '2023' }).day).toBe('')
  })

  it('never produces something joinDobParts calls incomplete', () => {
    for (let month = 1; month <= 12; month++) {
      for (const year of ['2023', '2024']) {
        const out = joinDobParts(clampDobParts({ day: '31', month: String(month), year }))
        expect(out.state).toBe('complete')
      }
    }
  })
})

describe('round trip — a stored birthday survives the three selects', () => {
  // The proof AGENTS.md bug #1 asks for: value in → parts → value out, unchanged.
  const stored = ['2021-03-05', '2024-02-29', '1999-12-31', '2020-01-01', String(MIN_DOB_YEAR) + '-01-01']

  it.each(stored)('%s comes back out identical', value => {
    const parts = splitDobValue(value)
    expect(joinDobParts(parts)).toEqual({ value, state: 'complete' })
  })

  it('splits into the numbers the selects use (no leading zeros)', () => {
    expect(splitDobValue('2021-03-05')).toEqual({ day: '5', month: '3', year: '2021' })
  })

  it('treats a blank or unparseable stored value as nothing picked', () => {
    expect(splitDobValue(null)).toEqual({ day: '', month: '', year: '' })
    expect(splitDobValue('')).toEqual({ day: '', month: '', year: '' })
    expect(splitDobValue('05/03/2021')).toEqual({ day: '', month: '', year: '' })
    expect(splitDobValue(INCOMPLETE_DOB)).toEqual({ day: '', month: '', year: '' })
  })
})

describe('parseDobDate', () => {
  it('reads a date-only string at UTC midnight', () => {
    const d = parseDobDate('2021-03-05')
    expect(d?.toISOString()).toBe('2021-03-05T00:00:00.000Z')
  })

  it('rejects a date that only looks real', () => {
    // `new Date('2021-02-31T00:00:00Z')` rolls over to 3 March rather than
    // failing — which would store a different day than was picked.
    expect(parseDobDate('2021-02-31')).toBeNull()
    expect(parseDobDate('2023-02-29')).toBeNull()
    expect(parseDobDate('2021-13-01')).toBeNull()
    expect(parseDobDate('2021-00-10')).toBeNull()
  })

  it('accepts 29 February in a leap year', () => {
    expect(parseDobDate('2024-02-29')?.toISOString()).toBe('2024-02-29T00:00:00.000Z')
  })
})

describe('parseDobInput — the server-side guard', () => {
  const maxDate = new Date('2026-08-06T00:00:00.000Z')

  it('accepts a real past birthday', () => {
    const out = parseDobInput('2021-03-05', { maxDate })
    expect(out).toEqual({ ok: true, value: new Date('2021-03-05T00:00:00.000Z') })
  })

  it('treats no answer as null, not an error', () => {
    expect(parseDobInput(null)).toEqual({ ok: true, value: null })
    expect(parseDobInput(undefined)).toEqual({ ok: true, value: null })
    expect(parseDobInput('')).toEqual({ ok: true, value: null })
    expect(parseDobInput('   ')).toEqual({ ok: true, value: null })
  })

  it('rejects a half-picked date instead of storing null', () => {
    // The whole reason the field emits a sentinel: if the browser check is
    // skipped, the ROUTE refuses rather than writing "no birthday".
    expect(parseDobInput(INCOMPLETE_DOB)).toEqual({ ok: false })
  })

  it('rejects the future, the far past and anything that is not a date', () => {
    expect(parseDobInput('2027-01-01', { maxDate })).toEqual({ ok: false })
    expect(parseDobInput('1969-12-31', { maxDate })).toEqual({ ok: false })
    expect(parseDobInput('not-a-date', { maxDate })).toEqual({ ok: false })
    expect(parseDobInput('05/03/2021', { maxDate })).toEqual({ ok: false })
    expect(parseDobInput('2021-02-31', { maxDate })).toEqual({ ok: false })
  })

  it('allows today itself', () => {
    expect(parseDobInput('2026-08-06', { maxDate }).ok).toBe(true)
  })
})

describe('dateOfBirthError — what the screen says', () => {
  const maxDate = new Date('2026-08-06T00:00:00.000Z')

  it('says nothing about an untouched optional field', () => {
    expect(dateOfBirthError('')).toBeNull()
    expect(dateOfBirthError(null)).toBeNull()
  })

  it('asks for the missing part of a half-picked date', () => {
    expect(dateOfBirthError(INCOMPLETE_DOB))
      .toBe('Finish the date of birth — pick a day, a month and a year.')
  })

  it('complains when a required field is blank', () => {
    expect(dateOfBirthError('', { required: true })).toBe('Date of birth is required.')
  })

  it('names the field it is talking about', () => {
    expect(dateOfBirthError(INCOMPLETE_DOB, { label: "Bailey's date of birth" }))
      .toBe("Finish the bailey's date of birth — pick a day, a month and a year.")
  })

  it('rejects a future or impossible date', () => {
    expect(dateOfBirthError('2027-01-01', { maxDate })).toBe('Enter a real date of birth.')
    expect(dateOfBirthError('2021-02-31', { maxDate })).toBe('Enter a real date of birth.')
  })

  it('passes a real birthday', () => {
    expect(dateOfBirthError('2021-03-05', { maxDate })).toBeNull()
  })
})

describe('dobYearOptions', () => {
  const now = new Date('2026-08-06T00:00:00.000Z')

  it('runs from this year backwards, newest first — never a hard-coded year', () => {
    const years = dobYearOptions('dog', now)
    expect(years[0]).toBe(2026)
    expect(years[years.length - 1]).toBe(1996) // 30 years, a dog's outside lifespan
    expect(years).toEqual([...years].sort((a, b) => b - a))
  })

  it('gives a person a full lifetime, floored at the year the routes accept', () => {
    const years = dobYearOptions('person', now)
    expect(years[0]).toBe(2026)
    expect(years[years.length - 1]).toBe(MIN_DOB_YEAR)
  })

  it('follows the clock', () => {
    expect(dobYearOptions('dog', new Date('2031-01-01T00:00:00.000Z'))[0]).toBe(2031)
  })
})
