import { describe, it, expect, vi, beforeEach } from 'vitest'

// Keeping a class-backed group's membership in step with its roster.
//
// The rule this file exists to protect: LEAVING STICKS. Someone the roster
// dropped and later restored comes back; someone who walked out, or was
// removed by a moderator, must never be silently dragged back in when they
// re-enrol next term. Those are different facts and only one is a choice —
// which is why leftAt and optedOutAt are separate columns.

const h = vi.hoisted(() => ({
  groupFindFirst: vi.fn(),
  classRunFindFirst: vi.fn(),
  enrollmentFindMany: vi.fn(),
  clientFindMany: vi.fn(),
  participantFindMany: vi.fn(),
  participantCreateMany: vi.fn(),
  participantUpdateMany: vi.fn(),
  scopeForMember: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    messageGroup: { findFirst: h.groupFindFirst },
    classRun: { findFirst: h.classRunFindFirst },
    classEnrollment: { findMany: h.enrollmentFindMany },
    clientProfile: { findMany: h.clientFindMany },
    messageGroupParticipant: {
      findMany: h.participantFindMany,
      createMany: h.participantCreateMany,
      updateMany: h.participantUpdateMany,
    },
    package: { findFirst: vi.fn() },
    membership: { findFirst: vi.fn() },
    clientPackage: { findMany: vi.fn() },
    membershipPurchase: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/membership', () => ({ scopeForMember: h.scopeForMember }))

import { syncGroupParticipants } from '@/lib/message-groups'

const CO = 'co1'
const ctx = { userId: 'u1', companyId: CO, membershipId: 'm1', role: 'OWNER' as const, permissions: {} }

/** Enrolled today: Sarah (cu1) and Tom (cu2). */
function rosterIs(userIds: string[]) {
  const map: Record<string, string> = { cu1: 'c1', cu2: 'c2', cu3: 'c3' }
  h.enrollmentFindMany.mockResolvedValue(userIds.map(u => ({ clientId: map[u] })))
  h.clientFindMany.mockResolvedValue(
    userIds.map(u => ({
      id: map[u], userId: u, trainerId: CO, status: 'ACTIVE', isSample: false,
      user: { name: `Name${u}`, email: `${u}@x.com` },
    })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.scopeForMember.mockReturnValue({})
  h.groupFindFirst.mockResolvedValue({
    id: 'g1', scope: 'CLASS_RUN', mode: 'BROADCAST', classRunId: 'run1',
    packageId: null, membershipId: null, includeWaitlist: false,
  })
  h.classRunFindFirst.mockResolvedValue({ name: 'Spring Puppy Class' })
  h.participantCreateMany.mockResolvedValue({ count: 0 })
  h.participantUpdateMany.mockResolvedValue({ count: 0 })
})

describe('syncGroupParticipants', () => {
  it('adds someone who has just enrolled', async () => {
    rosterIs(['cu1', 'cu2'])
    h.participantFindMany.mockResolvedValue([
      { id: 'p1', userId: 'cu1', leftAt: null, optedOutAt: null },
    ])
    const res = await syncGroupParticipants(ctx, 'g1')
    expect(res.added).toBe(1)
    const created = h.participantCreateMany.mock.calls[0][0].data as { userId: string }[]
    expect(created.map(c => c.userId)).toEqual(['cu2'])
  })

  it('marks someone who left the class as gone, WITHOUT opting them out', async () => {
    rosterIs(['cu1'])
    h.participantFindMany.mockResolvedValue([
      { id: 'p1', userId: 'cu1', leftAt: null, optedOutAt: null },
      { id: 'p2', userId: 'cu2', leftAt: null, optedOutAt: null },
    ])
    const res = await syncGroupParticipants(ctx, 'g1')
    expect(res.removed).toBe(1)
    const call = h.participantUpdateMany.mock.calls.find(c => c[0].data.leftAt)
    expect(call![0].where.id.in).toEqual(['p2'])
    // Withdrawing from a class is not a decision about the GROUP, so it must
    // not set optedOutAt — otherwise re-enrolling would never bring them back.
    expect(call![0].data).not.toHaveProperty('optedOutAt')
  })

  it('restores someone the roster dropped and brought back', async () => {
    rosterIs(['cu1', 'cu2'])
    h.participantFindMany.mockResolvedValue([
      { id: 'p1', userId: 'cu1', leftAt: null, optedOutAt: null },
      { id: 'p2', userId: 'cu2', leftAt: new Date('2026-01-01'), optedOutAt: null },
    ])
    const res = await syncGroupParticipants(ctx, 'g1')
    expect(res.added).toBe(1)
    expect(h.participantCreateMany).not.toHaveBeenCalled()
    const restore = h.participantUpdateMany.mock.calls.find(c => c[0].data.leftAt === null)
    expect(restore![0].where.id.in).toEqual(['p2'])
  })

  it('NEVER re-adds someone who opted out, even when they re-enrol', async () => {
    rosterIs(['cu1', 'cu2'])
    h.participantFindMany.mockResolvedValue([
      { id: 'p1', userId: 'cu1', leftAt: null, optedOutAt: null },
      // Walked out of the group, then re-enrolled in the class next term.
      { id: 'p2', userId: 'cu2', leftAt: new Date('2026-01-01'), optedOutAt: new Date('2026-01-01') },
    ])
    const res = await syncGroupParticipants(ctx, 'g1')
    expect(res.added).toBe(0)
    expect(h.participantCreateMany).not.toHaveBeenCalled()
    // Nothing restored p2.
    const restores = h.participantUpdateMany.mock.calls.filter(c => c[0].data.leftAt === null)
    expect(restores.flatMap(c => c[0].where.id.in)).not.toContain('p2')
  })

  it('joins new BROADCAST members immediately but only INVITES community ones', async () => {
    rosterIs(['cu1'])
    h.participantFindMany.mockResolvedValue([])
    await syncGroupParticipants(ctx, 'g1')
    expect((h.participantCreateMany.mock.calls[0][0].data as { joinedAt: Date | null }[])[0].joinedAt)
      .toBeInstanceOf(Date)

    vi.clearAllMocks()
    h.scopeForMember.mockReturnValue({})
    h.groupFindFirst.mockResolvedValue({
      id: 'g2', scope: 'CLASS_RUN', mode: 'COMMUNITY', classRunId: 'run1',
      packageId: null, membershipId: null, includeWaitlist: false,
    })
    h.classRunFindFirst.mockResolvedValue({ name: 'Spring Puppy Class' })
    h.participantCreateMany.mockResolvedValue({ count: 0 })
    h.participantUpdateMany.mockResolvedValue({ count: 0 })
    rosterIs(['cu1'])
    h.participantFindMany.mockResolvedValue([])
    await syncGroupParticipants(ctx, 'g2')
    expect((h.participantCreateMany.mock.calls[0][0].data as { joinedAt: Date | null }[])[0].joinedAt)
      .toBeNull()
  })

  it('does nothing for a MANUAL group — there is no source to re-derive from', async () => {
    h.groupFindFirst.mockResolvedValue({
      id: 'g1', scope: 'MANUAL', mode: 'BROADCAST', classRunId: null,
      packageId: null, membershipId: null, includeWaitlist: false,
    })
    const res = await syncGroupParticipants(ctx, 'g1')
    expect(res).toEqual({ added: 0, removed: 0 })
    expect(h.participantFindMany).not.toHaveBeenCalled()
  })

  it('does nothing for another business’s group', async () => {
    h.groupFindFirst.mockResolvedValue(null)
    const res = await syncGroupParticipants(ctx, 'g-theirs')
    expect(res).toEqual({ added: 0, removed: 0 })
    expect(h.participantCreateMany).not.toHaveBeenCalled()
    expect(h.participantUpdateMany).not.toHaveBeenCalled()
  })
})
