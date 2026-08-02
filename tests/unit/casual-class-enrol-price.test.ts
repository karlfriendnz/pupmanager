import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// What a FULL seat on a casual class costs. Two fixes have now missed this.
//
// e12c323 summed the package's SESSION SLOTS. That is wrong twice over:
//   • a slot is a recurring TEMPLATE ("Saturdays 10am"), not a session — two
//     slots over six weeks are twelve sessions, so the sum is one week of the
//     timetable, not the run;
//   • a classic casual class ("allow drop-ins" ticked, no slot schedule) has
//     NO slots at all, so the sum came back as one session's drop-in rate.
//
// That second shape is the customer's: a twelve-session class at $150 kept
// invoicing at $150 after the fix that was meant to make it $1,800. Sessions
// are what a trainer means by "the whole run", so sessions are what we count.
const h = vi.hoisted(() => ({ sessionFindMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { trainingSession: { findMany: h.sessionFindMany } } }))

import { wholeRunPriceCents } from '@/lib/class-runs'

const RUN = 'run_1'

/** N sessions, each carrying the slot given (null = no slot of its own). */
function sessions(n: number, slot: { priceCents: number | null; specialPriceCents: number | null } | null = null) {
  return Array.from({ length: n }, () => ({ packageSessionSlot: slot }))
}

beforeEach(() => {
  h.sessionFindMany.mockReset()
})

describe('wholeRunPriceCents — a full seat on a per-session class', () => {
  // The reported bug, exactly: 12 sessions, $150 each, no slot schedule.
  it('bills every session on a class with no slot schedule', async () => {
    h.sessionFindMany.mockResolvedValue(sessions(12))

    const total = await wholeRunPriceCents(RUN, { dropInPriceCents: 15000 })

    expect(total).toBe(180000) // $1,800 — not $150
  })

  // The other shape e12c323 got wrong: slots are templates, so counting them
  // undercharges by however many times each one repeats.
  it('counts sessions, not the slots they were generated from', async () => {
    // Two weekly slots over six weeks = twelve sessions.
    h.sessionFindMany.mockResolvedValue([
      ...sessions(6, { priceCents: 3000, specialPriceCents: null }),
      ...sessions(6, { priceCents: 4000, specialPriceCents: null }),
    ])

    const total = await wholeRunPriceCents(RUN, { dropInPriceCents: 3000 })

    expect(total).toBe(42000) // 6×£30 + 6×£40 — not £30+£40
  })

  it('respects a session priced differently from the rest', async () => {
    h.sessionFindMany.mockResolvedValue([
      ...sessions(2, { priceCents: 3000, specialPriceCents: null }),
      ...sessions(1, { priceCents: 4500, specialPriceCents: null }),
    ])

    expect(await wholeRunPriceCents(RUN, { dropInPriceCents: 3000 })).toBe(10500)
  })

  it('takes a slot’s special price over its normal one', async () => {
    h.sessionFindMany.mockResolvedValue(sessions(2, { priceCents: 3000, specialPriceCents: 2000 }))

    expect(await wholeRunPriceCents(RUN, { dropInPriceCents: 3000 })).toBe(4000)
  })

  it('falls back to the package rate for a session with no slot price', async () => {
    h.sessionFindMany.mockResolvedValue(sessions(4, { priceCents: null, specialPriceCents: null }))

    expect(await wholeRunPriceCents(RUN, { dropInPriceCents: 2500 })).toBe(10000)
  })

  // A genuinely free class raises nothing, not a £0 receivable.
  it('returns null when nothing anywhere carries a price', async () => {
    h.sessionFindMany.mockResolvedValue(sessions(6))
    expect(await wholeRunPriceCents(RUN, { dropInPriceCents: null })).toBeNull()
  })

  it('returns the flat rate when the run somehow has no sessions', async () => {
    h.sessionFindMany.mockResolvedValue([])
    expect(await wholeRunPriceCents(RUN, { dropInPriceCents: 15000 })).toBe(15000)
  })
})

// Both places that price a class assert against their source: the figures feed
// a Stripe checkout and an invoice a unit test can't follow end to end, but the
// value each reaches for is pinnable.
const invoicing = readFileSync('src/lib/invoicing.ts', 'utf8')
const route = readFileSync('src/app/api/my/classes/[runId]/enroll/route.ts', 'utf8')

describe('a per-session class ignores the stale course price', () => {
  // The pricing card is hidden on a casual class's edit form, so any figure in
  // priceCents was typed before it became one and has been invisible since.
  // Reading it is what billed a full run as a single session.
  it('prices a full seat off the run when the class allows drop-ins', () => {
    expect(invoicing).toContain('pkg.allowDropIn')
    expect(invoicing).toContain('await wholeRunPriceCents(enr.classRun.id, pkg)')
    expect(route).toContain('run.package.allowDropIn')
    expect(route).toContain('await wholeRunPriceCents(runId, run.package)')
  })

  // A normal group class DOES have a course price, and it must still win.
  it('leaves an ordinary class reading its course price first', () => {
    expect(invoicing).toContain('pkg.specialPriceCents ?? pkg.priceCents ?? await wholeRunPriceCents')
  })

  it('still lets a ticket price win outright', () => {
    expect(route).toContain('ticketed && tier ? tier.priceCents')
    // Matched loosely on purpose: this ladder moved into priceClassEnrollment
    // (shared with the discount quoter), so its indentation is not the point —
    // the tier winning over everything else is.
    expect(invoicing).toMatch(/enr\.ticketTier\s*\?\s*enr\.ticketTier\.priceCents/)
  })

  // A DROP_IN pays for the sessions it booked. That distinction is the whole
  // point of the two enrolment types.
  it('leaves a drop-in priced by its own sessions', () => {
    expect(route).toContain('perSession.reduce<number | null>')
    expect(invoicing).toContain('sessionDropInPriceCents(enr.dropInSession?.packageSessionSlot, pkg)')
  })
})

// The trainer picks "Full run" on a casual class with no headline price shown
// anywhere on the screen, so until now the total was a surprise that arrived
// with the invoice. The button now carries the figure — and carries the one the
// SERVER worked out, so what's on the button and what's on the invoice are the
// same number by construction.
const roster = readFileSync('src/components/trainer/run-roster.tsx', 'utf8')
const runContent = readFileSync('src/app/(trainer)/classes/[runId]/run-detail-content.tsx', 'utf8')

describe('the Enrol modal shows what a full run costs', () => {
  it('takes the price from the server, not from a second sum in the browser', () => {
    expect(runContent).toContain('fullRunPriceCents: await wholeRunPriceCents(runId, run.package)')
    expect(roster).toContain('fullRunPriceCents?: number | null')
  })

  it('needs the per-session rate the whole-run price falls back to', () => {
    expect(runContent).toContain('dropInPriceCents: true')
  })

  it('prints it on the Full run button in the trainer’s own currency', () => {
    expect(roster).toContain('formatMoney(fullRunPriceCents, currency)')
  })

  it('says how many sessions that covers', () => {
    expect(roster).toContain("All {sessions.length} session")
  })

  // A free class, and an event that sells tickets, must show no figure rather
  // than a confident $0.
  it('shows nothing when there is no price to show', () => {
    expect(roster).toContain('fullRunPriceCents != null')
  })
})
