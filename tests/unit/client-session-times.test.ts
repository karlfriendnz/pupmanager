import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// A client reported a class showing 6:00pm in the enrolment email but 6:00am in
// the app. Session times were being formatted without a timeZone: in a SERVER
// component that means the server's zone (UTC on Vercel), and 18:00 Pacific/
// Auckland is exactly 06:00 UTC. In a CLIENT component it also caused a
// hydration mismatch — UTC on the server, the viewer's zone in the browser.
//
// Sessions happen in the TRAINER's locale, so that's the zone every surface
// must use — the same one the email already used.

describe('the reported bug', () => {
  const opts = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' } as const
  const sixPmAuckland = new Date('2026-08-13T06:00:00.000Z')

  it('renders 6pm in the trainer’s zone and 6am in UTC — the exact 12h shift', () => {
    expect(sixPmAuckland.toLocaleString('en-NZ', { ...opts, timeZone: 'UTC' })).toMatch(/6:00 am/)
    expect(sixPmAuckland.toLocaleString('en-NZ', { ...opts, timeZone: 'Pacific/Auckland' })).toMatch(/6:00 pm/)
  })

  // Worse than the clock: a morning class falls on the previous DAY in UTC.
  it('a 9am class is the previous calendar day in UTC', () => {
    const nineAm = new Date('2026-08-12T21:00:00.000Z')
    const day = (tz: string) =>
      new Intl.DateTimeFormat('en-NZ', { timeZone: tz, day: 'numeric' }).format(nineAm)
    expect(day('UTC')).toBe('12')
    expect(day('Pacific/Auckland')).toBe('13')
  })
})

// Guards the fix itself: these surfaces show a client when their session is, and
// every one of them must pin a zone. Asserted on the source because they're
// server components / JSX, not callable units.
describe('client-facing session times pin a timezone', () => {
  const files = [
    'src/app/(client)/my-sessions/page.tsx',
    'src/app/(client)/my-sessions/[sessionId]/page.tsx',
    'src/app/(client)/home/home-view.tsx',
    'src/app/(client)/my-availability/booking-wizard.tsx',
  ]

  it.each(files)('%s formats with a timeZone', (file) => {
    const src = readFileSync(file, 'utf8')
    // Every toLocaleString/toLocaleDateString that renders a session must carry
    // a timeZone. Find any that don't.
    const lines = src.split('\n')
    const bare = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /toLocale(String|DateString|TimeString)\(/.test(l))
      .filter(({ l }) => !l.trim().startsWith('//'))
      // The options object may wrap onto following lines, so look at the whole
      // call, not just the line the method name happens to sit on.
      .filter(({ i }) => !/timeZone/.test(lines.slice(i, i + 4).join('\n')))
      .map(({ l }) => l.trim())
    expect(bare, `formats without a timeZone:\n${bare.join('\n')}`).toEqual([])
  })

  it('falls back to the trainer’s zone, matching the email', () => {
    const src = readFileSync('src/app/(client)/my-sessions/page.tsx', 'utf8')
    expect(src).toContain("timezone ?? 'Pacific/Auckland'")
  })
})
