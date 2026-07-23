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
  },
  trainerMembership: { findMany: h.membershipFindMany },
  classRunTrainer: { deleteMany: h.runTrainerDeleteMany, createMany: h.runTrainerCreateMany },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const RUN = { id: 'run-1', name: 'Puppy Class', location: 'The Park' }

beforeEach(() => {
  vi.clearAllMocks()
  h.runFindMany.mockResolvedValue([RUN])
  h.runUpdate.mockResolvedValue({})
  h.sessionFindMany.mockResolvedValue([])
  h.sessionUpdate.mockResolvedValue({})
  h.sessionUpdateMany.mockResolvedValue({ count: 0 })
  h.membershipFindMany.mockResolvedValue([])
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
    expect(res).toEqual({ id: 'run-1' })
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
