import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dateOnlyUtc, startOfDayInTz } from '@/lib/timezone'

// `@db.Date` columns are CALENDAR DAYS. Prisma renders a JS Date into DATE
// using its UTC components, so filtering one with an instant lands on the wrong
// day for anyone ahead of UTC — which is every New Zealand and Australian
// trainer, i.e. most of them.
//
// This has now shipped twice:
//   • 35bcea5 — the client's home screen showed last week's homework every
//     Monday morning, because the "this week" window was a day out.
//   • the weekly summary email — the same mistake in `nextWeek`, found by the
//     database audit on 2026-08-04.
//
// `dateOnlyUtc()` exists precisely to stop it. These tests pin the arithmetic,
// and then pin the CALL SITES, because the arithmetic was never the problem —
// remembering to use it was.

describe('the arithmetic that makes a calendar day survive a timezone', () => {
  it('dateOnlyUtc keeps the day it was given, whatever the server sits in', () => {
    const d = dateOnlyUtc('2026-08-05')
    expect(d.getUTCFullYear()).toBe(2026)
    expect(d.getUTCMonth()).toBe(7) // August
    expect(d.getUTCDate()).toBe(5)
  })

  it('an Auckland "start of day" instant lands on the PREVIOUS day in UTC', () => {
    // The whole bug in one assertion. Prisma would write this instant into a
    // DATE column as the 4th, not the 5th.
    const instant = startOfDayInTz('2026-08-05', 'Pacific/Auckland')
    expect(instant.getUTCDate()).toBe(4)
    expect(dateOnlyUtc('2026-08-05').getUTCDate()).toBe(5)
  })

  it('is stable across the NZ daylight-saving changeover', () => {
    // +12 and +13 either side; the calendar day must not care.
    for (const day of ['2026-04-04', '2026-04-05', '2026-09-26', '2026-09-27']) {
      expect(dateOnlyUtc(day).toISOString().slice(0, 10)).toBe(day)
    }
  })
})

// ── The call sites ─────────────────────────────────────────────────────────
// A source-level rule, in the spirit of listing-page-pattern.test.ts: the
// arithmetic above is easy and was never wrong. What goes wrong is a new query
// filtering a DATE column with an instant, and no unit test over mocked Prisma
// would notice — the mock accepts anything.

/** Every model field declared `@db.Date` in the schema. */
function dateOnlyFields(): string[] {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
  const names = new Set<string>()
  for (const line of schema.split('\n')) {
    if (!line.includes('@db.Date')) continue
    const m = line.trim().match(/^(\w+)\s+/)
    if (m) names.add(m[1])
  }
  return [...names]
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'generated' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('no query filters a @db.Date column with a timezone instant', () => {
  it('the schema really does have date-only columns to protect', () => {
    // Guards the guard: if the regex above stops matching, everything below
    // passes vacuously and the rule quietly stops existing.
    const fields = dateOnlyFields()
    expect(fields.length).toBeGreaterThan(0)
    expect(fields).toContain('date')
  })

  it('startOfDayInTz / endOfDayInTz results are never used as a date-column bound', () => {
    // The shape we are banning, on one line:
    //     date: { gte: startOfDayInTz(...), lte: endOfDayInTz(...) }
    // Written as a rule rather than a list of files so it keeps applying to
    // code nobody has written yet.
    const offenders: string[] = []
    const banned = /\b(date|dob|startDate|endDate|weekOf)\s*:\s*\{[^}]*\b(startOfDayInTz|endOfDayInTz)\s*\(/

    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      const src = readFileSync(file, 'utf8')
      if (!src.includes('startOfDayInTz') && !src.includes('endOfDayInTz')) continue
      // Collapse to one line so a multi-line `where` still matches.
      const flat = src.replace(/\s+/g, ' ')
      if (banned.test(flat)) offenders.push(file.replace(process.cwd() + '/', ''))
    }

    expect(
      offenders,
      `These filter a calendar-day column with an instant — use dateOnlyUtc() ` +
      `or weekBoundsUtcDates() instead:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
