import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/clients — the searchable client list behind pickers (the
// instant-sale composer's "who's this for?" step).
//
// The risk this covers: it deliberately does NOT require `clients.viewAll`
// (that would lock out every staff member), so the ONLY thing keeping a
// restricted staff member from listing the whole company's clients is the
// scopeForMember narrowing. These tests pin that down, plus tenant scoping.
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  scopeForMember: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({
  getTrainerContext: h.getTrainerContext,
  scopeForMember: h.scopeForMember,
  guardPermission: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { clientProfile: { findMany: h.findMany } } }))
// Imported at module load by the POST half of this route; GET never calls them.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(), fromTrainer: vi.fn() }))
vi.mock('@/lib/client-invite-email', () => ({ renderClientInviteEmail: vi.fn() }))
vi.mock('@/lib/slug', () => ({ ensureTrainerSlug: vi.fn(), clientInviteUrl: vi.fn() }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: vi.fn() }))
vi.mock('@/lib/client-upsert', () => ({ findOrJoinClient: vi.fn() }))

import { GET } from '@/app/api/clients/route'

const req = (url = 'https://app.pupmanager.com/api/clients') => new Request(url)

const row = (over: Record<string, unknown> = {}) => ({
  id: 'cl_1',
  isSample: false,
  user: { name: 'Sarah' },
  dog: { name: 'Bailey', photoUrl: 'https://img/bailey.jpg' },
  dogs: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.getTrainerContext.mockResolvedValue({
    userId: 'u_1', companyId: 'co_1', membershipId: 'mem_1', role: 'OWNER', permissions: null,
  })
  h.scopeForMember.mockReturnValue({})
  h.findMany.mockResolvedValue([row()])
})

describe('GET /api/clients — auth', () => {
  it('401s when there is no trainer context, without querying', async () => {
    h.getTrainerContext.mockResolvedValue(null)

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(h.findMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/clients — scoping', () => {
  it('always scopes to the caller’s own company', async () => {
    h.getTrainerContext.mockResolvedValue({
      userId: 'u_9', companyId: 'co_99', membershipId: 'mem_9', role: 'OWNER', permissions: null,
    })

    await GET(req())

    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ trainerId: 'co_99' }) }),
    )
  })

  it('applies the member scope so restricted staff see only assigned clients', async () => {
    // What scopeForMember returns for a staff member without clients.viewAll.
    h.scopeForMember.mockReturnValue({ assignedMembershipId: 'mem_staff' })

    await GET(req())

    expect(h.scopeForMember).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'co_1' }),
      'clients.viewAll',
    )
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignedMembershipId: 'mem_staff' }),
      }),
    )
  })

  it('does not narrow by assignment for a member with clients.viewAll', async () => {
    h.scopeForMember.mockReturnValue({})

    await GET(req())

    const { where } = h.findMany.mock.calls[0][0]
    expect(where).not.toHaveProperty('assignedMembershipId')
  })

  it('lists only ACTIVE clients', async () => {
    await GET(req())

    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }),
    )
  })

  it('caps the result set rather than returning every client', async () => {
    await GET(req())

    expect(h.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(20)
  })
})

describe('GET /api/clients — search + shape', () => {
  it('filters by client name or dog name when q is given', async () => {
    await GET(req('https://app.pupmanager.com/api/clients?q=bail'))

    const { where } = h.findMany.mock.calls[0][0]
    expect(where.OR).toEqual([
      { user: { is: { name: { contains: 'bail', mode: 'insensitive' } } } },
      { dog: { is: { name: { contains: 'bail', mode: 'insensitive' } } } },
    ])
  })

  it('omits the search filter entirely when q is blank', async () => {
    await GET(req('https://app.pupmanager.com/api/clients?q=%20%20'))

    expect(h.findMany.mock.calls[0][0].where).not.toHaveProperty('OR')
  })

  it('hides seeded sample clients from the picker', async () => {
    h.findMany.mockResolvedValue([row(), row({ id: 'cl_demo', isSample: true })])

    const res = await GET(req())
    const body = await res.json()

    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('cl_1')
  })

  it('returns the picker row shape, falling back to the first extra dog', async () => {
    h.findMany.mockResolvedValue([
      row({ dog: null, dogs: [{ name: 'Rex', photoUrl: 'https://img/rex.jpg' }] }),
    ])

    const body = await (await GET(req())).json()

    expect(body.items[0]).toEqual({
      id: 'cl_1',
      name: 'Sarah',
      dogName: 'Rex',
      dogPhotoUrl: 'https://img/rex.jpg',
    })
  })

  it('tolerates a client with no dog at all', async () => {
    h.findMany.mockResolvedValue([row({ dog: null, dogs: [] })])

    const body = await (await GET(req())).json()

    expect(body.items[0]).toMatchObject({ dogName: null, dogPhotoUrl: null })
  })
})
