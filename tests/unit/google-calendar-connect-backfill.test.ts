import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Outbound sync only ever fired as a session was created or edited. So a
// trainer who connected Google on Tuesday got an empty calendar and a term's
// worth of already-scheduled classes that were never going to appear — the
// connection looked broken when it was working exactly as built.
//
// Busy import has always been seeded on connect. This is the other half.
const callback = readFileSync('src/app/api/google-calendar/callback/route.ts', 'utf8')

describe('connecting Google backfills the diary you already have', () => {
  it('pushes existing sessions once the connection is saved', () => {
    expect(callback).toContain('backfillSessionsToGoogle({')
    expect(callback).toContain('execute: true')
  })

  it('only touches the company that just connected', () => {
    expect(callback).toContain('companyId: membership.companyId')
  })

  // The trainer should land back on Settings immediately, not watch a spinner
  // while a term of classes is written to Google one at a time.
  it('runs after the redirect, not before it', () => {
    const i = callback.indexOf('after(async () => {')
    const r = callback.indexOf('return NextResponse.redirect(done)')
    expect(i).toBeGreaterThan(-1)
    expect(i).toBeLessThan(r)
  })

  // A connect that half-works must still be a connect.
  it('never lets a backfill failure break the connection', () => {
    const i = callback.indexOf('after(async () => {')
    const block = callback.slice(i, i + 1200)
    expect(block).toContain('try {')
    expect(block).toContain('catch (err)')
  })

  // Still seeds the inbound busy window — this is an addition, not a swap.
  it('keeps the busy-window import it already did', () => {
    expect(callback).toContain('await refreshBusyForMembership(membershipId)')
  })
})

// The sweep itself gained the company filter. The cron still sweeps everyone.
const h = vi.hoisted(() => ({
  connFindMany: vi.fn(),
  sessionCount: vi.fn(),
  sessionFindMany: vi.fn(),
  hasAddon: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    googleCalendarConnection: { findMany: h.connFindMany },
    trainingSession: { count: h.sessionCount, findMany: h.sessionFindMany },
  },
}))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/google-calendar', () => ({}))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }))

import { backfillSessionsToGoogle } from '@/lib/google-calendar-sync'

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.connFindMany.mockResolvedValue([{ companyId: 'tr_1' }])
  h.hasAddon.mockResolvedValue(true)
  h.sessionCount.mockResolvedValue(0)
  h.sessionFindMany.mockResolvedValue([])
})

describe('backfillSessionsToGoogle — the company filter', () => {
  it('asks only for that company’s connections when one is named', async () => {
    await backfillSessionsToGoogle({ companyId: 'tr_1' })

    expect(h.connFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'tr_1' } }),
    )
  })

  // The cron sweeps everyone — passing no company must not narrow it.
  it('leaves the sweep unfiltered when no company is named', async () => {
    await backfillSessionsToGoogle({})

    expect(h.connFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    )
  })

  // Counting is the default; a caller has to ask before anything is written.
  it('writes nothing unless execute is set', async () => {
    h.sessionCount.mockResolvedValue(12)

    const r = await backfillSessionsToGoogle({ companyId: 'tr_1' })

    expect(h.sessionFindMany).not.toHaveBeenCalled()
    expect(r.synced).toBe(0)
    expect(r.remaining).toBe(12)
  })

  // Turning the add-on off has to stop the push, connection or no connection.
  it('skips a company whose add-on is off', async () => {
    h.hasAddon.mockResolvedValue(false)
    h.sessionCount.mockResolvedValue(12)

    const r = await backfillSessionsToGoogle({ companyId: 'tr_1', execute: true })

    expect(r.activeCompanies).toBe(0)
    expect(r.candidates).toBe(0)
  })
})
