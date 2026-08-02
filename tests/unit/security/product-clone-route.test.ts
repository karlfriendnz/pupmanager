import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// POST /api/products/:productId/clone — duplicate one shop product. Two things
// matter: it must be the caller's own product, and the COPY must not go on sale
// to clients the instant the button is pressed.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    product: { findFirst: h.findFirst, updateMany: h.updateMany, create: h.create },
    $transaction: h.transaction,
  },
}))

import { POST } from '@/app/api/products/[productId]/clone/route'

const OWNER = { companyId: 'company-A', userId: 'u1', membershipId: 'm1', role: 'OWNER', permissions: {} }

const ORIGINAL = {
  id: 'p1',
  trainerId: 'company-A',
  name: 'Front-clip harness',
  description: '<p>Fits most</p>',
  kind: 'PHYSICAL',
  priceCents: 5400,
  salePriceCents: 4900,
  imageUrl: 'https://example.com/h.png',
  downloadUrl: null,
  category: 'Gear',
  categoryId: 'cat-1',
  xeroAccountCode: '200',
  requirePayment: true,
  featured: true,
  active: true,
  stockCount: 12,
  order: 3,
}

function call(productId = 'p1') {
  return POST(new Request('http://localhost/clone', { method: 'POST' }), {
    params: Promise.resolve({ productId }),
  })
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guardPermission.mockResolvedValue(OWNER)
  h.findFirst.mockResolvedValue(ORIGINAL)
  h.create.mockResolvedValue({ id: 'p-copy', name: 'Front-clip harness (copy)' })
  h.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({ product: { updateMany: h.updateMany, create: h.create } }),
  )
})

describe('POST /api/products/:productId/clone — permission and scoping', () => {
  it('hands back the guard’s own response and copies nothing', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expect(h.findFirst).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('is gated on products.manage', async () => {
    await call()
    expect(h.guardPermission).toHaveBeenCalledWith('products.manage')
  })

  it('looks the product up scoped to the caller’s own company', async () => {
    await call('p1')
    expect(h.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', trainerId: 'company-A' } })
  })

  it('404s on another trainer’s product, and creates nothing', async () => {
    h.findFirst.mockResolvedValue(null)
    const res = await call('theirs')
    expect(res.status).toBe(404)
    expect(h.create).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/products/:productId/clone — the copy', () => {
  it('carries the listing across', async () => {
    await call()
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'Front-clip harness (copy)',
        description: ORIGINAL.description,
        priceCents: 5400,
        salePriceCents: 4900,
        imageUrl: ORIGINAL.imageUrl,
        categoryId: 'cat-1',
        xeroAccountCode: '200',
        requirePayment: true,
      }),
    }))
  })

  it('is HIDDEN, however the original was set', async () => {
    // A duplicate is unfinished by definition. Publishing "… (copy)" to every
    // client the moment the button is pressed is worse than one extra tap.
    await call()
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ active: false, featured: false }),
    }))
  })

  it('does not inherit stock — that describes a thing on a shelf', async () => {
    await call()
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stockCount: null }),
    }))
  })

  it('lands directly below the original, shifting what was under it', async () => {
    await call()
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { trainerId: 'company-A', order: { gt: 3 } },
      data: { order: { increment: 1 } },
    })
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ order: 4 }),
    }))
    // One transaction — a failure between the two would leave two products
    // claiming the same position.
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })

  it('returns the copy’s id so the caller can open it', async () => {
    const res = await call()
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'p-copy', name: 'Front-clip harness (copy)' })
  })
})
