import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/trainer/finances/receivables — company-scoped, billing.view-guarded
// list. Focus: the optional clientId filter (client-profile view) and pageSize
// cap are applied on top of the trainerId scope.
const h = vi.hoisted(() => ({ guard: vi.fn(), count: vi.fn(), findMany: vi.fn(), xeroFindUnique: vi.fn() }))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { count: h.count, findMany: h.findMany },
    xeroConnection: { findUnique: h.xeroFindUnique },
  },
}))

import { GET } from '@/app/api/trainer/finances/receivables/route'
import { NextResponse } from 'next/server'

function req(qs = '') {
  return new Request(`http://x/api/trainer/finances/receivables${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ companyId: 't-1', role: 'OWNER', permissions: {} })
  h.count.mockResolvedValue(0)
  h.findMany.mockResolvedValue([])
  h.xeroFindUnique.mockResolvedValue(null)
})

describe('GET receivables list', () => {
  it('returns the guard response when billing.view is denied', async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('always scopes by the caller’s company', async () => {
    await GET(req())
    expect(h.findMany.mock.calls[0][0].where).toMatchObject({ trainerId: 't-1' })
    expect(h.findMany.mock.calls[0][0].where.clientId).toBeUndefined()
  })

  it('adds a clientId filter when provided (client-profile view)', async () => {
    await GET(req('?clientId=cp-9'))
    expect(h.findMany.mock.calls[0][0].where).toMatchObject({ trainerId: 't-1', clientId: 'cp-9' })
    expect(h.count.mock.calls[0][0].where).toMatchObject({ trainerId: 't-1', clientId: 'cp-9' })
  })

  it('caps pageSize at 100', async () => {
    await GET(req('?pageSize=500'))
    expect(h.findMany.mock.calls[0][0].take).toBe(100)
  })

  it('defaults pageSize to 20', async () => {
    await GET(req())
    expect(h.findMany.mock.calls[0][0].take).toBe(20)
  })
})
