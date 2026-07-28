import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { wholeRunFromSessions } from '@/lib/class-runs'

// A casual class prices each session row; the package carries no whole-course
// price. Invoicing learned that (a six-week class at £30 a session is £180, not
// £30) — but the CLIENT-facing checkout never did. It read
// `specialPriceCents ?? priceCents`, both null on a casual class, so a client
// enrolling themselves for the full run went through Stripe for whatever single
// figure happened to be sitting in priceCents, or for nothing at all.
//
// The trainer's invoice said one number and the client's card was charged
// another. Both now read the same helper, which is why it lives in class-runs
// rather than inside invoicing.
describe('wholeRunFromSessions — the price of a full run on a per-session class', () => {
  it('sums the sessions rather than charging one of them', () => {
    const pkg = {
      dropInPriceCents: 3000,
      sessionSlots: Array.from({ length: 6 }, () => ({ priceCents: 3000, specialPriceCents: null })),
    }
    expect(wholeRunFromSessions(pkg)).toBe(18000)
  })

  // The whole reason for summing slot by slot instead of count × price: a
  // casual class is free to price one week differently.
  it('respects a session priced differently from the rest', () => {
    const pkg = {
      dropInPriceCents: 3000,
      sessionSlots: [
        { priceCents: 3000, specialPriceCents: null },
        { priceCents: 4500, specialPriceCents: null },
        { priceCents: 3000, specialPriceCents: null },
      ],
    }
    expect(wholeRunFromSessions(pkg)).toBe(10500)
  })

  it('takes a slot’s special price over its normal one', () => {
    const pkg = {
      dropInPriceCents: 3000,
      sessionSlots: [
        { priceCents: 3000, specialPriceCents: 2000 },
        { priceCents: 3000, specialPriceCents: null },
      ],
    }
    expect(wholeRunFromSessions(pkg)).toBe(5000)
  })

  it('falls back to the package per-session price for a slot with none of its own', () => {
    const pkg = {
      dropInPriceCents: 3000,
      sessionSlots: [
        { priceCents: null, specialPriceCents: null },
        { priceCents: null, specialPriceCents: null },
      ],
    }
    expect(wholeRunFromSessions(pkg)).toBe(6000)
  })

  // A genuinely free class must charge nothing, not raise a £0 receivable.
  it('returns null when nothing anywhere carries a price', () => {
    expect(wholeRunFromSessions({ dropInPriceCents: null, sessionSlots: [] })).toBeNull()
    expect(wholeRunFromSessions({
      dropInPriceCents: null,
      sessionSlots: [{ priceCents: null, specialPriceCents: null }],
    })).toBeNull()
  })
})

// The route's own decisions are asserted against its source, matching the
// existing enrol-route tests — the pricing feeds a Stripe checkout a unit test
// can't follow, but the figure it reaches for is pinnable.
const route = readFileSync('src/app/api/my/classes/[runId]/enroll/route.ts', 'utf8')

describe('POST /api/my/classes/[runId]/enroll — a full run on a casual class', () => {
  it('falls back to the whole-run total when the package has no course price', () => {
    expect(route).toContain('run.package.specialPriceCents ?? run.package.priceCents ?? wholeRunFromSessions(run.package)')
  })

  it('loads the session slots the total is built from', () => {
    expect(route).toContain('sessionSlots: { select: { priceCents: true, specialPriceCents: true } }')
  })

  // A ticketed event is priced by its ticket, full stop — the fallback must not
  // reach past that and re-price a $200 ticket off the sessions.
  it('still lets a ticket price win outright', () => {
    expect(route).toContain('ticketed && tier ? tier.priceCents')
  })

  // A DROP_IN pays for the one session it booked. That distinction is the whole
  // point of the two enrolment types, and the fix must not blur it.
  it('leaves a drop-in priced by its own sessions', () => {
    expect(route).toContain('perSession.reduce<number | null>')
  })
})
