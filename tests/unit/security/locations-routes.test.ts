import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant + ownership guards on the reusable-locations library routes. Every
// route resolves the caller via getTrainerContext (membership-aware) and scopes
// Prisma by companyId, so a trainer can only read/create/update/delete their own
// locations. We mock the context + each Prisma method and assert real status
// codes + that no mutation happens cross-tenant.

const h = vi.hoisted(() => ({
  ctx: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))

// guardPermission is the only membership export the routes use; it delegates to
// getTrainerContext internally, so we stub it to return the mocked context (or a
// 401 NextResponse when unauthenticated) exactly like the real helper.
vi.mock('@/lib/membership', async () => {
  const { NextResponse } = await import('next/server')
  return {
    guardPermission: async () => {
      const ctx = await h.ctx()
      if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
      return ctx
    },
  }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    location: {
      findMany: h.findMany,
      findFirst: h.findFirst,
      create: h.create,
      update: h.update,
      delete: h.delete,
    },
  },
}))

import { GET, POST } from '@/app/api/trainer/locations/route'
import { PATCH, DELETE } from '@/app/api/trainer/locations/[id]/route'

const OWNER = { userId: 'u1', companyId: 'co1', membershipId: 'm1', role: 'OWNER', permissions: {} }

const idParams = (id: string) => ({ params: Promise.resolve({ id }) })
const jsonReq = (body: unknown, method = 'POST') =>
  new Request('https://app.pupmanager.com/api/trainer/locations', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
const plain = (method: string) => new Request('https://app.pupmanager.com/api/trainer/locations', { method })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.findMany.mockResolvedValue([])
  h.findFirst.mockResolvedValue(null)
  h.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'l1', ...data }))
})

describe('locations list/create — authentication', () => {
  it('GET returns 401 for an unauthenticated caller and queries nothing', async () => {
    h.ctx.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('GET scopes the list to the caller company only', async () => {
    h.ctx.mockResolvedValue(OWNER)
    await GET()
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trainerId: 'co1' } }),
    )
  })

  it('POST returns 401 when unauthenticated and creates nothing', async () => {
    h.ctx.mockResolvedValue(null)
    const res = await POST(jsonReq({ name: 'Field' }))
    expect(res.status).toBe(401)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('POST stamps the caller company and ignores a smuggled trainerId', async () => {
    h.ctx.mockResolvedValue(OWNER)
    const res = await POST(jsonReq({ name: 'The field', trainerId: 'EVIL' }))
    expect(res.status).toBe(201)
    const arg = h.create.mock.calls[0][0]
    expect(arg.data.trainerId).toBe('co1')
    expect(arg.data.name).toBe('The field')
  })

  it('POST rejects an empty name with 400', async () => {
    h.ctx.mockResolvedValue(OWNER)
    const res = await POST(jsonReq({ name: '' }))
    expect(res.status).toBe(400)
    expect(h.create).not.toHaveBeenCalled()
  })
})

describe('locations detail — cross-tenant ownership', () => {
  it('PATCH on another company location → 404, scoped by companyId, no update', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.findFirst.mockResolvedValue(null) // {id, trainerId:co1} matched nothing → foreign row
    const res = await PATCH(jsonReq({ name: 'pwned' }, 'PATCH'), idParams('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'FOREIGN', trainerId: 'co1' } }),
    )
    expect(h.update).not.toHaveBeenCalled()
  })

  it('DELETE on another company location → 404 and nothing removed', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.findFirst.mockResolvedValue(null)
    const res = await DELETE(plain('DELETE'), idParams('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.delete).not.toHaveBeenCalled()
  })

  it('PATCH/DELETE return 401 when unauthenticated, before any DB read', async () => {
    h.ctx.mockResolvedValue(null)
    expect((await PATCH(jsonReq({ name: 'x' }, 'PATCH'), idParams('l1'))).status).toBe(401)
    expect((await DELETE(plain('DELETE'), idParams('l1'))).status).toBe(401)
    expect(h.findFirst).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
    expect(h.delete).not.toHaveBeenCalled()
  })

  it('PATCH succeeds (200) on an owned location', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.findFirst.mockResolvedValue({ id: 'l1' })
    h.update.mockResolvedValue({ id: 'l1', name: 'New name' })
    const res = await PATCH(jsonReq({ name: 'New name' }, 'PATCH'), idParams('l1'))
    expect(res.status).toBe(200)
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'l1' } }))
  })

  it('DELETE succeeds on an owned location', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.findFirst.mockResolvedValue({ id: 'l1' })
    h.delete.mockResolvedValue({})
    const res = await DELETE(plain('DELETE'), idParams('l1'))
    expect(res.status).toBe(200)
    expect(h.delete).toHaveBeenCalledWith({ where: { id: 'l1' } })
  })
})
