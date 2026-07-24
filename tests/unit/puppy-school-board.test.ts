import { describe, it, expect, vi, beforeEach } from 'vitest'

// The week board's occupancy maths: a FULL enrolment attends every session of
// its run; a drop-in only its one session; waitlisted are counted separately.
// tz is mocked to UTC so the week columns are deterministic.

const h = vi.hoisted(() => ({
  profileFindUnique: vi.fn(),
  sessionFindMany: vi.fn(),
  enrollmentFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.profileFindUnique },
    trainingSession: { findMany: h.sessionFindMany },
    classEnrollment: { findMany: h.enrollmentFindMany },
  },
}))

import { getPuppySchoolWeek } from '@/lib/puppy-school'

const NOW = new Date('2026-08-05T12:00:00.000Z') // a Wednesday
const SESSION_AT = new Date('2026-08-05T09:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  h.profileFindUnique.mockResolvedValue({ user: { timezone: 'UTC' } })
  h.sessionFindMany.mockResolvedValue([
    { id: 's1', scheduledAt: SESSION_AT, classRunId: 'r1', packageSessionSlot: { capacity: 8 }, classRun: { capacity: null, package: { capacity: null } } },
  ])
  h.enrollmentFindMany.mockResolvedValue([
    { classRunId: 'r1', status: 'ENROLLED', type: 'FULL', dropInSessionId: null },
    { classRunId: 'r1', status: 'ENROLLED', type: 'DROP_IN', dropInSessionId: 's1' },
    { classRunId: 'r1', status: 'WAITLISTED', type: 'FULL', dropInSessionId: null },
  ])
})

describe('getPuppySchoolWeek', () => {
  it('counts FULL + drop-in as booked, and waitlist separately', async () => {
    const board = await getPuppySchoolWeek('t1', NOW)

    expect(board.columns).toHaveLength(7)
    expect(board.columns[0].key).toBe('2026-08-03') // Monday of that week
    expect(board.parts.map(p => p.key)).toEqual(['09:00'])

    const cell = board.cells['09:00']['2026-08-05']
    expect(cell).toEqual({ booked: 2, capacity: 8, waitlist: 1 })
    expect(board.totalBooked).toBe(2)
  })

  it('ignores a drop-in whose session is not on the board', async () => {
    h.enrollmentFindMany.mockResolvedValue([
      { classRunId: 'r1', status: 'ENROLLED', type: 'DROP_IN', dropInSessionId: 'some-other-session' },
    ])
    const board = await getPuppySchoolWeek('t1', NOW)
    expect(board.cells['09:00']['2026-08-05'].booked).toBe(0)
  })
})
