import { describe, it, expect, vi, beforeEach } from 'vitest'

// Adding a day-part to a daycare that ALREADY EXISTS generated no sessions.
//
// A daycare's series is only ever laid down by createClassRunIn, at creation.
// syncOfferingRun deliberately refuses to touch a slot-scheduled run's dates,
// and the nightly top-up fills FORWARD from each slot's last session — so a slot
// with no last session was skipped outright. The trainer added "Afternoon", saw
// it in the setup table, and found nothing on the board or the week view. Only
// the day-parts present on the day the daycare was created ever got sessions.
//
// The fix is in the generator, not at the one call site that adds a day-part —
// generating a slot's series at exactly one call site is what caused this.
//
// Two properties are asserted here and neither may ever be traded for the other:
//   1. a day-part added today gets its year of sessions, starting today;
//   2. no pass may resurrect a date the trainer cancelled or revert one they
//      moved — the property commit 59a02f8 exists for.

const h = vi.hoisted(() => ({
  groupBy: vi.fn(),
  runFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
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

const TZ = 'Pacific/Auckland'
const NOW = new Date('2026-08-03T02:00:00.000Z') // Monday 2pm in Auckland
const RUN_CREATED = new Date('2026-01-05T00:00:00.000Z')

/** The Monday morning part the daycare was created with. */
const MORNING = {
  id: 'morning', order: 0, startDate: RUN_CREATED, day: 1,
  startTime: '07:30', endTime: '12:30', gapMins: 0,
  recurrenceRule: 'FREQ=WEEKLY', assignedMembershipIds: [] as string[],
  location: null,
  createdAt: RUN_CREATED,
}

/** The Wednesday afternoon part the trainer added this morning. Its startDate
 *  is the run's, because the editor copies it — that is exactly the trap: it
 *  says "January", months before this part existed. */
const AFTERNOON = {
  ...MORNING,
  id: 'afternoon', order: 1, day: 3, startTime: '12:30', endTime: '17:30',
  createdAt: new Date('2026-08-03T01:00:00.000Z'),
}

const RUN = {
  id: 'run1',
  trainerId: 'co1',
  name: 'Waggy Tails Daycare',
  startDate: RUN_CREATED,
  createdAt: RUN_CREATED,
  location: 'The barn',
  package: { sessionType: 'IN_PERSON', sessionSlots: [MORNING, AFTERNOON] },
  trainer: { user: { timezone: TZ } },
}

/** What the pass tried to write, as (slotId, instant) pairs. */
function written(): { slot: string; at: Date }[] {
  return h.createMany.mock.calls.flatMap(c =>
    (c[0].data as { packageSessionSlotId: string; scheduledAt: Date }[])
      .map(r => ({ slot: r.packageSessionSlotId, at: r.scheduledAt })),
  )
}

function forSlot(id: string): Date[] {
  return written().filter(r => r.slot === id).map(r => r.at)
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.runFindMany.mockResolvedValue([RUN])
  h.sessionFindMany.mockResolvedValue([])
  h.count.mockResolvedValue(300)
  h.createMany.mockResolvedValue({ count: 0 })
  // The morning part is stocked to the horizon; the afternoon part has nothing
  // at all, which is the whole bug.
  h.groupBy.mockResolvedValue([
    { classRunId: 'run1', packageSessionSlotId: 'morning', _max: { scheduledAt: new Date('2027-07-26T19:30:00.000Z') } },
  ])
})

describe('a day-part added to a daycare that already exists', () => {
  it('gets its sessions — the bug was that it got none', async () => {
    const res = await extendSlotRuns({ now: NOW })
    expect(res.sessionsCreated).toBeGreaterThan(0)
    expect(forSlot('afternoon').length).toBeGreaterThan(0)
  })

  it('gets a full YEAR of them, so a parent can book the new part a year out', async () => {
    await extendSlotRuns({ now: NOW })
    const dates = forSlot('afternoon')
    // 12 months of Wednesdays.
    expect(dates.length).toBeGreaterThan(50)
    expect(dates.length).toBeLessThan(54)
  })

  it('fills FORWARD only — never into weeks that have already happened', async () => {
    // Filling the horizon the rest of the run covers would write months of
    // sessions into the trainer's past: a board showing an afternoon nobody
    // ran, and a register with no attendance against it, forever.
    await extendSlotRuns({ now: NOW })
    const earliest = forSlot('afternoon').reduce((a, b) => (a < b ? a : b))
    expect(earliest.getTime()).toBeGreaterThan(NOW.getTime())
    // The first one is THIS week's Wednesday, not next month's — the hole in
    // front of the trainer is as small as honesty allows.
    expect(earliest.toISOString()).toBe('2026-08-05T00:30:00.000Z')
  })

  it('leaves the day-part that was already stocked completely alone', async () => {
    await extendSlotRuns({ now: NOW })
    expect(forSlot('morning')).toEqual([])
  })

  it('is a no-op on the next pass — the new part now has a tail of its own', async () => {
    // The afternoon reports a full horizon this time round.
    h.groupBy.mockResolvedValue([
      { classRunId: 'run1', packageSessionSlotId: 'morning', _max: { scheduledAt: new Date('2027-07-26T19:30:00.000Z') } },
      { classRunId: 'run1', packageSessionSlotId: 'afternoon', _max: { scheduledAt: new Date('2027-07-28T00:30:00.000Z') } },
    ])
    const res = await extendSlotRuns({ now: NOW })
    expect(res).toEqual({ runsExtended: 0, sessionsCreated: 0, truncated: false })
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('starts a part the trainer post-dated on the date they chose, not today', async () => {
    const march = new Date('2027-03-01T00:00:00.000Z')
    h.runFindMany.mockResolvedValue([
      { ...RUN, package: { ...RUN.package, sessionSlots: [MORNING, { ...AFTERNOON, startDate: march }] } },
    ])
    await extendSlotRuns({ now: NOW })
    const earliest = forSlot('afternoon').reduce((a, b) => (a < b ? a : b))
    expect(earliest.getTime()).toBeGreaterThanOrEqual(march.getTime())
  })
})

describe('a day-part with no sessions that is NOT new', () => {
  it('stays empty — an old part with nothing left is one that was emptied on purpose', async () => {
    // The discriminator is createdAt. A slot that existed when the run was
    // scheduled had its whole horizon written then, so one sitting empty now is
    // one whose sessions were removed — and removals stay removed. Guessing the
    // other way would refill a deleted series every night, forever.
    h.runFindMany.mockResolvedValue([
      { ...RUN, package: { ...RUN.package, sessionSlots: [MORNING, { ...AFTERNOON, createdAt: RUN_CREATED }] } },
    ])
    const res = await extendSlotRuns({ now: NOW })
    expect(res.sessionsCreated).toBe(0)
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('treats a slot created in the SAME transaction as the run as already generated', async () => {
    // Postgres gives every row in one transaction the same CURRENT_TIMESTAMP,
    // so a package's slots and its run tie exactly. A tie must read as "already
    // generated", or every daycare would be refilled on the first pass after a
    // trainer deleted a single date.
    h.runFindMany.mockResolvedValue([
      { ...RUN, package: { ...RUN.package, sessionSlots: [MORNING, { ...AFTERNOON, createdAt: RUN.createdAt }] } },
    ])
    await extendSlotRuns({ now: NOW })
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('never reads "field not selected" as "new"', async () => {
    // A single missing select must not carpet a trainer's diary.
    h.runFindMany.mockResolvedValue([
      { ...RUN, createdAt: undefined, package: { ...RUN.package, sessionSlots: [MORNING, { ...AFTERNOON, createdAt: undefined }] } },
    ])
    await extendSlotRuns({ now: NOW })
    expect(h.createMany).not.toHaveBeenCalled()
  })
})

describe('filling a new day-part cannot undo per-occurrence work', () => {
  // The single most important correctness property in this area. The new fill
  // path re-plans a slot's series from scratch, which is exactly the shape that
  // resurrects a cancelled week — so it is handed the same tombstones the
  // tail-based path is (lib/run-occurrences.spokenForInstants).

  it('does not re-create a date the trainer CANCELLED on the new part', async () => {
    // The trainer added the afternoon, it filled, they called one week off — and
    // then the tail moved for some other reason and the slot was re-planned.
    const cancelled = new Date('2026-09-02T00:30:00.000Z')
    h.groupBy.mockResolvedValue([
      { classRunId: 'run1', packageSessionSlotId: 'morning', _max: { scheduledAt: new Date('2027-07-26T19:30:00.000Z') } },
      { classRunId: 'run1', packageSessionSlotId: 'afternoon', _max: { scheduledAt: new Date('2026-08-26T00:30:00.000Z') } },
    ])
    h.sessionFindMany.mockResolvedValue([
      {
        classRunId: 'run1', packageSessionSlotId: 'afternoon',
        scheduledAt: cancelled, cancelledAt: new Date('2026-08-20T00:00:00.000Z'),
        originalScheduledAt: null,
      },
    ])

    await extendSlotRuns({ now: NOW })
    expect(forSlot('afternoon').map(d => d.getTime())).not.toContain(cancelled.getTime())
    // …and the rest of what the part owes is still written. One called-off week
    // must not stop the daycare being topped up.
    expect(forSlot('afternoon').length).toBeGreaterThan(0)
  })

  it('does not put back the week the trainer MOVED, at the time they moved it from', async () => {
    const movedFrom = new Date('2026-09-02T00:30:00.000Z')
    h.groupBy.mockResolvedValue([
      { classRunId: 'run1', packageSessionSlotId: 'morning', _max: { scheduledAt: new Date('2027-07-26T19:30:00.000Z') } },
      { classRunId: 'run1', packageSessionSlotId: 'afternoon', _max: { scheduledAt: new Date('2026-08-26T00:30:00.000Z') } },
    ])
    h.sessionFindMany.mockResolvedValue([
      {
        classRunId: 'run1', packageSessionSlotId: 'afternoon',
        scheduledAt: new Date(movedFrom.getTime() + 3_600_000),
        cancelledAt: null,
        originalScheduledAt: movedFrom,
      },
    ])

    await extendSlotRuns({ now: NOW })
    expect(forSlot('afternoon').map(d => d.getTime())).not.toContain(movedFrom.getTime())
  })

  it('a part whose only date was CANCELLED is not mistaken for a new one', async () => {
    // A cancelled occurrence is still a row, so it still reports a tail — which
    // is one of the reasons cancelling is a column and not a delete. Were it a
    // delete, the part would look brand new and be refilled from today, putting
    // the called-off week back by the other door.
    h.groupBy.mockResolvedValue([
      { classRunId: 'run1', packageSessionSlotId: 'morning', _max: { scheduledAt: new Date('2027-07-26T19:30:00.000Z') } },
      { classRunId: 'run1', packageSessionSlotId: 'afternoon', _max: { scheduledAt: new Date('2027-07-28T00:30:00.000Z') } },
    ])
    const res = await extendSlotRuns({ now: NOW })
    expect(res.sessionsCreated).toBe(0)
  })
})

describe('scoping the pass to one offering', () => {
  it('lets the save that added the day-part fill it immediately, without touching anything else', async () => {
    // The trainer is looking at the board — an empty column until tonight's cron
    // is the thing they reported. The API route calls this same generator scoped
    // to the offering it just saved; it must not become a system-wide pass.
    h.groupBy.mockResolvedValue([])
    await extendSlotRuns({ packageId: 'pkg1', trainerId: 'co1' })
    const where = h.groupBy.mock.calls[0][0].where
    expect(where.classRun.packageId).toBe('pkg1')
    expect(where.trainerId).toBe('co1')
  })

  it('asks for no package filter at all on the nightly pass', async () => {
    h.groupBy.mockResolvedValue([])
    await extendSlotRuns({})
    expect(h.groupBy.mock.calls[0][0].where.classRun.packageId).toBeUndefined()
  })
})
