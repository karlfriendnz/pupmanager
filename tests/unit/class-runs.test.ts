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
  classSessionSpaces,
  isClassRunPast,
  slotDurationMins,
  planSlotSessions,
  sessionDropInPriceCents,
  sessionCapacity,
  type ScheduleSlot,
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
  it('never stacks several sessions on one instant, even at weeksBetween 0', () => {
    // This used to return three copies of the start date. The grid draws a
    // block per session at its own time and labels it with the RUN's name, so
    // three identical blocks landed on top of each other and read as one class
    // rendered over and over. A multi-session run gets at least a week's gap.
    const d = generateSessionDates(new Date('2026-06-02T00:00:00Z'), 3, 0)
    expect(d).toHaveLength(3)
    expect(new Set(d.map(x => x.toISOString())).size).toBe(3)
    expect(d[1].toISOString()).toBe('2026-06-09T00:00:00.000Z')
    expect(d[2].toISOString()).toBe('2026-06-16T00:00:00.000Z')
  })
  it('leaves a one-off alone at weeksBetween 0', () => {
    const d = generateSessionDates(new Date('2026-06-02T00:00:00Z'), 1, 0)
    expect(d).toHaveLength(1)
    expect(d[0].toISOString()).toBe('2026-06-02T00:00:00.000Z')
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

describe('classSessionSpaces (per-session capacity)', () => {
  const E = (over: Partial<{ type: 'FULL' | 'DROP_IN'; dropInSessionId: string | null }> = {}) =>
    ({ type: 'FULL' as const, dropInSessionId: null, ...over })

  it('unlimited capacity → every session unlimited', () => {
    const s = classSessionSpaces(null, [E(), E({ type: 'DROP_IN', dropInSessionId: 's1' })])
    expect(s.fullSeats).toBe(1)
    expect(s.spacesLeftFor('s1')).toBeNull()
  })

  it('full seats consume every session; drop-ins only their own', () => {
    // cap 3, two full-course + a drop-in on s2.
    const s = classSessionSpaces(3, [E(), E(), E({ type: 'DROP_IN', dropInSessionId: 's2' })])
    expect(s.fullSeats).toBe(2)
    expect(s.spacesLeftFor('s1')).toBe(1) // 3 − 2 full
    expect(s.spacesLeftFor('s2')).toBe(0) // 3 − 2 full − 1 drop-in
  })

  it('a session with room stays bookable even when another is full', () => {
    const s = classSessionSpaces(2, [E({ type: 'DROP_IN', dropInSessionId: 's1' }), E({ type: 'DROP_IN', dropInSessionId: 's1' })])
    expect(s.spacesLeftFor('s1')).toBe(0) // two drop-ins here
    expect(s.spacesLeftFor('s2')).toBe(2) // untouched
  })

  it('never negative', () => {
    const s = classSessionSpaces(1, [E(), E(), E()])
    expect(s.spacesLeftFor('sX')).toBe(0)
  })
})

describe('dropInPriceCents (single-session model)', () => {
  it('null when package has no drop-in price', () => {
    expect(dropInPriceCents({ dropInPriceCents: null })).toBeNull()
    expect(dropInPriceCents({ dropInPriceCents: undefined })).toBeNull()
  })
  it('is the flat per-session price — a drop-in is one session, sold on its own', () => {
    expect(dropInPriceCents({ dropInPriceCents: 2500 })).toBe(2500)
  })
  it('a zero price is a real (free) drop-in, not "unpriced"', () => {
    expect(dropInPriceCents({ dropInPriceCents: 0 })).toBe(0)
  })
})

describe('slotDurationMins', () => {
  it('straightforward same-day span', () => {
    expect(slotDurationMins('15:00', '17:00')).toBe(120)
    expect(slotDurationMins('09:30', '10:15')).toBe(45)
  })
  it('an end at or before the start runs past midnight, never zero/negative', () => {
    expect(slotDurationMins('21:00', '00:30')).toBe(210)
    expect(slotDurationMins('10:00', '10:00')).toBe(24 * 60)
  })
  it('survives junk rather than producing NaN', () => {
    expect(slotDurationMins('', '')).toBe(24 * 60)
  })
})

describe('planSlotSessions (a drop-in class schedules itself from its slots)', () => {
  const tz = 'Pacific/Auckland'
  // 2026-07-20 is a Monday.
  const runStart = new Date('2026-07-20T00:00:00.000Z')

  const slot = (over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
    id: 'slot1',
    order: 0,
    startDate: null,
    day: 2, // Tuesday
    startTime: '15:00',
    endTime: '17:00',
    gapMins: 0,
    recurrenceRule: 'FREQ=WEEKLY;COUNT=3',
    assignedMembershipIds: [],
    ...over,
  })

  it('expands one slot into its series, at its own wall-clock time', () => {
    const out = planSlotSessions([slot()], { runStart, tz })
    expect(out).toHaveLength(3)
    expect(out.every(s => s.slotId === 'slot1')).toBe(true)
    expect(out.every(s => s.durationMins === 120)).toBe(true)
    // 15:00 in Auckland (NZST, UTC+12 in July) = 03:00 UTC.
    expect(out[0].scheduledAt.toISOString()).toBe('2026-07-21T03:00:00.000Z')
    // A week apart.
    expect(out[1].scheduledAt.toISOString()).toBe('2026-07-28T03:00:00.000Z')
  })

  it('rolls the first occurrence forward to the slot’s weekday', () => {
    // Run starts Monday; a Saturday slot must start that Saturday, not Monday.
    const out = planSlotSessions([slot({ day: 6, recurrenceRule: null })], { runStart, tz })
    expect(out).toHaveLength(1)
    expect(out[0].scheduledAt.toISOString()).toBe('2026-07-25T03:00:00.000Z')
  })

  it('a slot’s own startDate overrides the run’s', () => {
    const out = planSlotSessions(
      [slot({ startDate: new Date('2026-09-01T00:00:00.000Z'), recurrenceRule: null })],
      { runStart, tz },
    )
    // 2026-09-01 is already a Tuesday.
    expect(out[0].scheduledAt.toISOString()).toBe('2026-09-01T03:00:00.000Z')
  })

  it('interleaves several slots into ONE chronological series', () => {
    // This is the point of the model: Tuesday afternoons AND Saturday mornings,
    // each with its own time — the run must come out in date order.
    const out = planSlotSessions(
      [
        slot({ id: 'sat', order: 1, day: 6, startTime: '09:00', endTime: '10:00' }),
        slot({ id: 'tue', order: 0, day: 2 }),
      ],
      { runStart, tz },
    )
    expect(out).toHaveLength(6)
    const times = out.map(s => s.scheduledAt.getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(out.map(s => s.slotId)).toEqual(['tue', 'sat', 'tue', 'sat', 'tue', 'sat'])
  })

  it('carries the slot’s gap and first assigned trainer onto every session', () => {
    const out = planSlotSessions(
      [slot({ gapMins: 15, assignedMembershipIds: ['m1', 'm2'] })],
      { runStart, tz },
    )
    expect(out.every(s => s.bufferMins === 15)).toBe(true)
    expect(out.every(s => s.assignedMembershipId === 'm1')).toBe(true)
  })

  it('unassigned slots leave the session unassigned', () => {
    const out = planSlotSessions([slot()], { runStart, tz })
    expect(out[0].assignedMembershipId).toBeNull()
  })

  it('an open-ended slot is bounded by maxPerSlot', () => {
    const out = planSlotSessions([slot({ recurrenceRule: 'FREQ=WEEKLY' })], { runStart, tz, maxPerSlot: 4 })
    expect(out).toHaveLength(4)
  })

  it('no slots means no sessions (the caller falls back to the flat cadence)', () => {
    expect(planSlotSessions([], { runStart, tz })).toEqual([])
  })

  it('keeps the wall-clock time across a daylight-saving change', () => {
    // NZ leaves daylight saving on 2026-04-05. A 15:00 class stays 15:00 local
    // either side, so the UTC instant SHIFTS — that's the correct behaviour.
    const out = planSlotSessions(
      [slot({ startDate: new Date('2026-03-31T00:00:00.000Z'), recurrenceRule: 'FREQ=WEEKLY;COUNT=2' })],
      { runStart, tz },
    )
    // 31 Mar is NZDT (UTC+13) → 02:00Z; 7 Apr is NZST (UTC+12) → 03:00Z.
    expect(out[0].scheduledAt.toISOString()).toBe('2026-03-31T02:00:00.000Z')
    expect(out[1].scheduledAt.toISOString()).toBe('2026-04-07T03:00:00.000Z')
  })
})

describe('sessionDropInPriceCents (what ONE session costs)', () => {
  it('prefers the slot’s special price, then its price', () => {
    expect(sessionDropInPriceCents({ priceCents: 3000, specialPriceCents: 2000 }, { dropInPriceCents: 9900 })).toBe(2000)
    expect(sessionDropInPriceCents({ priceCents: 3000, specialPriceCents: null }, { dropInPriceCents: 9900 })).toBe(3000)
  })
  it('a free session is free — 0 is a price, not "unset"', () => {
    expect(sessionDropInPriceCents({ priceCents: 0, specialPriceCents: null }, { dropInPriceCents: 9900 })).toBe(0)
  })
  it('falls back to the package rate for a classic class with no slots', () => {
    expect(sessionDropInPriceCents(null, { dropInPriceCents: 2500 })).toBe(2500)
    expect(sessionDropInPriceCents(undefined, { dropInPriceCents: 2500 })).toBe(2500)
  })
  it('a slot with no price of its own falls back to the package rate', () => {
    expect(sessionDropInPriceCents({ priceCents: null, specialPriceCents: null }, { dropInPriceCents: 2500 })).toBe(2500)
  })
  it('null when nothing prices it', () => {
    expect(sessionDropInPriceCents(null, { dropInPriceCents: null })).toBeNull()
  })
})

describe('sessionCapacity (a class can cap Saturdays at 6 and Tuesdays at 12)', () => {
  it('the slot wins when it sets one', () => {
    expect(sessionCapacity({ capacity: 6 }, 20, 30)).toBe(6)
  })
  it('0 is a real cap (session closed), not "unset"', () => {
    expect(sessionCapacity({ capacity: 0 }, 20, 30)).toBe(0)
  })
  it('falls back to run, then package, then unlimited', () => {
    expect(sessionCapacity({ capacity: null }, 20, 30)).toBe(20)
    expect(sessionCapacity({ capacity: null }, null, 30)).toBe(30)
    expect(sessionCapacity(null, null, null)).toBeNull()
  })
})

describe('classSessionSpaces with a per-session cap', () => {
  const E = (o: Partial<{ type: 'FULL' | 'DROP_IN'; dropInSessionId: string | null }> = {}) =>
    ({ type: 'FULL' as const, dropInSessionId: null, ...o })

  it('the override caps that session independently of the run', () => {
    const s = classSessionSpaces(12, [E(), E()])
    expect(s.spacesLeftFor('s1')).toBe(10)   // run capacity
    expect(s.spacesLeftFor('s1', 6)).toBe(4) // this session's own, tighter cap
  })
  it('an explicit null override means unlimited for that session', () => {
    const s = classSessionSpaces(4, [E(), E(), E(), E()])
    expect(s.spacesLeftFor('s1')).toBe(0)
    expect(s.spacesLeftFor('s1', null)).toBeNull()
  })
})
