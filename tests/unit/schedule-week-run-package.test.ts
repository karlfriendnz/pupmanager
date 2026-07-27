import { describe, it, expect, vi, beforeEach } from 'vitest'

// Clicking a class block on the schedule routes with
// runSessionHref(runId, sessionId, session.classRun.package) — the package
// shape is what decides whether the block opens under classes, casual classes,
// events or daycare. The server-rendered page selected that package; this API,
// which REPLACES the session list on every client-side week change, selected
// only the run's name. So the first click after navigating a week dereferenced
// `undefined` inside runKind() and threw instead of opening the session.
//
// Mobile lives on this endpoint (day/week paging is all client-side), which is
// where it showed up. This test pins the two selects together.

const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  scopeForMember: vi.fn(),
  extendOngoingPackages: vi.fn(),
  trainerFindUnique: vi.fn(),
  sessionFindMany: vi.fn(),
  clientFindMany: vi.fn(),
  customFieldFindMany: vi.fn(),
  customValueFindMany: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({
  getTrainerContext: h.getTrainerContext,
  scopeForMember: h.scopeForMember,
}))
vi.mock('@/lib/extend-ongoing-packages', () => ({ extendOngoingPackages: h.extendOngoingPackages }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerFindUnique },
    trainingSession: { findMany: h.sessionFindMany },
    clientProfile: { findMany: h.clientFindMany },
    customField: { findMany: h.customFieldFindMany },
    customFieldValue: { findMany: h.customValueFindMany },
  },
}))

import { GET } from '@/app/api/schedule/week/route'
import { runKind, type RunKindPackage } from '@/lib/run-kind'

const EVENT_PKG: RunKindPackage = {
  isGroup: true,
  allowDropIn: false,
  sessionCount: 1,
  recurrenceRule: null,
  isPuppySchool: false,
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.getTrainerContext.mockResolvedValue({ companyId: 'co1' })
  h.scopeForMember.mockReturnValue({})
  h.extendOngoingPackages.mockResolvedValue(undefined)
  h.trainerFindUnique.mockResolvedValue({
    scheduleExtraFields: [],
    user: { timezone: 'Pacific/Auckland' },
  })
  h.clientFindMany.mockResolvedValue([])
  h.customFieldFindMany.mockResolvedValue([])
  h.customValueFindMany.mockResolvedValue([])
})

const req = () => new Request('https://app.pupmanager.com/api/schedule/week?date=2026-06-02')

describe('GET /api/schedule/week — the run package rides along', () => {
  it('asks Prisma for the package shape, not just the run name', async () => {
    h.sessionFindMany.mockResolvedValue([])
    await GET(req())

    const select = h.sessionFindMany.mock.calls[0][0].include.classRun.select
    expect(select.name).toBe(true)
    // Every field runKind() reads must be selected, or routing a class block
    // throws on the client.
    expect(select.package.select).toMatchObject({
      isGroup: true,
      allowDropIn: true,
      sessionCount: true,
      recurrenceRule: true,
      isPuppySchool: true,
    })
  })

  it('returns a class session whose classRun.package can be routed with', async () => {
    h.sessionFindMany.mockResolvedValue([
      {
        id: 's1',
        classRunId: 'run1',
        clientId: null,
        scheduledAt: new Date('2026-06-03T18:00:00.000Z'),
        classRun: { name: 'Scent Rally', package: EVENT_PKG },
        clientPackage: null,
        assignedTrainer: null,
      },
    ])

    const res = await GET(req())
    const body = await res.json()
    const pkg = body.sessions[0].classRun.package

    expect(pkg).toBeDefined()
    // The whole point: this is enough to route the block without throwing.
    expect(() => runKind(pkg)).not.toThrow()
    expect(runKind(pkg)).toBe('event')
  })
})
