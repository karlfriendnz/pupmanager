import { describe, it, expect, vi, beforeEach } from 'vitest'

// Where an offering meets.
//
// The venue used to live ONLY on the ClassRun. That is right for a class that
// is scheduled — a cohort can move, and each session snapshots the address —
// but an offering can be defined before it has a run, and the routes only ever
// passed `location` on to `createClassRunIn` / `syncOfferingRun`. So:
//
//   • defining a group offering with no start date accepted the address and
//     wrote it nowhere;
//   • editing an offering with no run (or with several cohorts, where
//     syncOfferingRun deliberately no-ops) did the same.
//
// Both saved 200 and lost the input. `Package.location` is now the offering's
// own default: always stored, and inherited by a run created later. These tests
// pin the two halves — the venue is never dropped, and inheritance is
// create-time only so an existing cohort's venue is never rewritten.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  pkgFindFirst: vi.fn(),
  pkgFindUnique: vi.fn(),
  pkgUpdate: vi.fn(),
  pkgCreate: vi.fn(),
  pkgAggregate: vi.fn(),
  classRunCount: vi.fn(),
  classRunFindMany: vi.fn(),
  classRunCreate: vi.fn(),
  classRunUpdate: vi.fn(),
  clientPackageCount: vi.fn(),
  sessionCreateMany: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
  attendanceCount: vi.fn(),
  membershipFindMany: vi.fn(),
  runTrainerDeleteMany: vi.fn(),
  runTrainerCreateMany: vi.fn(),
  // The create route resolves the trainer's own timezone, so "show from
  // 1 December" is stored as the instant that day begins where they live.
  trainerProfileFindUnique: vi.fn(() => Promise.resolve({ user: { timezone: 'Pacific/Auckland' } })),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
// Mirroring to Google Calendar is a post-commit side effect and has its own
// tests; stubbing it keeps this file about the venue.
vi.mock('@/lib/class-session-sync', () => ({
  syncClassSessions: vi.fn(), removeClassEvents: vi.fn(),
}))
vi.mock('@/lib/prisma', () => {
  const tx = {
    package: {
      findFirst: h.pkgFindFirst,
      findUnique: h.pkgFindUnique,
      update: h.pkgUpdate,
      create: h.pkgCreate,
      aggregate: h.pkgAggregate,
    },
    classRun: {
      count: h.classRunCount,
      findMany: h.classRunFindMany,
      create: h.classRunCreate,
      update: h.classRunUpdate,
    },
    classRunTrainer: { deleteMany: h.runTrainerDeleteMany, createMany: h.runTrainerCreateMany },
    trainerMembership: { findMany: h.membershipFindMany },
    clientPackage: { count: h.clientPackageCount },
    trainingSession: {
      createMany: h.sessionCreateMany,
      findMany: h.sessionFindMany,
      updateMany: h.sessionUpdateMany,
      deleteMany: h.sessionDeleteMany,
    },
    sessionAttendance: { count: h.attendanceCount },
    trainerProfile: { findUnique: h.trainerProfileFindUnique },
  }
  return { prisma: { ...tx, $transaction: (fn: (c: typeof tx) => unknown) => fn(tx) } }
})

import { PATCH } from '@/app/api/packages/[packageId]/route'
import { POST } from '@/app/api/packages/route'
import { createClassRunIn, syncOfferingRun } from '@/lib/class-runs'

const VENUE = '12 Hall Road, Riverhead'
const OTHER_VENUE = 'The field behind the hall'

