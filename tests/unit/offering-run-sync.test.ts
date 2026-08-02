import { describe, it, expect, vi, beforeEach } from 'vitest'

// Editing an offering has to move the class it was scheduled as — otherwise the
// venue a trainer sees on the offering and the venue their clients are told
// differ, silently. But it must NOT touch a package that's running several
// cohorts (the form can't say which one you meant), and it must not rewrite
// history or override a drop-in slot's own venue.

const h = vi.hoisted(() => ({
  runFindMany: vi.fn(),
  runUpdate: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  membershipFindMany: vi.fn(),
  attendanceCount: vi.fn(),
  sessionDeleteMany: vi.fn(),
  sessionCreateMany: vi.fn(),
  runTrainerDeleteMany: vi.fn(),
  runTrainerCreateMany: vi.fn(),
}))

vi.mock('../../src/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/generated/prisma', () => ({}))

import { syncOfferingRun } from '../../src/lib/class-runs'

const tx = {
  classRun: { findMany: h.runFindMany, update: h.runUpdate },
  trainingSession: {
    findMany: h.sessionFindMany,
    update: h.sessionUpdate,
    updateMany: h.sessionUpdateMany,
    deleteMany: h.sessionDeleteMany,
    createMany: h.sessionCreateMany,
  },
  sessionAttendance: { count: h.attendanceCount },
  trainerMembership: { findMany: h.membershipFindMany },
  classRunTrainer: { deleteMany: h.runTrainerDeleteMany, createMany: h.runTrainerCreateMany },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const PKG = { sessionCount: 6, weeksBetween: 1, durationMins: 60, bufferMins: 0, sessionType: 'IN_PERSON' as const }
const RUN = {
  id: 'run-1',
  name: 'Puppy Class',
  location: 'The Park',
  startDate: new Date('2026-08-04T05:00:00.000Z'),
  bufferMins: null,
  package: PKG,
  // No packageSessionSlotId → an ordinary cadence-scheduled class.
  sessions: [
    { id: 's1', sessionIndex: 1, googleCalendarEventId: 'evt-1', packageSessionSlotId: null },
    { id: 's2', sessionIndex: 2, googleCalendarEventId: null, packageSessionSlotId: null },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.runFindMany.mockResolvedValue([RUN])
  h.runUpdate.mockResolvedValue({})
  h.sessionFindMany.mockResolvedValue([])
  h.sessionUpdate.mockResolvedValue({})
  h.sessionUpdateMany.mockResolvedValue({ count: 0 })
  h.membershipFindMany.mockResolvedValue([])
  h.attendanceCount.mockResolvedValue(0)
  h.sessionDeleteMany.mockResolvedValue({ count: 0 })
  h.sessionCreateMany.mockResolvedValue({})
})

describe('syncOfferingRun', () => {
  it('does nothing when the package runs several cohorts', async () => {
    // Spring and autumn intakes: changing the offering's venue must not silently
    // move both. Those are edited per-run on /classes/[runId].
    h.runFindMany.mockResolvedValue([RUN, { id: 'run-2', name: 'Puppy Class', location: 'The Hall' }])
    expect(await syncOfferingRun(tx, 'pkg1', 'tr1', { location: 'Somewhere else' })).toBeNull()
    expect(h.runUpdate).not.toHaveBeenCalled()
    expect(h.sessionUpdateMany).not.toHaveBeenCalled()
  })

  it('does nothing when the offering was never scheduled', async () => {
    h.runFindMany.mockResolvedValue([])
    expect(await syncOfferingRun(tx, 'pkg1', 'tr1', { location: 'The Park' })).toBeNull()
    expect(h.runUpdate).not.toHaveBeenCalled()
  })

  it('scopes the run lookup to the owning trainer', async () => {
    await syncOfferingRun(tx, 'pkg1', 'tr1', { location: 'X' })
    expect(h.runFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { packageId: 'pkg1', trainerId: 'tr1' } }),
    )
  })

  it('moves the venue onto the run and its UPCOMING sessions only', async () => {
    const res = await syncOfferingRun(tx, 'pkg1', 'tr1', { location: 'The New Field' })
    expect(res?.id).toBe('run-1')
    expect(h.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run-1' }, data: expect.objectContaining({ location: 'The New Field' }) }),
    )
    const where = h.sessionUpdateMany.mock.calls[0][0].where
    expect(where.classRunId).toBe('run-1')
    // Sessions that have happened keep the address they were held at…
    expect(where.scheduledAt.gte).toBeInstanceOf(Date)
    // …and a drop-in slot's sessions keep the venue their slot named.
    expect(where.packageSessionSlotId).toBeNull()
  })

  it('leaves sessions alone when the venue did not change', async () => {
    await syncOfferingRun(tx, 'pkg1', 'tr1', { location: 'The Park', scheduleNote: 'Tuesdays' })
    expect(h.sessionUpdateMany).not.toHaveBeenCalled()
    expect(h.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scheduleNote: 'Tuesdays' }) }),
    )
  })

  it('treats a blank venue as clearing it', async () => {
    await syncOfferingRun(tx, 'pkg1', 'tr1', { location: '   ' })
    expect(h.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ location: null }) }),
    )
    expect(h.sessionUpdateMany).toHaveBeenCalled()
  })

  it('renaming the offering renames the class and renumbers its session titles', async () => {
    h.sessionFindMany.mockResolvedValue([
      { id: 's1', sessionIndex: 1 },
      { id: 's2', sessionIndex: 2 },
    ])
    await syncOfferingRun(tx, 'pkg1', 'tr1', { name: 'Puppy Foundations' })
    expect(h.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Puppy Foundations' }) }),
    )
    expect(h.sessionUpdate.mock.calls.map(c => c[0].data.title)).toEqual([
      'Puppy Foundations — session 1/2',
      'Puppy Foundations — session 2/2',
    ])
  })

  it('a one-session class gets a bare title, not "session 1/1"', async () => {
    h.sessionFindMany.mockResolvedValue([{ id: 's1', sessionIndex: 1 }])
    await syncOfferingRun(tx, 'pkg1', 'tr1', { name: 'Recall Workshop' })
    expect(h.sessionUpdate.mock.calls[0][0].data.title).toBe('Recall Workshop')
  })

  it('does not rewrite titles when the name is unchanged', async () => {
    await syncOfferingRun(tx, 'pkg1', 'tr1', { name: 'Puppy Class', location: 'The Park' })
    expect(h.sessionUpdate).not.toHaveBeenCalled()
    expect(h.sessionFindMany).not.toHaveBeenCalled()
  })

  it('replaces the assigned staff, dropping anyone outside the company', async () => {
    h.membershipFindMany.mockResolvedValue([{ id: 'ours' }])
    await syncOfferingRun(tx, 'pkg1', 'tr1', { assignedMembershipIds: ['ours', 'theirs'] })
    expect(h.membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'tr1' }) }),
    )
    expect(h.runTrainerCreateMany).toHaveBeenCalledWith({
      data: [{ classRunId: 'run-1', membershipId: 'ours' }],
    })
  })

  it('leaves staff untouched when the field is not sent', async () => {
    await syncOfferingRun(tx, 'pkg1', 'tr1', { location: 'X' })
    expect(h.runTrainerDeleteMany).not.toHaveBeenCalled()
  })
})

