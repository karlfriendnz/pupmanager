import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Editing a group class from its offering form writes to the PACKAGE. The class
// itself is a ClassRun, and the run's own capacity OVERRIDES the package's
// wherever seats are counted (effectiveCapacity). syncOfferingRun carried the
// name, note, venue, cover, staff, status and schedule across — but never the
// capacity. So a trainer raising the cap from 6 to 8 saved successfully, saw
// the form come back showing 8, and the class went on turning people away at 6.
// "The Save button doesn't work."
const h = vi.hoisted(() => ({
  runFindMany: vi.fn(),
  runUpdate: vi.fn(),
  attendanceCount: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
  sessionCreateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { syncOfferingRun } from '@/lib/class-runs'

const PACKAGE = 'pkg_1'
const TRAINER = 'tr_1'
const RUN = 'run_1'

/** Just enough of a Prisma transaction client for syncOfferingRun. */
function tx() {
  return {
    classRun: { findMany: h.runFindMany, update: h.runUpdate },
    sessionAttendance: { count: h.attendanceCount },
    trainingSession: {
      findMany: h.sessionFindMany,
      update: h.sessionUpdate,
      updateMany: h.sessionUpdateMany,
      deleteMany: h.sessionDeleteMany,
      createMany: h.sessionCreateMany,
    },
    classRunTrainer: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn(async () => []) },
    trainerMembership: { findMany: vi.fn(async () => []) },
  } as never
}

const START = new Date('2026-08-04T18:00:00.000Z')

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.runFindMany.mockResolvedValue([{
    id: RUN,
    name: 'Puppy Foundations',
    location: 'The Hall',
    startDate: START,
    bufferMins: null,
    package: { sessionCount: 6, weeksBetween: 1, durationMins: 60, bufferMins: 0, sessionType: 'IN_PERSON' },
    sessions: [{ id: 's1', sessionIndex: 1, googleCalendarEventId: null, packageSessionSlotId: null }],
  }])
  h.attendanceCount.mockResolvedValue(0)
  h.runUpdate.mockResolvedValue({})
  h.sessionFindMany.mockResolvedValue([])
})

describe('syncOfferingRun — an offering edit has to reach the class it runs as', () => {
  it('writes a changed capacity onto the run, not just the package', async () => {
    await syncOfferingRun(tx(), PACKAGE, TRAINER, { capacity: 8 })

    expect(h.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN },
        data: expect.objectContaining({ capacity: 8 }),
      }),
    )
  })

  it('carries an explicit "no limit" across too', async () => {
    await syncOfferingRun(tx(), PACKAGE, TRAINER, { capacity: null })

    const data = h.runUpdate.mock.calls[0][0].data
    expect(data).toHaveProperty('capacity', null)
  })

  // Optional-means-leave-it-alone, the same rule the venue and cover follow —
  // an edit that says nothing about capacity must not clear the run's.
  it('leaves the run’s capacity alone when the edit doesn’t mention it', async () => {
    await syncOfferingRun(tx(), PACKAGE, TRAINER, { name: 'Puppy Foundations II' })

    const data = h.runUpdate.mock.calls[0][0].data
    expect(data).not.toHaveProperty('capacity')
  })

  // Changing the cap is not a schedule change — it must never rebuild the
  // series and wipe the sessions clients are already booked onto.
  it('does not rebuild the sessions just because the capacity moved', async () => {
    await syncOfferingRun(tx(), PACKAGE, TRAINER, { capacity: 8 })

    expect(h.sessionDeleteMany).not.toHaveBeenCalled()
    expect(h.sessionCreateMany).not.toHaveBeenCalled()
  })
})

const form = readFileSync('src/app/(trainer)/packages/package-form.tsx', 'utf8')
const route = readFileSync('src/app/api/packages/[packageId]/route.ts', 'utf8')

describe('the offering edit form — a refused save has to say so', () => {
  it('passes the capacity through to the run', () => {
    expect(route).toContain('capacity: columns.capacity')
  })

  // onInvalid used to name only specialPrice and name. Anything else the
  // resolver caught blocked the save with nothing on screen — which is what a
  // trainer reads as a dead Save button.
  it('surfaces whatever the resolver actually complained about', () => {
    expect(form).toContain('const any = Object.values(errs)')
    expect(form).toContain('Some of the details on this form need fixing')
  })

  // The payload silently DROPPED a new start date once attendance existed, so
  // the save came back fine and the date sprang back.
  it('explains a date change it can’t apply instead of dropping it', () => {
    expect(form).toContain('if (startMoved && hasAttendance)')
    expect(form).toContain('its dates are fixed')
  })
})
