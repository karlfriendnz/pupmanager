import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/schedule/conflicts — the server-side booking gate every create /
// reschedule surface calls. With the turnaround buffer, an existing session
// occupies [scheduledAt, +durationMins +bufferMins): a proposed booking that
// starts exactly when the buffer ends must come back CLEAN; one a minute
// earlier must come back as a conflict. Tenant + assignedMembershipId scoping
// must survive all of it.
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  membershipFindFirst: vi.fn(),
  sessionFindMany: vi.fn(),
  hasAddon: vi.fn(async () => false),
  googleConnFindUnique: vi.fn(async () => null),
  busyBlockFindMany: vi.fn(async () => []),
  fetchCalendarEvents: vi.fn(async () => []),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerMembership: { findFirst: h.membershipFindFirst },
    trainingSession: { findMany: h.sessionFindMany },
    googleCalendarConnection: { findUnique: h.googleConnFindUnique },
    googleBusyBlock: { findMany: h.busyBlockFindMany },
  },
}))
vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/google-calendar', () => ({ fetchCalendarEvents: h.fetchCalendarEvents }))

import { GET } from '@/app/api/schedule/conflicts/route'

const OWNER = 'm-owner'
const COMPANY = 'co-1'

// One existing booking: 10:00–11:00 with a 30-minute turnaround gap → 11:30.
const EXISTING = {
  id: 'sess-1',
  title: 'Bailey — session 2/6',
  scheduledAt: new Date('2030-01-08T10:00:00.000Z'),
  durationMins: 60,
  bufferMins: 30,
  client: { user: { name: 'Sarah' } },
  dog: { name: 'Bailey' },
  classRun: null,
  clientPackage: null,
}

function req(startIso: string, endIso: string, extra = '') {
  return new Request(`http://x/api/schedule/conflicts?start=${startIso}&end=${endIso}${extra}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getTrainerContext.mockResolvedValue({ companyId: COMPANY, membershipId: OWNER })
  h.membershipFindFirst.mockResolvedValue({ id: OWNER })
  h.sessionFindMany.mockResolvedValue([EXISTING])
  h.hasAddon.mockResolvedValue(false)
})

describe('/api/schedule/conflicts — turnaround buffer', () => {
  it('reports a conflict for a booking that lands INSIDE the buffer (11:00–12:00)', async () => {
    const res = await GET(req('2030-01-08T11:00:00.000Z', '2030-01-08T12:00:00.000Z'))
    const body = await res.json()
    expect(body.sessionConflicts).toHaveLength(1)
    expect(body.sessionConflicts[0]).toMatchObject({ id: 'sess-1', bufferMins: 30, label: 'Sarah' })
  })

  it('reports a conflict one minute before the buffer ends (11:29)', async () => {
    const res = await GET(req('2030-01-08T11:29:00.000Z', '2030-01-08T12:29:00.000Z'))
    expect((await res.json()).sessionConflicts).toHaveLength(1)
  })

  it('is CLEAN for a booking starting exactly when the buffer ends (11:30)', async () => {
    const res = await GET(req('2030-01-08T11:30:00.000Z', '2030-01-08T12:30:00.000Z'))
    expect((await res.json()).sessionConflicts).toEqual([])
  })

  it('counts the PROPOSED booking’s own buffer: 08:30–09:30 +30m butts up at 10:00 (clean)', async () => {
    const res = await GET(req('2030-01-08T08:30:00.000Z', '2030-01-08T09:30:00.000Z', '&bufferMins=30'))
    expect((await res.json()).sessionConflicts).toEqual([])
  })

  it('…but 08:31 pushes its own buffer one minute into the session (conflict)', async () => {
    const res = await GET(req('2030-01-08T08:31:00.000Z', '2030-01-08T09:31:00.000Z', '&bufferMins=30'))
    expect((await res.json()).sessionConflicts).toHaveLength(1)
  })

  it('keeps tenant + per-member scoping while doing it', async () => {
    await GET(req('2030-01-08T11:00:00.000Z', '2030-01-08T12:00:00.000Z'))
    const where = h.sessionFindMany.mock.calls[0][0].where
    expect(where.trainerId).toBe(COMPANY)
    // Unassigned/owner-run: clashes against null-assigned AND owner-assigned rows.
    expect(where.OR).toEqual([{ assignedMembershipId: null }, { assignedMembershipId: OWNER }])
  })

  it('scopes to the picked member when one is supplied (and validates it is ours)', async () => {
    h.membershipFindFirst
      .mockResolvedValueOnce({ id: OWNER })      // owner lookup
      .mockResolvedValueOnce({ id: 'm-staff' })  // the supplied membership, in THIS company
    await GET(req('2030-01-08T11:00:00.000Z', '2030-01-08T12:00:00.000Z', '&membershipId=m-staff'))
    const where = h.sessionFindMany.mock.calls[0][0].where
    expect(where.trainerId).toBe(COMPANY)
    expect(where.assignedMembershipId).toBe('m-staff')
    // The membership was re-checked against the caller's company, not trusted.
    expect(h.membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm-staff', companyId: COMPANY } }),
    )
  })

  it('401s (with empty conflicts) when there is no trainer context', async () => {
    h.getTrainerContext.mockResolvedValue(null)
    const res = await GET(req('2030-01-08T11:00:00.000Z', '2030-01-08T12:00:00.000Z'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ sessionConflicts: [], busyConflicts: [] })
    expect(h.sessionFindMany).not.toHaveBeenCalled()
  })
})
