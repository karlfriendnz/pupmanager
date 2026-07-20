import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression coverage for the Google Calendar OUTBOUND sync wiring on the
// session-creating paths that used to skip it. These assert the LIB CONTRACT
// each route relies on: the session-creating helpers now surface the ids of the
// rows they created (and, for a class reschedule, the Google event ids of the
// rows they deleted) so the route can mirror exactly those to Google post-commit.
//
// The extend-ongoing test additionally asserts the lib itself fires
// syncSessionsToGoogle for ONLY the brand-new sessions it generates.

const h = vi.hoisted(() => ({
  // class-runs prisma surface
  packageFindFirst: vi.fn(),
  classRunFindFirst: vi.fn(),
  sessionAttendanceCount: vi.fn(),
  transaction: vi.fn(),
  // extend-ongoing prisma surface
  clientPackageFindMany: vi.fn(),
  sessionCreateMany: vi.fn(),
  sessionFindMany: vi.fn(),
  // the sync engine (dynamically imported by the libs)
  syncSessionsToGoogle: vi.fn(),
  deleteGoogleEvents: vi.fn(),
}))

vi.mock('@/generated/prisma', () => ({}))
vi.mock('@/lib/google-calendar-sync', () => ({
  syncSessionsToGoogle: h.syncSessionsToGoogle,
  deleteGoogleEvents: h.deleteGoogleEvents,
}))

beforeEach(() => {
  vi.clearAllMocks()
  h.syncSessionsToGoogle.mockResolvedValue(undefined)
  h.deleteGoogleEvents.mockResolvedValue(undefined)
})

