import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// POST /api/library/types/reorder — the order the Library's categories appear
// in. It writes to every id it is handed, so the whole security question is
// "are they all yours": a list mixing one of someone else's category ids must
// write NOTHING, not reorder the caller's own and quietly skip the stranger.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    libraryType: { count: h.count, update: h.update },
    $transaction: h.transaction,
  },
}))

import { POST } from '@/app/api/library/types/reorder/route'

const OWNER = { companyId: 'company-A', userId: 'u1', membershipId: 'm1', role: 'OWNER', permissions: {} }

function req(body: unknown) {
  return new Request('http://localhost/api/library/types/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guardPermission.mockResolvedValue(OWNER)
  h.update.mockImplementation((args: unknown) => args)
  h.transaction.mockResolvedValue([])
})

describe('POST /api/library/types/reorder — permission', () => {
  it('hands back the guard’s own response and writes nothing', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(req({ ids: ['t1', 't2'] }))
    expect(res.status).toBe(403)
    expect(h.count).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('is gated on forms.manage, the same permission that creates a category', async () => {
    await POST(req({ ids: ['t1'] }))
    expect(h.guardPermission).toHaveBeenCalledWith('forms.manage')
  })
})

describe('POST /api/library/types/reorder — input', () => {
  it('rejects a body that is not a list of ids', async () => {
    const res = await POST(req({ ids: 't1' }))
    expect(res.status).toBe(400)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('rejects an empty list', async () => {
    const res = await POST(req({ ids: [] }))
    expect(res.status).toBe(400)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('rejects duplicate ids rather than letting one row win twice', async () => {
    const res = await POST(req({ ids: ['t1', 't1', 't2'] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Duplicate ids' })
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('survives a body that is not JSON at all', async () => {
    const bad = new Request('http://localhost/api/library/types/reorder', { method: 'POST', body: 'not json' })
    const res = await POST(bad)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/library/types/reorder — tenant scoping', () => {
  it('checks ownership against the caller’s own company', async () => {
    h.count.mockResolvedValue(2)
    await POST(req({ ids: ['t1', 't2'] }))
    expect(h.count).toHaveBeenCalledWith({
      where: { id: { in: ['t1', 't2'] }, trainerId: 'company-A' },
    })
  })

  it('writes nothing when one id belongs to another trainer', async () => {
    // Two asked for, one owned — the borrowed id must poison the whole request.
    h.count.mockResolvedValue(1)
    const res = await POST(req({ ids: ['mine', 'theirs'] }))
    expect(res.status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe('POST /api/library/types/reorder — the write', () => {
  it('saves each id at its index, in one transaction', async () => {
    h.count.mockResolvedValue(3)
    const res = await POST(req({ ids: ['c', 'a', 'b'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    expect(h.update).toHaveBeenNthCalledWith(1, { where: { id: 'c' }, data: { order: 0 } })
    expect(h.update).toHaveBeenNthCalledWith(2, { where: { id: 'a' }, data: { order: 1 } })
    expect(h.update).toHaveBeenNthCalledWith(3, { where: { id: 'b' }, data: { order: 2 } })

    // One transaction, not three loose writes — a half-applied order would
    // leave two categories claiming the same position.
    expect(h.transaction).toHaveBeenCalledTimes(1)
    expect(h.transaction.mock.calls[0]![0]).toHaveLength(3)
  })
})
