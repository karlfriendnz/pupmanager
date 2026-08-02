import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// GET/POST /api/products/:productId/stock — one product's stock and its history.
//
// This route is more sensitive than the count it moves: every movement can name
// the CLIENT it went to, so a ledger fetched by product id alone would be a list
// of another business's customers. Every query is scoped to guard.companyId, and
// the guard's own response is handed straight back.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  auth: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  transaction: vi.fn(),
  addStock: vi.fn(),
  adjustStock: vi.fn(),
  setStockCount: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    product: { findFirst: h.findFirst },
    stockMovement: { findMany: h.findMany },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/stock', () => ({
  addStock: h.addStock,
  adjustStock: h.adjustStock,
  setStockCount: h.setStockCount,
}))

import { GET, POST } from '@/app/api/products/[productId]/stock/route'

const OWNER = { companyId: 'company-A', userId: 'u1', membershipId: 'm1', role: 'OWNER', permissions: {} }

function post(body: unknown, productId = 'p1') {
  return POST(
    new Request('http://localhost/stock', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ productId }) },
  )
}

function get(productId = 'p1') {
  return GET(new Request('http://localhost/stock'), { params: Promise.resolve({ productId }) })
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guardPermission.mockResolvedValue(OWNER)
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.findFirst.mockResolvedValue({ id: 'p1', stockCount: 12 })
  h.findMany.mockResolvedValue([])
  h.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn({}))
  h.addStock.mockResolvedValue(18)
  h.adjustStock.mockResolvedValue(9)
  h.setStockCount.mockResolvedValue(9)
})

describe('permission and tenant scope', () => {
  it('hands back the guard’s own response and reads nothing', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await get()
    expect(res.status).toBe(403)
    expect(h.findFirst).not.toHaveBeenCalled()
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('is gated on products.manage, both ways', async () => {
    await get()
    await post({ quantity: 1, reason: 'RECEIVED' })
    expect(h.guardPermission).toHaveBeenCalledWith('products.manage')
    expect(h.guardPermission).toHaveBeenCalledTimes(2)
  })

  it('looks the product up scoped to the caller’s own company', async () => {
    await get('p1')
    expect(h.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1', trainerId: 'company-A' },
    }))
  })

  it('scopes the history to the company too, not just the product', async () => {
    // Belt and braces: the product check already proves ownership, but a
    // movement row carries a client name and must never be reachable by id.
    await get('p1')
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId: 'p1', trainerId: 'company-A' },
    }))
  })

  it('404s on another trainer’s product and moves nothing', async () => {
    h.findFirst.mockResolvedValue(null)
    const res = await post({ quantity: 5, reason: 'RECEIVED' }, 'theirs')
    expect(res.status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.findMany).not.toHaveBeenCalled()
  })
})

describe('the reason decides the direction', () => {
  it('a delivery adds', async () => {
    await post({ quantity: 6, reason: 'RECEIVED', note: 'Wholesaler' })
    expect(h.addStock).toHaveBeenCalledWith({}, 'p1', 6, expect.objectContaining({
      reason: 'RECEIVED', note: 'Wholesaler', userId: 'u1',
    }))
  })

  it('a breakage subtracts, whatever sign was sent', async () => {
    // The client sends a magnitude; a signed number plus a separate reason is
    // two ways to say the same thing and they can disagree.
    await post({ quantity: 3, reason: 'DAMAGED' })
    expect(h.adjustStock).toHaveBeenCalledWith({}, 'p1', expect.objectContaining({
      delta: -3, reason: 'DAMAGED',
    }))
  })

  it('a count SETS the number rather than adding it', async () => {
    await post({ quantity: 9, reason: 'CORRECTION', note: 'Counted the box' })
    expect(h.setStockCount).toHaveBeenCalledWith({}, 'p1', 9, expect.objectContaining({
      note: 'Counted the box', userId: 'u1',
    }))
  })

  it('rejects a reason that is not one of the six', async () => {
    const res = await post({ quantity: 1, reason: 'BORROWED' })
    expect(res.status).toBe(400)
    expect(h.transaction).not.toHaveBeenCalled()
  })
})

describe('untracked products', () => {
  it('refuses to add to a product that is not counted', async () => {
    // NULL means "I never run out of this". Adding six to that is meaningless.
    h.findFirst.mockResolvedValue({ id: 'p1', stockCount: null })
    const res = await post({ quantity: 6, reason: 'RECEIVED' })
    expect(res.status).toBe(409)
    expect(h.addStock).not.toHaveBeenCalled()
  })

  it('lets a correction START the counting — that is how tracking is turned on', async () => {
    h.findFirst.mockResolvedValue({ id: 'p1', stockCount: null })
    h.setStockCount.mockResolvedValue(12)
    const res = await post({ quantity: 12, reason: 'CORRECTION' })
    expect(res.status).toBe(200)
    expect(h.setStockCount).toHaveBeenCalledWith({}, 'p1', 12, expect.anything())
  })
})

describe('what comes back', () => {
  it('returns the new balance and the refreshed history in one response', async () => {
    // So the sheet never has to make a second round trip to look right.
    h.findMany.mockResolvedValue([{
      id: 'm1', delta: 6, reason: 'RECEIVED', note: null, balanceAfter: 18,
      createdAt: new Date('2026-08-02T00:00:00Z'), client: null, user: { name: 'Karl' },
    }])
    const res = await post({ quantity: 6, reason: 'RECEIVED' })
    expect(await res.json()).toEqual({
      stockCount: 18,
      movements: [expect.objectContaining({ delta: 6, balanceAfter: 18, userName: 'Karl', clientName: null })],
    })
  })
})