// ─── class-runs.ts — createClassRun / createClassWithPackage / updateClass ─────
describe('class-runs helpers surface the created/deleted session ids', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function mockPrisma() {
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        package: { findFirst: h.packageFindFirst },
        classRun: { findFirst: h.classRunFindFirst },
        sessionAttendance: { count: h.sessionAttendanceCount },
        $transaction: h.transaction,
      },
    }))
  }

  it('createClassRun returns the ids of every session it created', async () => {
    mockPrisma()
    h.packageFindFirst.mockResolvedValue({
      id: 'pkg-1', sessionCount: 3, weeksBetween: 1, durationMins: 45,
      sessionType: 'IN_PERSON', bufferMins: 0,
    })
    const tx = {
      classRun: { create: vi.fn().mockResolvedValue({ id: 'run-1' }) },
      trainingSession: {
        createMany: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }, { id: 's3' }]),
      },
    }
    h.transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx))

    const { createClassRun } = await import('@/lib/class-runs')
    const res = await createClassRun({
      trainerId: 'co-1', packageId: 'pkg-1', name: 'Puppy', startDate: new Date('2026-08-01T09:00:00Z'),
    })

    expect(res.createdSessionIds).toEqual(['s1', 's2', 's3'])
    expect(tx.trainingSession.findMany).toHaveBeenCalledWith({ where: { classRunId: 'run-1' }, select: { id: true } })
  })

  it('createClassWithPackage returns the ids of every session it created', async () => {
    mockPrisma()
    const tx = {
      package: { create: vi.fn().mockResolvedValue({ id: 'pkg-x' }) },
      classRun: { create: vi.fn().mockResolvedValue({ id: 'run-2' }) },
      classRunTrainer: { deleteMany: vi.fn(), createMany: vi.fn() },
      trainerMembership: { findMany: vi.fn().mockResolvedValue([]) },
      trainingSession: {
        createMany: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
      },
    }
    h.transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx))

    const { createClassWithPackage } = await import('@/lib/class-runs')
    const res = await createClassWithPackage({
      trainerId: 'co-1', name: 'Group', startDate: new Date('2026-08-01T09:00:00Z'),
      sessionCount: 2, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON',
    })

    expect(res.createdSessionIds).toEqual(['a', 'b'])
  })

  it('updateClass on a reschedule returns rebuilt ids + the deleted events to remove', async () => {
    mockPrisma()
    h.classRunFindFirst.mockResolvedValue({
      id: 'run-3', packageId: 'pkg-3',
      startDate: new Date('2026-08-01T09:00:00Z'),
      bufferMins: null,
      package: { weeksBetween: 1, sessionCount: 2, bufferMins: 0 },
      // Old sessions: two carry a mirrored Google event id, one doesn't.
      sessions: [
        { id: 'old1', sessionIndex: 1, googleCalendarEventId: 'evt-old-1' },
        { id: 'old2', sessionIndex: 2, googleCalendarEventId: null },
        { id: 'old3', sessionIndex: 3, googleCalendarEventId: 'evt-old-3' },
      ],
    })
    h.sessionAttendanceCount.mockResolvedValue(0)
    const tx = {
      package: { update: vi.fn() },
      classRun: { update: vi.fn() },
      classRunTrainer: { deleteMany: vi.fn(), createMany: vi.fn() },
      trainerMembership: { findMany: vi.fn().mockResolvedValue([]) },
      trainingSession: {
        deleteMany: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ id: 'new1' }, { id: 'new2' }, { id: 'new3' }, { id: 'new4' }]),
        update: vi.fn(),
      },
    }
    h.transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx))

    const { updateClass } = await import('@/lib/class-runs')
    const res = await updateClass({
      runId: 'run-3', trainerId: 'co-1', name: 'Group', scheduleNote: null,
      capacity: null, priceCents: null, durationMins: 60, sessionType: 'IN_PERSON',
      // A different startDate → schedule rebuild.
      startDate: new Date('2026-09-01T09:00:00Z'), sessionCount: 4, weeksBetween: 1,
    })

    expect(res.scheduleChanged).toBe(true)
    expect(res.createdSessionIds).toEqual(['new1', 'new2', 'new3', 'new4'])
    // Only the old sessions that had a mirrored event get removed from Google.
    expect(res.deletedEventIds).toEqual(['evt-old-1', 'evt-old-3'])
  })

  it('updateClass with NO schedule change syncs nothing new and deletes nothing', async () => {
    mockPrisma()
    h.classRunFindFirst.mockResolvedValue({
      id: 'run-4', packageId: 'pkg-4',
      startDate: new Date('2026-08-01T09:00:00Z'),
      bufferMins: null,
      package: { weeksBetween: 1, sessionCount: 2, bufferMins: 0 },
      sessions: [
        { id: 'k1', sessionIndex: 1, googleCalendarEventId: 'evt-k1' },
        { id: 'k2', sessionIndex: 2, googleCalendarEventId: 'evt-k2' },
      ],
    })
    const tx = {
      package: { update: vi.fn() },
      classRun: { update: vi.fn() },
      classRunTrainer: { deleteMany: vi.fn(), createMany: vi.fn() },
      trainerMembership: { findMany: vi.fn().mockResolvedValue([]) },
      trainingSession: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    }
    h.transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx))

    const { updateClass } = await import('@/lib/class-runs')
    const res = await updateClass({
      runId: 'run-4', trainerId: 'co-1', name: 'Group', scheduleNote: null,
      capacity: null, priceCents: null, durationMins: 60, sessionType: 'IN_PERSON',
      // Same schedule (start/count/cadence identical to the run) → no rebuild.
      startDate: new Date('2026-08-01T09:00:00Z'), sessionCount: 2, weeksBetween: 1,
    })

    expect(res.scheduleChanged).toBe(false)
    expect(res.createdSessionIds).toEqual([])
    expect(res.deletedEventIds).toEqual([])
  })
})

