import { describe, it, expect, vi, beforeEach } from 'vitest'

// A daycare's sessions used to stop dead after 12 weeks.
//
// Its day-parts are written as bare `FREQ=WEEKLY` slots (PuppySchoolSetup), and
// planSlotSessions expanded each of them to OPEN_ENDED_OCCURRENCES = 12 — a
// COUNT, not a date — exactly once, at creation. Nothing topped them up:
// extendOngoingPackages only walks 1:1 ClientPackage assignments. Three months
// later the board and the client booking wizard were empty, with no warning.
//
// These cover both halves of the fix: the horizon is a DATE (12 months, so a
// parent can book a year out), and the nightly top-up keeps it rolling without
// ever resurrecting a session the trainer deleted.

const h = vi.hoisted(() => ({
  groupBy: vi.fn(),
  runFindMany: vi.fn(),
  sessionCount: vi.fn(),
  createMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: { groupBy: h.groupBy, count: h.sessionCount, createMany: h.createMany },
    classRun: { findMany: h.runFindMany },
  },
}))

import { planSlotSessions, slotHorizonEnd, SLOT_HORIZON_MONTHS } from '@/lib/class-runs'
import { extendSlotRuns } from '@/lib/extend-slot-runs'
import { GET as extendCron } from '@/app/api/cron/extend-slot-runs/route'

const TZ = 'Pacific/Auckland'
const RUN_START = new Date('2026-01-05T00:00:00Z') // a Monday

/** One daycare day-part on one weekday, open-ended. */
function slot(over: Partial<Parameters<typeof planSlotSessions>[0][number]> = {}) {
  return {
    id: 'slot1', order: 0, startDate: RUN_START, day: 1,
    startTime: '07:30', endTime: '17:30', gapMins: 0,
    recurrenceRule: 'FREQ=WEEKLY', assignedMembershipIds: [] as string[],
    ...over,
  }
}

describe('the horizon is a date, not an occurrence count', () => {
  it('keeps a year of a weekly day-part, not 12 weeks', () => {
    const out = planSlotSessions([slot()], { runStart: RUN_START, tz: TZ, through: slotHorizonEnd(RUN_START) })
    // 12 months of Mondays — comfortably more than the 12 it used to stop at.
    expect(out.length).toBeGreaterThan(50)
    expect(out.length).toBeLessThan(54)
    const last = out[out.length - 1].scheduledAt
    expect(last.getTime()).toBeGreaterThan(new Date('2026-12-01T00:00:00Z').getTime())
  })

  it('gives every day-part of a 3-part, 5-day daycare the same year', () => {
    const slots = [1, 2, 3, 4, 5].flatMap((day, i) => [
      slot({ id: `full-${day}`, order: i * 3, day, startTime: '07:30', endTime: '17:30' }),
      slot({ id: `am-${day}`, order: i * 3 + 1, day, startTime: '07:30', endTime: '12:30' }),
      slot({ id: `pm-${day}`, order: i * 3 + 2, day, startTime: '12:30', endTime: '17:30' }),
    ])
    const out = planSlotSessions(slots, { runStart: RUN_START, tz: TZ, through: slotHorizonEnd(RUN_START) })
    // 15 slots × ~52 weeks. The count is what it is; the point is that every
    // slot reaches the horizon rather than stopping at 12 apiece (180 total).
    expect(out.length).toBeGreaterThan(700)
    const bySlot = new Map<string, number>()
    for (const p of out) bySlot.set(p.slotId, (bySlot.get(p.slotId) ?? 0) + 1)
    expect(bySlot.size).toBe(15)
    for (const n of bySlot.values()) expect(n).toBeGreaterThan(50)
  })

  it('still ends a slot whose own rule ends first', () => {
    const out = planSlotSessions(
      [slot({ recurrenceRule: 'FREQ=WEEKLY;COUNT=6' })],
      { runStart: RUN_START, tz: TZ, through: slotHorizonEnd(RUN_START) },
    )
    expect(out).toHaveLength(6)
  })

  it('leaves callers that pass no horizon on the old occurrence cap', () => {
    const out = planSlotSessions([slot()], { runStart: RUN_START, tz: TZ })
    expect(out).toHaveLength(12)
  })

  it('measures the horizon in months from the date given', () => {
    const from = new Date('2026-03-01T00:00:00Z')
    expect(slotHorizonEnd(from).getMonth()).toBe(from.getMonth())
    expect(slotHorizonEnd(from).getFullYear()).toBe(from.getFullYear() + SLOT_HORIZON_MONTHS / 12)
  })
})

