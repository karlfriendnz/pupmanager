import { describe, it, expect, vi, beforeEach } from 'vitest'

// The single most important correctness property of "cancel or move ONE week":
// the nightly top-up must not undo it.
//
// extendSlotRuns re-plans each slot's whole series from the slot's own rule and
// keeps what lands after that slot's LAST session. Two ways that puts a week
// back:
//
//   • The trainer CANCELS the last one. A hard delete moves the tail back and
//     the very next night re-creates the date. A cancellation keeps the row, so
//     the tail doesn't move — but the row must also make the date inert, in case
//     the tail moves for some other reason.
//   • The trainer MOVES one EARLIER. The tail really does move back, and the
//     rule still says a session belongs at the old time.
//
// These tests drive the real function with a mocked Prisma and assert on what it
// tries to write.

const h = vi.hoisted(() => ({
  groupBy: vi.fn(),
  sessionFindMany: vi.fn(),
  runFindMany: vi.fn(),
  count: vi.fn(),
  createMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: {
      groupBy: h.groupBy,
      findMany: h.sessionFindMany,
      count: h.count,
      createMany: h.createMany,
    },
    classRun: { findMany: h.runFindMany },
  },
}))

import { extendSlotRuns } from '@/lib/extend-slot-runs'

const NOW = new Date('2026-08-02T00:00:00.000Z')

/** A slot that meets every Tuesday at 6pm NZ, laid down for a 12-month horizon. */
const SLOT = {
  id: 'slot1', order: 0, startDate: new Date('2026-01-06T00:00:00.000Z'), day: 2,
  startTime: '18:00', endTime: '19:00', gapMins: 0,
  recurrenceRule: 'FREQ=WEEKLY', assignedMembershipIds: [] as string[],
  location: null,
}

const RUN = {
  id: 'run1',
  trainerId: 'co1',
  name: 'Tuesday drop-in',
  startDate: new Date('2026-01-06T00:00:00.000Z'),
  location: 'The hall',
  package: { sessionType: 'IN_PERSON', sessionSlots: [SLOT] },
  trainer: { user: { timezone: 'Pacific/Auckland' } },
}

/** The instants the run would be topped up with, given a tail well inside the
 *  refill window. Read straight off the createMany call. */
function written(): number[] {
  const call = h.createMany.mock.calls[0]
  if (!call) return []
  return (call[0].data as { scheduledAt: Date }[]).map(r => r.scheduledAt.getTime())
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.runFindMany.mockResolvedValue([RUN])
  h.count.mockResolvedValue(30)
  h.createMany.mockResolvedValue({ count: 0 })
  h.sessionFindMany.mockResolvedValue([])
})

/** Put the slot's tail here, which makes the run due for a refill. */
function tailAt(iso: string) {
  h.groupBy.mockResolvedValue([
    { classRunId: 'run1', packageSessionSlotId: 'slot1', _max: { scheduledAt: new Date(iso) } },
  ])
}

describe('extendSlotRuns and per-occurrence edits', () => {
  it('tops a due slot up as it always did when nothing has been touched', async () => {
    tailAt('2026-09-01T06:00:00.000Z')
    const res = await extendSlotRuns({ now: NOW })
    expect(res.sessionsCreated).toBeGreaterThan(0)
    // …and it only ever fills FORWARD from the tail.
    expect(Math.min(...written())).toBeGreaterThan(new Date('2026-09-01T06:00:00.000Z').getTime())
  })

  it('never re-creates the week the trainer MOVED, at the time they moved it from', async () => {
    tailAt('2026-09-01T06:00:00.000Z')
    // The generator would put a session at this exact instant; the trainer has
    // moved that week an hour later, and the row records where it came from.
    const planned = await plannedInstant()
    h.sessionFindMany.mockResolvedValue([
      {
        classRunId: 'run1', packageSessionSlotId: 'slot1',
        scheduledAt: new Date(planned + 3_600_000),
        cancelledAt: null,
        originalScheduledAt: new Date(planned),
      },
    ])

    await extendSlotRuns({ now: NOW })
    expect(written()).not.toContain(planned)
    // Everything else that slot owes still gets written — one moved week must
    // not stop the class being topped up.
    expect(written().length).toBeGreaterThan(0)
  })

  it('never re-creates a week the trainer CANCELLED', async () => {
    tailAt('2026-09-01T06:00:00.000Z')
    const planned = await plannedInstant()
    h.sessionFindMany.mockResolvedValue([
      {
        classRunId: 'run1', packageSessionSlotId: 'slot1',
        scheduledAt: new Date(planned),
        cancelledAt: new Date('2026-08-01T00:00:00.000Z'),
        originalScheduledAt: null,
      },
    ])

    await extendSlotRuns({ now: NOW })
    expect(written()).not.toContain(planned)
  })

  it('asks the database only for the occurrences that were actually touched', async () => {
    // A run with hundreds of sessions must not be read whole every night just
    // to find the two the trainer changed.
    tailAt('2026-09-01T06:00:00.000Z')
    await extendSlotRuns({ now: NOW })
    expect(h.sessionFindMany.mock.calls[0][0].where).toMatchObject({
      packageSessionSlotId: { not: null },
      OR: [{ cancelledAt: { not: null } }, { scheduleOverriddenAt: { not: null } }],
    })
  })

  it('keeps a tombstone scoped to its own slot', async () => {
    // A cancelled Tuesday says nothing about the Saturday slot, so the key is
    // (run, slot) and not (run).
    tailAt('2026-09-01T06:00:00.000Z')
    const planned = await plannedInstant()
    h.sessionFindMany.mockResolvedValue([
      {
        classRunId: 'run1', packageSessionSlotId: 'a-different-slot',
        scheduledAt: new Date(planned),
        cancelledAt: new Date('2026-08-01T00:00:00.000Z'),
        originalScheduledAt: null,
      },
    ])
    await extendSlotRuns({ now: NOW })
    expect(written()).toContain(planned)
  })
})

/** The first instant the planner would create past the tail, on a clean run. */
async function plannedInstant(): Promise<number> {
  h.createMany.mockClear()
  h.sessionFindMany.mockResolvedValue([])
  await extendSlotRuns({ now: NOW })
  const first = written()[0]
  h.createMany.mockClear()
  return first
}