// ─── booking-page.ts — materializeBooking ─────────────────────────────────────
describe('materializeBooking surfaces the created session ids', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({ prisma: {} }))
    vi.doMock('@/lib/self-book', () => ({
      createBookingAssignment: vi.fn().mockResolvedValue('cp-99'),
      generateSessionDates: (start: Date, count: number) =>
        Array.from({ length: count > 0 ? count : 1 }, (_, i) => new Date(start.getTime() + i * 1000)),
      sessionTitle: (name: string) => name,
    }))
  })

  it('package booking returns the clientPackage id AND its session ids', async () => {
    const tx = {
      trainingSession: { findMany: vi.fn().mockResolvedValue([{ id: 'ps1' }, { id: 'ps2' }]) },
    }
    const { materializeBooking } = await import('@/lib/booking-page')
    const res = await materializeBooking(tx as never, {
      trainerId: 'co-1', clientId: 'cp-1', dogId: null, slotAt: new Date('2026-08-01T09:00:00Z'),
      pkg: { id: 'pkg-1', name: 'Pkg', sessionCount: 2, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON' },
      singleDurationMins: 60, singleSessionType: 'IN_PERSON', singleTitle: 'x', bookingPageId: 'bp-1',
    })
    expect(res.clientPackageId).toBe('cp-99')
    expect(res.sessionIds).toEqual(['ps1', 'ps2'])
    expect(tx.trainingSession.findMany).toHaveBeenCalledWith({ where: { clientPackageId: 'cp-99' }, select: { id: true } })
  })

  it('single-session booking returns no clientPackage but the one session id', async () => {
    const tx = {
      trainingSession: { create: vi.fn().mockResolvedValue({ id: 'single-1' }) },
    }
    const { materializeBooking } = await import('@/lib/booking-page')
    const res = await materializeBooking(tx as never, {
      trainerId: 'co-1', clientId: 'cp-1', dogId: null, slotAt: new Date('2026-08-01T09:00:00Z'),
      pkg: null, singleDurationMins: 30, singleSessionType: 'VIRTUAL', singleTitle: 'One-off', bookingPageId: 'bp-1',
    })
    expect(res.clientPackageId).toBeNull()
    expect(res.sessionIds).toEqual(['single-1'])
  })
})

// ─── extend-ongoing-packages.ts — syncs ONLY the freshly-generated sessions ────
describe('extendOngoingPackages mirrors only the brand-new sessions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        clientPackage: { findMany: h.clientPackageFindMany },
        trainingSession: { createMany: h.sessionCreateMany, findMany: h.sessionFindMany },
      },
    }))
  })

  it('syncs the top-up sessions it created this call', async () => {
    // One ongoing assignment whose last session is well before the 6-week
    // horizon → it will be topped up.
    h.clientPackageFindMany.mockResolvedValue([
      {
        id: 'cp-ongoing',
        package: { weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', name: 'Weekly' },
        sessions: [{
          id: 'anchor', scheduledAt: new Date(), dogId: 'd1', clientId: 'cl1',
          assignedMembershipId: 'm1', bufferMins: 0,
        }],
      },
    ])
    h.sessionCreateMany.mockResolvedValue({})
    h.sessionFindMany.mockResolvedValue([{ id: 'gen-1' }, { id: 'gen-2' }])

    const { extendOngoingPackages } = await import('@/lib/extend-ongoing-packages')
    await extendOngoingPackages('co-1')

    expect(h.sessionCreateMany).toHaveBeenCalled()
    expect(h.syncSessionsToGoogle).toHaveBeenCalledWith(['gen-1', 'gen-2'])
  })

  it('never touches Google when there is nothing to top up', async () => {
    // Last session already beyond the horizon → no new rows, no sync.
    const far = new Date()
    far.setDate(far.getDate() + 365)
    h.clientPackageFindMany.mockResolvedValue([
      {
        id: 'cp-ongoing',
        package: { weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', name: 'Weekly' },
        sessions: [{ id: 'anchor', scheduledAt: far, dogId: 'd1', clientId: 'cl1', assignedMembershipId: 'm1', bufferMins: 0 }],
      },
    ])

    const { extendOngoingPackages } = await import('@/lib/extend-ongoing-packages')
    await extendOngoingPackages('co-1')

    expect(h.sessionCreateMany).not.toHaveBeenCalled()
    expect(h.syncSessionsToGoogle).not.toHaveBeenCalled()
  })
})
