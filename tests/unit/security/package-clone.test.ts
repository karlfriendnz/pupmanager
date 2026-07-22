import { describe, it, expect, vi, beforeEach } from 'vitest'

// Cloning takes an id from the URL, so it must prove the package belongs to the
// caller's business — otherwise a trainer could copy a competitor's programme
// (name, price, structure) straight into their own catalogue.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: { package: { findFirst: h.findFirst, count: h.count, create: h.create } },
}))

import { POST } from '@/app/api/packages/[packageId]/clone/route'

const SRC = {
  id: 'pkg_1', trainerId: 'tr_me', name: 'Puppy Foundations',
  description: 'Six weeks of basics', sessionCount: 6, weeksBetween: 1,
  durationMins: 60, bufferMins: 15, sessionType: 'IN_PERSON',
  priceCents: 45000, specialPriceCents: null, color: 'teal',
  defaultSessionFormId: 'form_1', requireSessionNotes: true, isGroup: true,
  capacity: 8, allowDropIn: true, dropInPriceCents: 2500, allowWaitlist: true,
  publicEnrollment: false, clientSelfBook: true, selfBookRequiresApproval: false,
  requirePayment: true, order: 3, xeroAccountCode: '200',
}

const call = () =>
  POST(new Request('http://localhost/api/packages/pkg_1/clone', { method: 'POST' }),
       { params: Promise.resolve({ packageId: 'pkg_1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue(undefined)
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u_me', trainerId: 'tr_me' } })
  h.findFirst.mockResolvedValue(SRC)
  h.count.mockResolvedValue(0)
  h.create.mockImplementation(async ({ data }) => ({ id: 'pkg_new', name: data.name }))
})

describe('POST /api/packages/[packageId]/clone', () => {
  it('scopes the lookup to the caller’s own business', async () => {
    await call()
    expect(h.findFirst).toHaveBeenCalledWith({ where: { id: 'pkg_1', trainerId: 'tr_me' } })
  })

  it("404s on another business's package", async () => {
    h.findFirst.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('copies the template settings across', async () => {
    await call()
    const data = h.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      trainerId: 'tr_me',
      sessionCount: 6, weeksBetween: 1, durationMins: 60, bufferMins: 15,
      priceCents: 45000, isGroup: true, capacity: 8,
      allowDropIn: true, dropInPriceCents: 2500, allowWaitlist: true,
      clientSelfBook: true, requirePayment: true,
      description: 'Six weeks of basics',
    })
  })

  // Income mapping should be a conscious choice, not silently inherited.
  it('does NOT carry the Xero account code over', async () => {
    await call()
    expect(h.create.mock.calls[0][0].data.xeroAccountCode).toBeUndefined()
  })

  it('names the first copy "(copy)"', async () => {
    await call()
    expect(h.create.mock.calls[0][0].data.name).toBe('Puppy Foundations (copy)')
  })

  it('numbers later copies so they never collide', async () => {
    h.count.mockResolvedValue(2)
    await call()
    expect(h.create.mock.calls[0][0].data.name).toBe('Puppy Foundations (copy 3)')
  })

  it('rejects an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('rejects a trainer with no business', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u', trainerId: null } })
    expect((await call()).status).toBe(403)
    expect(h.create).not.toHaveBeenCalled()
  })
})
