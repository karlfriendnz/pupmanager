import { describe, it, expect, vi } from 'vitest'

// Pure-logic test: stub the infra deps so importing the module doesn't
// spin up a real PrismaClient (which needs DATABASE_URL). vi.mock is
// hoisted above the import below.
vi.mock('../../src/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/generated/prisma', () => ({}))

import {
  generateSessionDates,
  effectiveCapacity,
  seatsRemaining,
  decideEnrollment,
  dropInPriceCents,
  isClassRunPast,
} from '../../src/lib/class-runs'

describe('isClassRunPast (Current/Past tabs on /classes)', () => {
  const now = new Date('2026-07-22T09:00:00.000Z')

  it('a run mid-course is current even though it started weeks ago', () => {
    expect(
      isClassRunPast(
        {
          status: 'SCHEDULED',
          startDate: new Date('2026-06-30T18:00:00.000Z'),
          lastSessionAt: new Date('2026-08-04T18:00:00.000Z'),
        },
        now,
      ),
    ).toBe(false)
  })

  it('a run whose last session has been is past', () => {
    expect(
      isClassRunPast(
        {
          status: 'SCHEDULED',
          startDate: new Date('2026-05-05T18:00:00.000Z'),
          lastSessionAt: new Date('2026-06-09T18:00:00.000Z'),
        },
        now,
      ),
    ).toBe(true)
  })

  it('COMPLETED and CANCELLED are past regardless of dates', () => {
    const future = { startDate: new Date('2026-09-01T18:00:00.000Z'), lastSessionAt: new Date('2026-10-06T18:00:00.000Z') }
    expect(isClassRunPast({ status: 'COMPLETED', ...future }, now)).toBe(true)
    expect(isClassRunPast({ status: 'CANCELLED', ...future }, now)).toBe(true)
  })

  it('falls back to startDate when the run has no sessions yet', () => {
    expect(isClassRunPast({ status: 'SCHEDULED', startDate: new Date('2026-09-01T18:00:00.000Z') }, now)).toBe(false)
    expect(isClassRunPast({ status: 'SCHEDULED', startDate: new Date('2026-01-05T18:00:00.000Z') }, now)).toBe(true)
  })
})

describe('generateSessionDates', () => {
  it('spaces sessions weeksBetween apart from startDate', () => {
    const start = new Date('2026-06-02T18:00:00.000Z') // a Tuesday
    const dates = generateSessionDates(start, 6, 1)
    expect(dates).toHaveLength(6)
    expect(dates[0].toISOString()).toBe('2026-06-02T18:00:00.000Z')
    expect(dates[5].toISOString()).toBe('2026-07-07T18:00:00.000Z') // +35 days
  })
  it('ongoing package (sessionCount 0) yields a single seed session', () => {
    expect(generateSessionDates(new Date('2026-06-02'), 0, 2)).toHaveLength(1)
  })
  it('weeksBetween 0 stacks all on the start date', () => {
    const d = generateSessionDates(new Date('2026-06-02T00:00:00Z'), 3, 0)
    expect(new Set(d.map(x => x.toISOString())).size).toBe(1)
  })
  it('one-off (sessionCount 1) yields exactly one session regardless of cadence', () => {
    const start = new Date('2026-06-02T18:00:00Z')
    const dates = generateSessionDates(start, 1, 2)
    expect(dates).toHaveLength(1)
    expect(dates[0].toISOString()).toBe(start.toISOString())
  })
})

describe('effectiveCapacity', () => {
  it('run override wins over package', () => {
    expect(effectiveCapacity(8, 12)).toBe(8)
  })
  it('falls back to package when run is null', () => {
    expect(effectiveCapacity(null, 12)).toBe(12)
  })
  it('unlimited when both null', () => {
    expect(effectiveCapacity(null, null)).toBeNull()
  })
  it('run override of 0 is respected (a closed class), not treated as unset', () => {
    expect(effectiveCapacity(0, 12)).toBe(0)
  })
})

describe('seatsRemaining', () => {
  it('null capacity = unlimited', () => {
    expect(seatsRemaining(null, 999)).toBeNull()
  })
  it('never goes negative if somehow over-enrolled', () => {
    expect(seatsRemaining(10, 13)).toBe(0)
  })
  it('counts down correctly', () => {
    expect(seatsRemaining(10, 7)).toBe(3)
  })
})

describe('decideEnrollment', () => {
  it('enrols when seats remain', () => {
    expect(decideEnrollment({ capacity: 10, enrolledCount: 4, allowWaitlist: false })).toBe('ENROLLED')
  })
  it('enrols when capacity is unlimited', () => {
    expect(decideEnrollment({ capacity: null, enrolledCount: 999, allowWaitlist: false })).toBe('ENROLLED')
  })
  it('waitlists when full and waitlist allowed', () => {
    expect(decideEnrollment({ capacity: 10, enrolledCount: 10, allowWaitlist: true })).toBe('WAITLISTED')
  })
  it('rejects when full and no waitlist', () => {
    expect(decideEnrollment({ capacity: 10, enrolledCount: 10, allowWaitlist: false })).toBe('REJECTED_FULL')
  })
})

describe('dropInPriceCents', () => {
  it('null when package has no drop-in price', () => {
    expect(dropInPriceCents({ dropInPriceCents: null, sessionCount: 6, joinedAtIndex: 3 })).toBeNull()
  })
  it('charges per remaining session from the join index', () => {
    // 6-session class, joining at session 3 → 4 sessions left × 2500c
    expect(dropInPriceCents({ dropInPriceCents: 2500, sessionCount: 6, joinedAtIndex: 3 })).toBe(10000)
  })
  it('joining at session 1 pays for the whole run', () => {
    expect(dropInPriceCents({ dropInPriceCents: 2500, sessionCount: 6, joinedAtIndex: 1 })).toBe(15000)
  })
  it('never negative if joinedAtIndex past the end', () => {
    expect(dropInPriceCents({ dropInPriceCents: 2500, sessionCount: 6, joinedAtIndex: 9 })).toBe(0)
  })
})