describe('extendSlotRuns — the rolling top-up', () => {
  const NOW = new Date('2026-06-01T00:00:00Z')

  const run = {
    id: 'run1', trainerId: 't1', name: 'Waggy Tails',
    startDate: RUN_START, location: 'The barn',
    package: { sessionType: 'IN_PERSON', sessionSlots: [{ ...slot(), location: null }] },
    trainer: { user: { timezone: TZ } },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    h.runFindMany.mockResolvedValue([run])
    h.sessionCount.mockResolvedValue(12)
    h.createMany.mockResolvedValue({ count: 0 })
  })

  it('tops a run whose tail has fallen inside the refill window back up', async () => {
    // Created in January, so its last session is late March — three months in,
    // the exact cliff Karl hit.
    h.groupBy.mockResolvedValue([
      { classRunId: 'run1', packageSessionSlotId: 'slot1', _max: { scheduledAt: new Date('2026-03-23T19:30:00Z') } },
    ])
    const res = await extendSlotRuns({ now: NOW })
    expect(res.runsExtended).toBe(1)
    expect(res.sessionsCreated).toBeGreaterThan(30)
    const rows = h.createMany.mock.calls[0][0].data as { scheduledAt: Date; packageSessionSlotId: string }[]
    // Everything new is AFTER the existing tail — nothing backfilled.
    for (const r of rows) expect(r.scheduledAt.getTime()).toBeGreaterThan(new Date('2026-03-23T19:30:00Z').getTime())
    // …and it reaches the horizon.
    expect(rows[rows.length - 1].scheduledAt.getTime()).toBeGreaterThan(new Date('2027-04-01T00:00:00Z').getTime())
  })

  it('is idempotent — a slot already at the horizon is left alone', async () => {
    h.groupBy.mockResolvedValue([
      { classRunId: 'run1', packageSessionSlotId: 'slot1', _max: { scheduledAt: new Date('2027-05-24T19:30:00Z') } },
    ])
    const res = await extendSlotRuns({ now: NOW })
    expect(res).toEqual({ runsExtended: 0, sessionsCreated: 0, truncated: false })
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('never resurrects a session deleted mid-series', async () => {
    // The trainer deleted the Monday of Easter week. The tail is still months
    // out at the end of the series, so the gap is simply not refilled.
    h.groupBy.mockResolvedValue([
      { classRunId: 'run1', packageSessionSlotId: 'slot1', _max: { scheduledAt: new Date('2026-03-23T19:30:00Z') } },
    ])
    await extendSlotRuns({ now: NOW })
    const rows = h.createMany.mock.calls[0][0].data as { scheduledAt: Date }[]
    const easterMonday = new Date('2026-02-16T18:30:00Z')
    expect(rows.some(r => r.scheduledAt.getTime() <= easterMonday.getTime())).toBe(false)
  })

  it('leaves a slot with no sessions on the run alone rather than guessing', async () => {
    // Nothing reported for slot1 → we can't tell "added to the timetable later"
    // from "all its sessions were deleted on purpose", so we don't act.
    h.groupBy.mockResolvedValue([])
    const res = await extendSlotRuns({ now: NOW })
    expect(res.sessionsCreated).toBe(0)
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('only considers runs that are still scheduled or running', async () => {
    h.groupBy.mockResolvedValue([])
    await extendSlotRuns({ now: NOW })
    const where = h.groupBy.mock.calls[0][0].where
    expect(where.classRun.status.in).toEqual(['SCHEDULED', 'RUNNING'])
    expect(where.packageSessionSlotId).toEqual({ not: null })
  })

  it('scopes to one company when asked', async () => {
    h.groupBy.mockResolvedValue([])
    await extendSlotRuns({ trainerId: 't1', now: NOW })
    expect(h.groupBy.mock.calls[0][0].where.trainerId).toBe('t1')
  })

  it('continues sessionIndex from what the run already holds', async () => {
    h.groupBy.mockResolvedValue([
      { classRunId: 'run1', packageSessionSlotId: 'slot1', _max: { scheduledAt: new Date('2026-03-23T19:30:00Z') } },
    ])
    h.sessionCount.mockResolvedValue(12)
    await extendSlotRuns({ now: NOW })
    const rows = h.createMany.mock.calls[0][0].data as { sessionIndex: number; title: string }[]
    expect(rows[0].sessionIndex).toBe(13)
    // No "x/N" — a run with no end has no total to count towards.
    expect(rows[0].title).toBe('Waggy Tails')
  })
})

describe('GET /api/cron/extend-slot-runs', () => {
  const SECRET = 'cron-secret-abcdef123456'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = SECRET
    h.groupBy.mockResolvedValue([])
  })

  it('401s without the Bearer CRON_SECRET, before touching anything', async () => {
    const res = await extendCron(new Request('http://x/api/cron/extend-slot-runs'))
    expect(res.status).toBe(401)
    expect(h.groupBy).not.toHaveBeenCalled()
  })

  it('runs the top-up when authorised', async () => {
    const res = await extendCron(new Request('http://x/api/cron/extend-slot-runs', {
      headers: { authorization: `Bearer ${SECRET}` },
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, sessionsCreated: 0 })
  })
})
