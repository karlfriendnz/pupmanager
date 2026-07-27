import { describe, it, expect, vi, beforeEach } from 'vitest'

// Who ends up in a group, and the rules that decide it.
//
// The rule under test throughout: a scope only ever produces CANDIDATE ids.
// The membership always comes from a refetch scoped to this business, so
// nothing from another tenant survives no matter which scope was used.

const h = vi.hoisted(() => ({
  classRunFindFirst: vi.fn(),
  packageFindFirst: vi.fn(),
  membershipFindFirst: vi.fn(),
  enrollmentFindMany: vi.fn(),
  clientPackageFindMany: vi.fn(),
  purchaseFindMany: vi.fn(),
  clientFindMany: vi.fn(),
  scopeForMember: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    classRun: { findFirst: h.classRunFindFirst },
    package: { findFirst: h.packageFindFirst },
    membership: { findFirst: h.membershipFindFirst },
    classEnrollment: { findMany: h.enrollmentFindMany },
    clientPackage: { findMany: h.clientPackageFindMany },
    membershipPurchase: { findMany: h.purchaseFindMany },
    clientProfile: { findMany: h.clientFindMany },
  },
}))
vi.mock('@/lib/membership', () => ({ scopeForMember: h.scopeForMember }))

import {
  resolveGroupAudience,
  firstNameOf,
  visibleMessagesWhere,
  visibilityForPost,
  canSeeResponses,
  chunk,
} from '@/lib/message-groups'

const CO = 'co1'
const ctx = { userId: 'u1', companyId: CO, membershipId: 'm1', role: 'OWNER' as const, permissions: {} }

const CLIENTS = [
  { id: 'c1', userId: 'cu1', trainerId: CO, status: 'ACTIVE', isSample: false, user: { name: 'Sarah Baker', email: 's@x.com' } },
  { id: 'c2', userId: 'cu2', trainerId: CO, status: 'ACTIVE', isSample: false, user: { name: 'Tom Reed', email: 't@x.com' } },
  { id: 'c3', userId: 'cu3', trainerId: CO, status: 'INACTIVE', isSample: false, user: { name: 'Gone Away', email: 'g@x.com' } },
  { id: 'c4', userId: 'cu4', trainerId: CO, status: 'ACTIVE', isSample: true, user: { name: 'Sample Sam', email: 'demo@x.com' } },
  { id: 'c5', userId: 'cu5', trainerId: CO, status: 'ACTIVE', isSample: false, user: { name: null, email: 'noname@x.com' } },
  // Same person as c1, but their profile at ANOTHER business, co-managed with
  // ours through an accepted share.
  { id: 'c1b', userId: 'cu1', trainerId: 'co-other', status: 'ACTIVE', isSample: false, user: { name: 'Sarah Baker', email: 's@x.com' } },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.scopeForMember.mockReturnValue({})
  h.clientFindMany.mockImplementation(async ({ where }: { where: { id?: { in: string[] } } }) => {
    if (!where.id) return CLIENTS.filter(c => c.trainerId === CO) // ALL_CLIENTS
    return CLIENTS.filter(c => where.id!.in.includes(c.id))
  })
})