const patch = (body: unknown) =>
  PATCH(new Request('http://localhost/api/packages/pkg_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ packageId: 'pkg_1' }) })

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

const NEW_CLASS = {
  name: 'Puppy Foundations',
  sessionCount: 6,
  weeksBetween: 1,
  durationMins: 60,
  isGroup: true,
}

// The stored group package createClassRunIn reads to plan the series.
function storedPackage(over: Record<string, unknown> = {}) {
  return {
    id: 'pkg_1', trainerId: 'tr_me', isGroup: true,
    name: 'Puppy Foundations', sessionCount: 2, weeksBetween: 1,
    durationMins: 60, bufferMins: 0, sessionType: 'IN_PERSON' as const,
    location: null as string | null,
    sessionSlots: [],
    trainer: { user: { timezone: 'Pacific/Auckland' } },
    priceCents: null, specialPriceCents: null, imageUrl: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue(undefined)
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u', trainerId: 'tr_me' } })
  h.pkgFindFirst.mockResolvedValue(storedPackage())
  h.pkgFindUnique.mockResolvedValue({ isGroup: true })
  h.pkgAggregate.mockResolvedValue({ _max: { order: 0 } })
  h.pkgCreate.mockImplementation(async ({ data }) => ({ id: 'pkg_new', ...data }))
  h.pkgUpdate.mockImplementation(async ({ data }) => ({ id: 'pkg_1', isGroup: true, ...data }))
  h.classRunCount.mockResolvedValue(0)
  h.classRunFindMany.mockResolvedValue([])
  h.classRunCreate.mockImplementation(async ({ data }) => ({ id: 'run_new', ...data }))
  h.classRunUpdate.mockResolvedValue({ id: 'run_1' })
  h.clientPackageCount.mockResolvedValue(0)
  h.trainerProfileFindUnique.mockResolvedValue({ user: { timezone: 'Pacific/Auckland' } })
  h.sessionCreateMany.mockResolvedValue({ count: 0 })
  h.sessionFindMany.mockResolvedValue([{ id: 'sess_1' }])
  h.sessionUpdateMany.mockResolvedValue({ count: 0 })
  h.sessionDeleteMany.mockResolvedValue({ count: 0 })
  h.attendanceCount.mockResolvedValue(0)
  h.membershipFindMany.mockResolvedValue([])
})

const created = () => h.pkgCreate.mock.calls[0][0].data
const updated = () => h.pkgUpdate.mock.calls[0][0].data

describe('a venue typed into the offering form is never silently dropped', () => {
  // The headline bug: no start date means no run, and the run was the only
  // place the address had to live.
  it('stores it on an offering created WITHOUT a start date', async () => {
    const res = await post({ ...NEW_CLASS, location: VENUE })
    expect(res.status).toBe(201)
    expect(created().location).toBe(VENUE)
    // …and nothing was scheduled, so there is no run to have caught it.
    expect(h.classRunCreate).not.toHaveBeenCalled()
  })

  it('stores it on the offering AND the run when a start date schedules it', async () => {
    await post({ ...NEW_CLASS, location: VENUE, startAt: '2026-08-04T18:00:00.000Z' })
    expect(created().location).toBe(VENUE)
    expect(h.classRunCreate.mock.calls[0][0].data.location).toBe(VENUE)
  })

  // A 1:1 package has no runs at all, so it had the same hole.
  it('stores it on a 1:1 offering', async () => {
    await post({ ...NEW_CLASS, isGroup: false, location: VENUE })
    expect(created().location).toBe(VENUE)
  })

  it('trims it, and reads whitespace-only as no venue', async () => {
    await post({ ...NEW_CLASS, location: `  ${VENUE}  ` })
    expect(created().location).toBe(VENUE)
    vi.clearAllMocks()
    h.pkgCreate.mockImplementation(async ({ data }) => ({ id: 'pkg_new', ...data }))
    h.pkgAggregate.mockResolvedValue({ _max: { order: 0 } })
    h.guardPermission.mockResolvedValue(undefined)
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u', trainerId: 'tr_me' } })
    await post({ ...NEW_CLASS, location: '   ' })
    expect(created().location).toBeNull()
  })

  it('stores it on edit when the offering has no run', async () => {
    h.classRunFindMany.mockResolvedValue([]) // never scheduled
    const res = await patch({ location: VENUE })
    expect(res.status).toBe(200)
    expect(updated().location).toBe(VENUE)
  })

  // syncOfferingRun deliberately no-ops on a multi-cohort offering (the form
  // can't say which cohort you meant), which used to mean the edit lost the
  // venue entirely. Now it lands on the offering, where the NEXT cohort gets it.
  it('stores it on edit when the offering has several cohorts', async () => {
    h.classRunFindMany.mockResolvedValue([{ id: 'run_1' }, { id: 'run_2' }])
    await patch({ location: OTHER_VENUE })
    expect(updated().location).toBe(OTHER_VENUE)
    // …and neither existing cohort was touched.
    expect(h.classRunUpdate).not.toHaveBeenCalled()
  })

  it('leaves the stored venue alone when the patch never mentions it', async () => {
    await patch({ name: 'Renamed' })
    expect(updated()).not.toHaveProperty('location')
  })

  it('clears it when the caller explicitly sends null', async () => {
    await patch({ location: null })
    expect(updated().location).toBeNull()
  })
})

describe('a run created later inherits the offering venue', () => {
  const tx = () => ({
    package: { findFirst: h.pkgFindFirst },
    classRun: { create: h.classRunCreate },
    classRunTrainer: { deleteMany: h.runTrainerDeleteMany, createMany: h.runTrainerCreateMany },
    trainerMembership: { findMany: h.membershipFindMany },
    trainingSession: { createMany: h.sessionCreateMany, findMany: h.sessionFindMany },
  })

  const runArgs = {
    trainerId: 'tr_me', packageId: 'pkg_1', name: 'Puppy Foundations',
    startDate: new Date('2026-08-04T06:00:00.000Z'),
  }

  it('uses the offering venue when the run names none', async () => {
    h.pkgFindFirst.mockResolvedValue(storedPackage({ location: VENUE }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createClassRunIn(tx() as any, runArgs)
    expect(h.classRunCreate.mock.calls[0][0].data.location).toBe(VENUE)
    // Every generated session carries it too — that's what a client is told.
    for (const row of h.sessionCreateMany.mock.calls[0][0].data) {
      expect(row.location).toBe(VENUE)
    }
  })

  it('lets the run name its own venue instead', async () => {
    h.pkgFindFirst.mockResolvedValue(storedPackage({ location: VENUE }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createClassRunIn(tx() as any, { ...runArgs, location: OTHER_VENUE })
    expect(h.classRunCreate.mock.calls[0][0].data.location).toBe(OTHER_VENUE)
  })

  it('is still null when neither has one', async () => {
    h.pkgFindFirst.mockResolvedValue(storedPackage({ location: null }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createClassRunIn(tx() as any, runArgs)
    expect(h.classRunCreate.mock.calls[0][0].data.location).toBeNull()
  })
})

describe('inheritance never rewrites a cohort that already exists', () => {
  // syncOfferingRun is the ONLY thing that writes an existing run's venue, and
  // only for a single-run offering, which is the case the form describes as
  // "this offering is that class". Two cohorts and it stands well back.
  it('leaves both cohorts alone when there are two', async () => {
    h.classRunFindMany.mockResolvedValue([
      { id: 'run_1', location: VENUE }, { id: 'run_2', location: OTHER_VENUE },
    ])
    const res = await syncOfferingRun(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { classRun: { findMany: h.classRunFindMany, update: h.classRunUpdate } } as any,
      'pkg_1', 'tr_me', { location: 'Somewhere else entirely' },
    )
    expect(res).toBeNull()
    expect(h.classRunUpdate).not.toHaveBeenCalled()
  })

  // Sessions already in the past keep the address they were actually held at.
  it('moves only the sessions still to come on the one cohort it does sync', async () => {
    h.classRunFindMany.mockResolvedValue([{
      id: 'run_1', name: 'Puppy Foundations', location: VENUE,
      startDate: new Date('2026-08-04T06:00:00.000Z'), bufferMins: null,
      package: { sessionCount: 2, weeksBetween: 1, durationMins: 60, bufferMins: 0, sessionType: 'IN_PERSON' },
      sessions: [{ id: 's1', sessionIndex: 1, googleCalendarEventId: null, packageSessionSlotId: null }],
    }])
    await syncOfferingRun(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        classRun: { findMany: h.classRunFindMany, update: h.classRunUpdate },
        trainingSession: { updateMany: h.sessionUpdateMany, findMany: h.sessionFindMany },
        sessionAttendance: { count: h.attendanceCount },
      } as any,
      'pkg_1', 'tr_me', { location: OTHER_VENUE },
    )
    expect(h.classRunUpdate.mock.calls[0][0].data.location).toBe(OTHER_VENUE)
    const where = h.sessionUpdateMany.mock.calls[0][0].where
    expect(where.classRunId).toBe('run_1')
    expect(where.scheduledAt.gte).toBeInstanceOf(Date)
  })
})
