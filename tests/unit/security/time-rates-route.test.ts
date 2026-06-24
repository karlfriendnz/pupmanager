import { describe, it, expect, vi, beforeEach } from 'vitest'

// Time rates are company-wide config: any member may READ, but only the OWNER
// may create/edit/archive. Mutations are tenant-scoped via where:{companyId}.

const h = vi.hoisted(() => ({
  ctx: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.ctx }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    timeRate: {
      findMany: h.findMany,
      create: h.create,
      updateMany: h.updateMany,
      findUnique: h.findUnique,
    },
  },
}))

import { GET, POST } from '@/app/api/time-rates/route'
import { PATCH, DELETE } from '@/app/api/time-rates/[id]/route'

const OWNER = { userId: 'u1', companyId: 'co1', membershipId: 'm1', role: 'OWNER', permissions: {} }
const STAFF = { userId: 'u2', companyId: 'co1', membershipId: 'm2', role: 'STAFF', permissions: {} }

function p(id: string) {
  return { params: Promise.resolve({ id }) }
}
function jreq(body: unknown, method = 'POST') {
  return new Request('https://app.pupmanager.com/api/x', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
})

describe('time-rates GET — any authenticated member may read', () => {
  it('401 for an unauthenticated caller, no query', async () => {
    h.ctx.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('staff CAN read, scoped to their company and non-archived', async () => {
    h.ctx.mockResolvedValue(STAFF)
    h.findMany.mockResolvedValue([])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co1', archivedAt: null } }),
    )
  })
})

describe('time-rates POST — owner only', () => {
  it('401 unauthenticated', async () => {
    h.ctx.mockResolvedValue(null)
    const res = await POST(jreq({ name: 'X', rateCents: 8000 }))
    expect(res.status).toBe(401)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('403 for a non-owner (staff) and does NOT create', async () => {
    h.ctx.mockResolvedValue(STAFF)
    const res = await POST(jreq({ name: 'X', rateCents: 8000 }))
    expect(res.status).toBe(403)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('owner creates a rate, companyId forced from context (mass-assignment ignored)', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.create.mockResolvedValue({ id: 'r1', name: 'X', rateCents: 8000, sortOrder: 0 })
    const res = await POST(jreq({ name: 'X', rateCents: 8000, companyId: 'EVIL' }))
    expect(res.status).toBe(200)
    expect(h.create.mock.calls[0][0].data.companyId).toBe('co1')
  })

  it('rejects an invalid rate body with 400', async () => {
    h.ctx.mockResolvedValue(OWNER)
    const res = await POST(jreq({ name: '', rateCents: -5 }))
    expect(res.status).toBe(400)
    expect(h.create).not.toHaveBeenCalled()
  })
})

describe('time-rates PATCH — owner only + tenant scope', () => {
  it('403 for staff', async () => {
    h.ctx.mockResolvedValue(STAFF)
    const res = await PATCH(jreq({ name: 'New' }, 'PATCH'), p('r1'))
    expect(res.status).toBe(403)
    expect(h.updateMany).not.toHaveBeenCalled()
  })

  it('404 when the rate belongs to another tenant (updateMany count 0)', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.updateMany.mockResolvedValue({ count: 0 })
    const res = await PATCH(jreq({ name: 'New' }, 'PATCH'), p('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'FOREIGN', companyId: 'co1' } }),
    )
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it('owner edits an owned rate', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.updateMany.mockResolvedValue({ count: 1 })
    h.findUnique.mockResolvedValue({ id: 'r1', name: 'New', rateCents: 9000, sortOrder: 0 })
    const res = await PATCH(jreq({ name: 'New' }, 'PATCH'), p('r1'))
    expect(res.status).toBe(200)
  })
})

describe('time-rates DELETE — owner only soft-delete', () => {
  it('403 for staff', async () => {
    h.ctx.mockResolvedValue(STAFF)
    const res = await DELETE(jreq({}, 'DELETE'), p('r1'))
    expect(res.status).toBe(403)
    expect(h.updateMany).not.toHaveBeenCalled()
  })

  it('404 cross-tenant (count 0), tenant-scoped where', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.updateMany.mockResolvedValue({ count: 0 })
    const res = await DELETE(jreq({}, 'DELETE'), p('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'FOREIGN', companyId: 'co1', archivedAt: null } }),
    )
  })

  it('owner archives (soft-deletes) an owned rate', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.updateMany.mockResolvedValue({ count: 1 })
    const res = await DELETE(jreq({}, 'DELETE'), p('r1'))
    expect(res.status).toBe(200)
    expect(h.updateMany.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date)
  })
})