describe('resolveGroupAudience — MANUAL', () => {
  it('resolves the ticked clients, first name only', async () => {
    const res = await resolveGroupAudience(ctx, { scope: 'MANUAL', clientIds: ['c1', 'c2'] })
    expect(res.members).toEqual([
      { clientProfileId: 'c1', userId: 'cu1', displayName: 'Sarah' },
      { clientProfileId: 'c2', userId: 'cu2', displayName: 'Tom' },
    ])
  })

  it('drops an id from another business as NOT_FOUND', async () => {
    const res = await resolveGroupAudience(ctx, { scope: 'MANUAL', clientIds: ['c1', 'someone-elses'] })
    expect(res.members.map(m => m.clientProfileId)).toEqual(['c1'])
    expect(res.skipped).toEqual([{ clientId: 'someone-elses', reason: 'NOT_FOUND' }])
  })

  it('excludes INACTIVE by default and includes on request', async () => {
    const off = await resolveGroupAudience(ctx, { scope: 'MANUAL', clientIds: ['c1', 'c3'] })
    expect(off.members.map(m => m.clientProfileId)).toEqual(['c1'])
    expect(off.skipped).toEqual([{ clientId: 'c3', reason: 'INACTIVE' }])

    const on = await resolveGroupAudience(ctx, { scope: 'MANUAL', clientIds: ['c1', 'c3'], includeInactive: true })
    expect(on.members.map(m => m.clientProfileId)).toEqual(['c1', 'c3'])
  })

  it('never puts sample data in a group', async () => {
    const res = await resolveGroupAudience(ctx, { scope: 'MANUAL', clientIds: ['c1', 'c4'] })
    expect(res.members.map(m => m.clientProfileId)).toEqual(['c1'])
    expect(res.skipped).toEqual([{ clientId: 'c4', reason: 'SAMPLE' }])
  })

  it('dedupes a co-managed person to ONE membership, keeping our own profile', async () => {
    const res = await resolveGroupAudience(ctx, { scope: 'MANUAL', clientIds: ['c1', 'c1b'] })
    expect(res.members).toHaveLength(1)
    expect(res.members[0].clientProfileId).toBe('c1')
    expect(res.skipped).toEqual([{ clientId: 'c1b', reason: 'DUPLICATE_PERSON' }])
  })

  it('passes the member visibility scope into the refetch', async () => {
    h.scopeForMember.mockReturnValue({ assignedMembershipId: 'm9' })
    await resolveGroupAudience(ctx, { scope: 'MANUAL', clientIds: ['c1'] })
    expect(h.clientFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assignedMembershipId: 'm9' }) }),
    )
  })

  it('returns nothing without querying when no ids were given', async () => {
    const res = await resolveGroupAudience(ctx, { scope: 'MANUAL', clientIds: [] })
    expect(res.members).toEqual([])
    expect(h.clientFindMany).not.toHaveBeenCalled()
  })
})

describe('resolveGroupAudience — ALL_CLIENTS', () => {
  it('reaches the whole active customer base with no id filter and no cap', async () => {
    const res = await resolveGroupAudience(ctx, { scope: 'ALL_CLIENTS' })
    // Everyone active and real: c1, c2, c5. Not the inactive one, not the sample.
    expect(res.members.map(m => m.clientProfileId).sort()).toEqual(['c1', 'c2', 'c5'])
    expect(res.suggestedName).toBe('Everyone')
    expect(h.clientFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ id: expect.anything() }) }),
    )
  })
})

describe('resolveGroupAudience — CLASS_RUN', () => {
  beforeEach(() => {
    h.classRunFindFirst.mockImplementation(async ({ where }: { where: { id: string; trainerId: string } }) =>
      where.id === 'run1' && where.trainerId === CO ? { name: 'Spring Puppy Class' } : null)
  })

  it('suggests the class name and resolves the enrolled', async () => {
    h.enrollmentFindMany.mockResolvedValue([{ clientId: 'c1' }, { clientId: 'c2' }])
    const res = await resolveGroupAudience(ctx, { scope: 'CLASS_RUN', classRunId: 'run1' })
    expect(res.suggestedName).toBe('Spring Puppy Class')
    expect(res.members).toHaveLength(2)
  })

  it('gives a client with two dogs in the class ONE membership', async () => {
    h.enrollmentFindMany.mockResolvedValue([{ clientId: 'c1' }, { clientId: 'c1' }, { clientId: 'c2' }])
    const res = await resolveGroupAudience(ctx, { scope: 'CLASS_RUN', classRunId: 'run1' })
    expect(res.members.map(m => m.clientProfileId)).toEqual(['c1', 'c2'])
  })

  it('leaves the waitlist out unless the trainer ticked it', async () => {
    h.enrollmentFindMany.mockResolvedValue([])
    await resolveGroupAudience(ctx, { scope: 'CLASS_RUN', classRunId: 'run1' })
    expect(h.enrollmentFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['ENROLLED'] } }) }),
    )
    await resolveGroupAudience(ctx, { scope: 'CLASS_RUN', classRunId: 'run1', includeWaitlist: true })
    expect(h.enrollmentFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['ENROLLED', 'WAITLISTED'] } }) }),
    )
  })

  it('reports notFound for another business’s class and never reads its roster', async () => {
    const res = await resolveGroupAudience(ctx, { scope: 'CLASS_RUN', classRunId: 'theirs' })
    expect(res.notFound).toBe(true)
    expect(h.enrollmentFindMany).not.toHaveBeenCalled()
  })
})

