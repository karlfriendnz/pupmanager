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
    expect(cell).toMatchObject({ booked: 2, capacity: 8, waitlist: 1 })
    expect(cell.attendees).toHaveLength(2) // the FULL + the drop-in dog
    expect(board.totalBooked).toBe(2)
  })

  // Every cell is a tap through to that day-part's own session screen, so the
  // ids have to survive the bucketing — including when two sessions share one
  // cell, where the FIRST one's ids are the ones the tap should use.
  it('carries the session the cell taps through to', async () => {
    const board = await getPuppySchoolWeek('t1', NOW)
    expect(board.cells['09:00']['2026-08-05']).toMatchObject({ runId: 'r1', sessionId: 's1' })
  })

  it('keeps the first session ids when two sessions share a cell', async () => {
    h.sessionFindMany.mockResolvedValue([
      { id: 'early', scheduledAt: SESSION_AT, classRunId: 'r1', packageSessionSlot: { capacity: 8, startTime: '09:00', endTime: '12:00' }, classRun: { capacity: null, package: { capacity: null } } },
      { id: 'later', scheduledAt: SESSION_AT, classRunId: 'r2', packageSessionSlot: { capacity: 8, startTime: '09:00', endTime: '12:00' }, classRun: { capacity: null, package: { capacity: null } } },
    ])
    h.enrollmentFindMany.mockResolvedValue([])

    const board = await getPuppySchoolWeek('t1', NOW)
    expect(board.cells['09:00-12:00']['2026-08-05']).toMatchObject({ runId: 'r1', sessionId: 'early', capacity: 16 })
  })

  it('ignores a drop-in whose session is not on the board', async () => {
    h.enrollmentFindMany.mockResolvedValue([
      { classRunId: 'r1', status: 'ENROLLED', type: 'DROP_IN', dropInSessionId: 'some-other-session' },
    ])
    const board = await getPuppySchoolWeek('t1', NOW)
    expect(board.cells['09:00']['2026-08-05'].booked).toBe(0)
  })

  // A daycare routinely runs a full day and a half day that OPEN AT THE SAME
  // MINUTE. Keying a row on the start time alone collapsed them into one row,
  // and the second session then overwrote the first — taking its bookings with
  // it. Found against a real daycare's data (7am–6pm and 7am–12pm).
  it('keeps two day-parts that start at the same time apart', async () => {
    h.sessionFindMany.mockResolvedValue([
      {
        id: 'full', scheduledAt: SESSION_AT, classRunId: 'r1',
        packageSessionSlot: { capacity: 20, startTime: '09:00', endTime: '18:00' },
        classRun: { capacity: null, package: { capacity: null } },
      },
      {
        id: 'half', scheduledAt: SESSION_AT, classRunId: 'r1',
        packageSessionSlot: { capacity: 10, startTime: '09:00', endTime: '12:00' },
        classRun: { capacity: null, package: { capacity: null } },
      },
    ])
    h.enrollmentFindMany.mockResolvedValue([
      { classRunId: 'r1', status: 'ENROLLED', type: 'DROP_IN', dropInSessionId: 'full' },
      { classRunId: 'r1', status: 'ENROLLED', type: 'DROP_IN', dropInSessionId: 'half' },
    ])

    const board = await getPuppySchoolWeek('t1', NOW)

    // Two rows, not one — and the shorter day sorts first.
    expect(board.parts.map(p => p.key)).toEqual(['09:00-12:00', '09:00-18:00'])
    expect(board.parts.map(p => p.label)).toEqual(['9:00 AM – 12:00 PM', '9:00 AM – 6:00 PM'])

    // Each keeps its own booking and its own capacity; neither erased the other.
    expect(board.cells['09:00-18:00']['2026-08-05']).toMatchObject({ booked: 1, capacity: 20 })
    expect(board.cells['09:00-12:00']['2026-08-05']).toMatchObject({ booked: 1, capacity: 10 })
    expect(board.totalBooked).toBe(2)
  })
})
