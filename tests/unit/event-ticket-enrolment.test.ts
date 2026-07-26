import { describe, it, expect, vi } from 'vitest'

// An event sells several named ticket types at their own prices, and a ticket
// can be bought more than one at a time. Before this, an event enrolment was
// priced off the offering's single flat price — so a trainer enrolling someone
// on a $123 VIP ticket raised a $45 invoice, and the details page quoted the
// $45. These are the pure rules behind "which ticket × how many".
vi.mock('../../src/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/generated/prisma', () => ({}))

import {
  normalizeTicketQuantity,
  decideEnrollment,
  classSessionSpaces,
  isOneOffEventPackage,
  MAX_TICKET_QUANTITY,
} from '../../src/lib/class-runs'

describe('normalizeTicketQuantity', () => {
  it('defaults to one place', () => {
    expect(normalizeTicketQuantity(undefined)).toBe(1)
    expect(normalizeTicketQuantity(null)).toBe(1)
  })

  it('never bills for zero or a negative number of tickets', () => {
    expect(normalizeTicketQuantity(0)).toBe(1)
    expect(normalizeTicketQuantity(-3)).toBe(1)
  })

  it('caps a fat-fingered quantity rather than selling 10,000 places', () => {
    expect(normalizeTicketQuantity(10_000)).toBe(MAX_TICKET_QUANTITY)
  })

  it('truncates a fraction and ignores nonsense', () => {
    expect(normalizeTicketQuantity(2.9)).toBe(2)
    expect(normalizeTicketQuantity('3' as unknown)).toBe(1)
    expect(normalizeTicketQuantity(NaN)).toBe(1)
  })
})

describe('decideEnrollment — a booking can take several places', () => {
  const base = { allowWaitlist: false }

  it('one ticket into the last place still fits', () => {
    expect(decideEnrollment({ ...base, capacity: 8, enrolledCount: 7, seats: 1 })).toBe('ENROLLED')
  })

  // The bug this guards: counting a 4-ticket booking as one seat oversells the
  // room by three.
  it('four tickets into three places does not fit', () => {
    expect(decideEnrollment({ ...base, capacity: 8, enrolledCount: 5, seats: 4 })).toBe('REJECTED_FULL')
  })

  it('exactly filling the remaining places fits', () => {
    expect(decideEnrollment({ ...base, capacity: 8, enrolledCount: 5, seats: 3 })).toBe('ENROLLED')
  })

  it('a group that will not fit goes on the waitlist when the offering has one', () => {
    expect(decideEnrollment({ capacity: 8, enrolledCount: 6, seats: 4, allowWaitlist: true })).toBe('WAITLISTED')
  })

  it('unlimited capacity takes any number of tickets', () => {
    expect(decideEnrollment({ ...base, capacity: null, enrolledCount: 99, seats: 20 })).toBe('ENROLLED')
  })

  it('omitting seats behaves exactly as one seat did before', () => {
    expect(decideEnrollment({ ...base, capacity: 3, enrolledCount: 2 })).toBe('ENROLLED')
    expect(decideEnrollment({ ...base, capacity: 3, enrolledCount: 3 })).toBe('REJECTED_FULL')
  })
})

describe('classSessionSpaces — places, not rows', () => {
  const E = (over: Partial<{ type: 'FULL' | 'DROP_IN'; dropInSessionId: string | null; quantity: number }> = {}) =>
    ({ type: 'FULL' as const, dropInSessionId: null, ...over })

  it('a booking with no quantity counts as one place (every class enrolment)', () => {
    const s = classSessionSpaces(8, [E(), E(), E()])
    expect(s.fullSeats).toBe(3)
    expect(s.spacesLeftFor('s1')).toBe(5)
  })

  it('a two-ticket booking takes two of the places', () => {
    const s = classSessionSpaces(8, [E({ quantity: 2 }), E({ quantity: 1 })])
    expect(s.fullSeats).toBe(3)
    expect(s.spacesLeftFor('s1')).toBe(5)
  })

  it('drop-in quantities count against their own session only', () => {
    const s = classSessionSpaces(6, [
      E({ type: 'DROP_IN', dropInSessionId: 's1', quantity: 2 }),
      E({ type: 'DROP_IN', dropInSessionId: 's2', quantity: 1 }),
    ])
    expect(s.spacesLeftFor('s1')).toBe(4)
    expect(s.spacesLeftFor('s2')).toBe(5)
  })
})

describe('isOneOffEventPackage — what makes a run an event', () => {
  const event = { isGroup: true, allowDropIn: false, sessionCount: 1, recurrenceRule: null }

  it('recognises the one-off event shape', () => {
    expect(isOneOffEventPackage(event)).toBe(true)
  })

  it('a multi-session course is not an event', () => {
    expect(isOneOffEventPackage({ ...event, sessionCount: 6 })).toBe(false)
  })

  it('a repeating single-session class is not an event', () => {
    expect(isOneOffEventPackage({ ...event, recurrenceRule: 'FREQ=WEEKLY' })).toBe(false)
  })

  it('a drop-in class is not an event, nor is a 1:1 package', () => {
    expect(isOneOffEventPackage({ ...event, allowDropIn: true })).toBe(false)
    expect(isOneOffEventPackage({ ...event, isGroup: false })).toBe(false)
  })
})