describe('resolveGroupAudience — PACKAGE and MEMBERSHIP', () => {
  it('resolves package holders and 404s on a foreign package', async () => {
    h.packageFindFirst.mockResolvedValueOnce({ name: 'Puppy Basics' })
    h.clientPackageFindMany.mockResolvedValue([{ clientId: 'c1' }])
    const ok = await resolveGroupAudience(ctx, { scope: 'PACKAGE', packageId: 'p1' })
    expect(ok.suggestedName).toBe('Puppy Basics')

    h.packageFindFirst.mockResolvedValueOnce(null)
    const bad = await resolveGroupAudience(ctx, { scope: 'PACKAGE', packageId: 'theirs' })
    expect(bad.notFound).toBe(true)
  })

  it('resolves only ACTIVE memberships, scoped to the trainer', async () => {
    h.membershipFindFirst.mockResolvedValue({ name: 'Gold' })
    h.purchaseFindMany.mockResolvedValue([{ clientId: 'c1' }])
    await resolveGroupAudience(ctx, { scope: 'MEMBERSHIP', membershipId: 'mem1' })
    expect(h.purchaseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ trainerId: CO, status: 'ACTIVE' }) }),
    )
  })
})

describe('display name', () => {
  it('is the first name only', () => {
    expect(firstNameOf('Sarah Baker-Jones', 's@x.com')).toBe('Sarah')
  })

  it('NEVER falls back to the email — that is the disclosure a group must not make', () => {
    expect(firstNameOf(null, 'sarah.baker@example.com')).toBe('Member')
    expect(firstNameOf('   ', 'sarah.baker@example.com')).toBe('Member')
  })
})

describe('visibility — the one field the two modes differ by', () => {
  it('writes a client reply as TRAINER_ONLY in a broadcast', () => {
    expect(visibilityForPost('BROADCAST', false)).toBe('TRAINER_ONLY')
    expect(visibilityForPost('BROADCAST', true)).toBe('EVERYONE')
  })

  it('writes everything as EVERYONE in a community', () => {
    expect(visibilityForPost('COMMUNITY', false)).toBe('EVERYONE')
    expect(visibilityForPost('COMMUNITY', true)).toBe('EVERYONE')
  })

  it('lets a client read public posts plus their OWN replies, and nothing else', () => {
    const where = visibleMessagesWhere({ userId: 'cu1', isTrainerSide: false })
    expect(where).toEqual({
      deletedAt: null,
      OR: [{ visibility: 'EVERYONE' }, { senderId: 'cu1' }],
    })
  })

  it('lets the trainer read everything that is not deleted', () => {
    expect(visibleMessagesWhere({ userId: 'u1', isTrainerSide: true })).toEqual({ deletedAt: null })
  })

  it('hides the responses view from clients in a broadcast, shows it in a community', () => {
    expect(canSeeResponses('BROADCAST', false)).toBe(false)
    expect(canSeeResponses('BROADCAST', true)).toBe(true)
    expect(canSeeResponses('COMMUNITY', false)).toBe(true)
  })
})

describe('chunk', () => {
  it('splits a 300-person send into batches rather than one giant statement', () => {
    const parts = chunk(Array.from({ length: 300 }, (_, i) => i))
    expect(parts.map(p => p.length)).toEqual([100, 100, 100])
  })

  it('handles an exact multiple and an empty list', () => {
    expect(chunk([1, 2], 2).map(p => p.length)).toEqual([2])
    expect(chunk([])).toEqual([])
  })
})