describe('syncOfferingRun — rescheduling', () => {
  const NEW_START = new Date('2026-09-01T05:00:00.000Z')

  it('rebuilds the series when the start date moves', async () => {
    const res = await syncOfferingRun(tx, 'pkg1', 'tr1', { startDate: NEW_START, sessionCount: 6, weeksBetween: 1 })
    expect(h.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ startDate: NEW_START }) }),
    )
    expect(h.sessionDeleteMany).toHaveBeenCalledWith({ where: { classRunId: 'run-1' } })
    const rows = h.sessionCreateMany.mock.calls[0][0].data
    expect(rows).toHaveLength(6)
    expect(rows[0].scheduledAt).toEqual(NEW_START)
    // A week apart, and titled off the class name.
    expect(rows[1].scheduledAt.getTime() - rows[0].scheduledAt.getTime()).toBe(7 * 864e5)
    expect(rows[0].title).toBe('Puppy Class — session 1/6')
    // The old mirrored events come back so the caller can clear the calendar.
    expect(res?.deletedEventIds).toEqual(['evt-1'])
  })

  it('rebuilds when only the number of sessions changes', async () => {
    await syncOfferingRun(tx, 'pkg1', 'tr1', { sessionCount: 8 })
    expect(h.sessionCreateMany.mock.calls[0][0].data).toHaveLength(8)
  })

  it('rebuilds when only the spacing changes', async () => {
    await syncOfferingRun(tx, 'pkg1', 'tr1', { weeksBetween: 2 })
    const rows = h.sessionCreateMany.mock.calls[0][0].data
    expect(rows[1].scheduledAt.getTime() - rows[0].scheduledAt.getTime()).toBe(14 * 864e5)
  })

  it('leaves the series alone when the schedule is unchanged', async () => {
    await syncOfferingRun(tx, 'pkg1', 'tr1', {
      startDate: RUN.startDate, sessionCount: 6, weeksBetween: 1, location: 'The New Field',
    })
    expect(h.sessionDeleteMany).not.toHaveBeenCalled()
    expect(h.sessionCreateMany).not.toHaveBeenCalled()
    // …but the venue change still lands.
    expect(h.sessionUpdateMany).toHaveBeenCalled()
  })

  it('REFUSES to move a class that has attendance recorded', async () => {
    // The rebuild deletes the old series, which would take the register with it.
    h.attendanceCount.mockResolvedValue(3)
    await expect(
      syncOfferingRun(tx, 'pkg1', 'tr1', { startDate: NEW_START }),
    ).rejects.toMatchObject({ code: 'HAS_ATTENDANCE' })
    expect(h.sessionDeleteMany).not.toHaveBeenCalled()
    expect(h.runUpdate).not.toHaveBeenCalled()
  })

  it('REFUSES to move a class whose individual weeks were cancelled or moved', async () => {
    // The single most important correctness property of per-occurrence edits:
    // the rebuild is a deleteMany + createMany, so letting it run would put the
    // public holiday back and undo the moved week — silently, on a save the
    // trainer thought was about the session count.
    for (const touched of [
      { cancelledAt: new Date('2026-08-01T00:00:00.000Z'), scheduleOverriddenAt: null },
      { cancelledAt: null, scheduleOverriddenAt: new Date('2026-08-01T00:00:00.000Z') },
    ]) {
      vi.clearAllMocks()
      h.attendanceCount.mockResolvedValue(0)
      h.membershipFindMany.mockResolvedValue([])
      h.runFindMany.mockResolvedValue([{
        ...RUN,
        sessions: [
          { id: 's1', sessionIndex: 1, googleCalendarEventId: null, packageSessionSlotId: null, cancelledAt: null, scheduleOverriddenAt: null },
          { id: 's2', sessionIndex: 2, googleCalendarEventId: null, packageSessionSlotId: null, ...touched },
        ],
      }])
      await expect(
        syncOfferingRun(tx, 'pkg1', 'tr1', { startDate: NEW_START }),
      ).rejects.toMatchObject({ code: 'HAS_OVERRIDES' })
      expect(h.sessionDeleteMany).not.toHaveBeenCalled()
      expect(h.runUpdate).not.toHaveBeenCalled()
    }
  })

  it('leaves a HAND-SET venue alone when the offering\'s venue changes', async () => {
    // "This week only, we're at the scout hall" is not something a later save of
    // the class's default venue gets to quietly undo.
    await syncOfferingRun(tx, 'pkg1', 'tr1', { location: 'The New Field' })
    expect(h.sessionUpdateMany.mock.calls[0][0].where).toMatchObject({
      classRunId: RUN.id,
      packageSessionSlotId: null,
      scheduleOverriddenAt: null,
    })
  })

  it('never rebuilds a drop-in class — its series comes from its slots', async () => {
    h.runFindMany.mockResolvedValue([{
      ...RUN,
      sessions: [{ id: 's1', sessionIndex: 1, googleCalendarEventId: null, packageSessionSlotId: 'slot-1' }],
    }])
    await syncOfferingRun(tx, 'pkg1', 'tr1', { startDate: NEW_START, sessionCount: 12 })
    expect(h.sessionDeleteMany).not.toHaveBeenCalled()
    expect(h.sessionCreateMany).not.toHaveBeenCalled()
  })

  it('a rebuild writes the new venue onto the fresh sessions, not twice', async () => {
    await syncOfferingRun(tx, 'pkg1', 'tr1', { startDate: NEW_START, location: 'The New Field' })
    expect(h.sessionCreateMany.mock.calls[0][0].data[0].location).toBe('The New Field')
    // The separate "move upcoming sessions" pass would be redundant here.
    expect(h.sessionUpdateMany).not.toHaveBeenCalled()
  })
})
