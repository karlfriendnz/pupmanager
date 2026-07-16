import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Tenant-scoping guard for the "link in bio" editor API. A trainer must never
// be able to read or patch ANOTHER trainer's LinkPage:
//   - every DB access is keyed on guard.companyId (the caller's own business),
//   - a `trainerId` (or `linkPageId`) smuggled in the body is ignored, because
//     the route derives the target solely from the authenticated context.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  requireSameOrigin: vi.fn((): Response | null => null),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: h.requireSameOrigin }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    linkPage: { findUnique: h.findUnique, upsert: h.upsert },
    linkPageButton: { deleteMany: h.deleteMany, createMany: h.createMany },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        linkPage: { upsert: h.upsert, findUnique: h.findUnique },
        linkPageButton: { deleteMany: h.deleteMany, createMany: h.createMany },
      }),
  },
}))

import { GET, PATCH } from '@/app/api/trainer/link-page/route'

function patchReq(body: unknown) {
  return new Request('http://localhost/api/trainer/link-page', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSameOrigin.mockReturnValue(null)
  h.upsert.mockResolvedValue({ id: 'lp-me', trainerId: 'me' })
  h.deleteMany.mockResolvedValue({ count: 0 })
  h.createMany.mockResolvedValue({ count: 0 })
  h.findUnique.mockResolvedValue({ id: 'lp-me', trainerId: 'me', links: [] })
})

describe('link-page tenant scoping', () => {
  it('GET reads only the caller’s own link page', async () => {
    h.guardPermission.mockResolvedValue({ userId: 'u', companyId: 'me', membershipId: 'm', role: 'OWNER', permissions: {} })
    await GET()
    expect(h.findUnique).toHaveBeenCalledWith({
      where: { trainerId: 'me' },
      include: { links: { orderBy: { order: 'asc' } } },
    })
  })

  it('PATCH upserts under the caller’s company and ignores a smuggled trainerId', async () => {
    h.guardPermission.mockResolvedValue({ userId: 'u', companyId: 'me', membershipId: 'm', role: 'OWNER', permissions: {} })
    await PATCH(patchReq({ trainerId: 'victim', linkPageId: 'lp-victim', showBooking: false, links: [] }))

    // Target is derived from the auth context, never the body.
    const call = h.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ trainerId: 'me' })
    expect(call.create.trainerId).toBe('me')
    // The smuggled fields never reach the write payload.
    expect(JSON.stringify(call)).not.toContain('victim')
  })

  it('PATCH is refused for a member without settings.edit', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await PATCH(patchReq({ showBooking: false }))
    expect(res.status).toBe(403)
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.deleteMany).not.toHaveBeenCalled()
  })
})
