import { describe, it, expect, vi, beforeEach } from 'vitest'

// Security surface for editing ANOTHER user's notification preferences.
//
// An owner/manager who holds `team.manage` may read + write the prefs of a
// team member in the SAME company (but never the OWNER). Authorisation lives in
// resolveTarget and mirrors /api/trainer/team/[membershipId] + team-panel:
//   (a) actor holds team.manage;
//   (b) target is a TrainerMembership of the actor's company (shared);
//   (c) target is not the OWNER.
// Any failure → 403 and NOTHING is written. The company written is the actor's
// shared company, never taken from the request. The self path (no targetUserId)
// is unchanged.
//
// We use the REAL permissions `can()` (not mocked) so the guard is exercised for
// real; only auth, getTrainerContext and prisma are mocked.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getTrainerContext: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  membershipFindUnique: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    notificationPreference: {
      findMany: h.findMany,
      findFirst: h.findFirst,
      update: h.update,
      create: h.create,
    },
    trainerMembership: {
      findUnique: h.membershipFindUnique,
    },
  },
}))

import { GET, PUT } from '@/app/api/notification-preferences/route'

const putReq = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/notification-preferences', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const getReq = (userId?: string) =>
  new Request(`https://app.pupmanager.com/api/notification-preferences${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`)

// Contexts by role. A MANAGER with team.manage explicitly granted is the
// interesting non-owner case (managers don't hold team.manage by default).
const manager = { userId: 'actor', companyId: 'co1', membershipId: 'mem-actor', role: 'MANAGER', permissions: { 'team.manage': true } }
const owner = { userId: 'actor', companyId: 'co1', membershipId: 'mem-actor', role: 'OWNER', permissions: {} }
const staffNoPerm = { userId: 'actor', companyId: 'co1', membershipId: 'mem-actor', role: 'STAFF', permissions: {} }

function expectNothingWritten() {
  expect(h.create).not.toHaveBeenCalled()
  expect(h.update).not.toHaveBeenCalled()
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.auth.mockResolvedValue({ user: { id: 'actor' } })
  h.findMany.mockResolvedValue([])
  h.findFirst.mockResolvedValue(null)
  h.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'p1', ...data }))
  h.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'existing', ...data }))
})

describe('notification-preferences target — actor WITH team.manage', () => {
  beforeEach(() => {
    h.getTrainerContext.mockResolvedValue(manager)
    // The target is a STAFF member of the actor's company.
    h.membershipFindUnique.mockResolvedValue({ role: 'STAFF' })
  })

  it('PUT writes the MEMBER’s userId + the SHARED company, not the request', async () => {
    const res = await PUT(putReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: false, targetUserId: 'member' }))
    expect(res.status).toBe(200)
    // Membership was proven within the actor's company (never trusts input).
    expect(h.membershipFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId_userId: { companyId: 'co1', userId: 'member' } },
    }))
    expect(h.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'member', companyId: 'co1', type: 'NEW_MESSAGE', channel: 'EMAIL' },
    }))
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'member', companyId: 'co1', type: 'NEW_MESSAGE', channel: 'EMAIL' }),
    }))
  })

  it('GET reads the MEMBER’s rows', async () => {
    const res = await GET(getReq('member'))
    expect(res.status).toBe(200)
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'member' } }))
  })

  it('OWNER actor can also manage a member', async () => {
    h.getTrainerContext.mockResolvedValue(owner)
    const res = await PUT(putReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: true, targetUserId: 'member' }))
    expect(res.status).toBe(200)
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'member', companyId: 'co1' }),
    }))
  })
})

describe('notification-preferences target — authorisation failures write nothing', () => {
  it('actor WITHOUT team.manage → 403 (never even looks up the membership)', async () => {
    h.getTrainerContext.mockResolvedValue(staffNoPerm)
    const res = await PUT(putReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: true, targetUserId: 'member' }))
    expect(res.status).toBe(403)
    expect(h.membershipFindUnique).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('GET for a member without team.manage → 403', async () => {
    h.getTrainerContext.mockResolvedValue(staffNoPerm)
    const res = await GET(getReq('member'))
    expect(res.status).toBe(403)
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('target in a DIFFERENT company (no shared membership) → 403', async () => {
    h.getTrainerContext.mockResolvedValue(manager)
    h.membershipFindUnique.mockResolvedValue(null) // not a member of co1
    const res = await PUT(putReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: true, targetUserId: 'outsider' }))
    expect(res.status).toBe(403)
    expectNothingWritten()
  })

  it('targeting the OWNER → 403', async () => {
    h.getTrainerContext.mockResolvedValue(manager)
    h.membershipFindUnique.mockResolvedValue({ role: 'OWNER' })
    const res = await PUT(putReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: true, targetUserId: 'the-owner' }))
    expect(res.status).toBe(403)
    expectNothingWritten()
  })

  it('a MANAGER targeting another MANAGER → 403 (only the owner manages managers)', async () => {
    h.getTrainerContext.mockResolvedValue(manager)
    h.membershipFindUnique.mockResolvedValue({ role: 'MANAGER' })
    const res = await PUT(putReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: true, targetUserId: 'other-manager' }))
    expect(res.status).toBe(403)
    expectNothingWritten()
  })

  it('an OWNER targeting a MANAGER → allowed', async () => {
    h.getTrainerContext.mockResolvedValue(owner)
    h.membershipFindUnique.mockResolvedValue({ role: 'MANAGER' })
    const res = await PUT(putReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: true, targetUserId: 'a-manager' }))
    expect(res.status).toBe(200)
  })

  it('a non-trainer session (no context) targeting anyone → 403', async () => {
    h.getTrainerContext.mockResolvedValue(null)
    const res = await PUT(putReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: true, targetUserId: 'member' }))
    expect(res.status).toBe(403)
    expectNothingWritten()
  })
})

describe('notification-preferences target — self path unchanged', () => {
  it('PUT with no targetUserId writes the caller’s own row (never touches membership)', async () => {
    h.getTrainerContext.mockResolvedValue(owner)
    const res = await PUT(putReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: true }))
    expect(res.status).toBe(200)
    expect(h.membershipFindUnique).not.toHaveBeenCalled()
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'actor', companyId: 'co1' }),
    }))
  })

  it('targetUserId equal to the caller is treated as self (no permission needed)', async () => {
    h.getTrainerContext.mockResolvedValue(staffNoPerm)
    const res = await PUT(putReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: true, targetUserId: 'actor' }))
    expect(res.status).toBe(200)
    expect(h.membershipFindUnique).not.toHaveBeenCalled()
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'actor' }),
    }))
  })

  it('GET with no userId reads the caller’s own rows', async () => {
    h.getTrainerContext.mockResolvedValue(owner)
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'actor' } }))
  })
})
