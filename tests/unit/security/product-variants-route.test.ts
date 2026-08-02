import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// PUT /api/products/:productId/variants — the whole option list at once.
//
// Three things this has to get right, in order of how badly they hurt:
//   1. TENANT SCOPE. Another business's product is a 404, and nothing is
//      written for it.
//   2. THE LEDGER OWNS THE COUNT. An existing option's stockCount is never
//      patched here — it moves through the stock sheet, which asks what
//      happened. A NEW option opens its ledger at whatever it was born with.
//   3. Reconciliation: rows dropped from the list are deleted, the rest are
//      renumbered into the order they were dragged into.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  auth: vi.fn(),
  productFindFirst: vi.fn(),
  variantFindMany: vi.fn(),
  variantUpdate: vi.fn(),
  variantCreate: vi.fn(),
  variantDeleteMany: vi.fn(),
  transaction: vi.fn(),
  recordOpeningBalance: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/stock', () => ({ recordOpeningBalance: h.recordOpeningBalance }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    product: { findFirst: h.productFindFirst },
    productVariant: { findMany: h.variantFindMany },
    $transaction: h.transaction,
  },
}))

import { PUT } from '@/app/api/products/[productId]/variants/route'

const OWNER = { companyId: 'company-A', userId: 'u1', membershipId: 'm1', role: 'OWNER', permissions: {} }

const PRODUCT = { id: 'p1', trainerId: 'company-A', priceCents: 4500, salePriceCents: null }

function call(variants: unknown[], productId = 'p1') {
  return PUT(
    new Request('http://localhost/variants', { method: 'PUT', body: JSON.stringify({ variants }) }),
    { params: Promise.resolve({ productId }) },
  )
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guardPermission.mockResolvedValue(OWNER)
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.productFindFirst.mockResolvedValue(PRODUCT)
  h.variantFindMany.mockResolvedValue([])
  h.variantCreate.mockImplementation(({ data }: { data: { stockCount: number | null } }) =>
    Promise.resolve({ id: 'v_new', stockCount: data.stockCount ?? null }),
  )
  h.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      productVariant: {
        update: h.variantUpdate,
        create: h.variantCreate,
        deleteMany: h.variantDeleteMany,
      },
    }),
  )
})

describe('PUT /api/products/:productId/variants — scoping', () => {
  it('is gated on products.manage', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call([])).status).toBe(403)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('404s on another business’s product and writes nothing', async () => {
    h.productFindFirst.mockResolvedValue(null)
    expect((await call([{ name: 'Large' }])).status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('looks the product up scoped to the caller’s own company', async () => {
    await call([])
    expect(h.productFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1', trainerId: 'company-A' } }),
    )
  })
})

describe('PUT /api/products/:productId/variants — writing the list', () => {
  it('creates new rows in the order they were sent', async () => {
    await call([{ name: 'Small' }, { name: 'Large' }])
    expect(h.variantCreate).toHaveBeenCalledTimes(2)
    expect(h.variantCreate.mock.calls[0][0].data).toMatchObject({ name: 'Small', order: 0, productId: 'p1', trainerId: 'company-A' })
    expect(h.variantCreate.mock.calls[1][0].data).toMatchObject({ name: 'Large', order: 1 })
  })

  it('a new option born with a count opens its ledger at that number', async () => {
    // Without this the movements sum to 0 against a shelf holding six, from
    // day one — the exact drift the ledger exists to expose.
    await call([{ name: 'Small', stockCount: 6 }])
    expect(h.recordOpeningBalance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: 'p1', variantId: 'v_new', units: 6 }),
    )
  })

  it('an untracked new option writes no opening line — there is no balance to describe', async () => {
    await call([{ name: 'Small' }])
    expect(h.recordOpeningBalance).not.toHaveBeenCalled()
  })

  it('NEVER patches an existing option’s count — the ledger owns it', async () => {
    h.variantFindMany.mockResolvedValueOnce([{ id: 'v1', stockCount: 12 }])
    await call([{ id: 'v1', name: 'Small', stockCount: 3 }])
    expect(h.variantUpdate).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: expect.objectContaining({ name: 'Small' }),
    })
    expect(h.variantUpdate.mock.calls[0][0].data).not.toHaveProperty('stockCount')
  })

  it('deletes the rows dropped from the list', async () => {
    h.variantFindMany.mockResolvedValueOnce([{ id: 'v1', stockCount: null }, { id: 'v2', stockCount: null }])
    await call([{ id: 'v1', name: 'Small' }])
    expect(h.variantDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['v2'] }, productId: 'p1' } })
  })

  it('an id from another product is treated as NEW, never as an update', async () => {
    // known ids come from this product's own rows, so a stranger's id can only
    // ever create — it can never reach into someone else's variant.
    h.variantFindMany.mockResolvedValueOnce([])
    await call([{ id: 'v_elsewhere', name: 'Large' }])
    expect(h.variantUpdate).not.toHaveBeenCalled()
    expect(h.variantCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses a sale price that doesn’t undercut the price it inherits', async () => {
    const res = await call([{ name: 'Large', salePriceCents: 5000 }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Large/)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('allows a sale price under the variant’s OWN price', async () => {
    expect((await call([{ name: 'Large', priceCents: 6000, salePriceCents: 5000 }])).status).toBe(200)
  })

  it('an empty list clears every option — the product goes back to being one thing', async () => {
    h.variantFindMany.mockResolvedValueOnce([{ id: 'v1', stockCount: null }])
    await call([])
    expect(h.variantDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['v1'] }, productId: 'p1' } })
    expect(h.variantCreate).not.toHaveBeenCalled()
  })
})
