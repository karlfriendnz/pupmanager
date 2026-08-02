import { describe, it, expect, vi, beforeEach } from 'vitest'

// Saving a variant's own notes.
//
// NULL is the value that means "inherit the product's description", so the one
// thing this route must get right is that an EMPTIED editor lands as NULL. A
// trainer who types notes on the Medium and then deletes them leaves `<p></p>`
// behind — Tiptap's empty document — and storing that would override the
// product's blurb with a blank on the client's shop while the trainer's screen
// showed nothing wrong.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  productFindFirst: vi.fn(),
  variantFindMany: vi.fn(),
  deleteMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: vi.fn().mockResolvedValue({ user: { id: 'user_1' } }) }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/stock', () => ({ recordOpeningBalance: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    product: { findFirst: h.productFindFirst },
    productVariant: { findMany: h.variantFindMany },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        productVariant: { deleteMany: h.deleteMany, update: h.update, create: h.create },
      }),
  },
}))

import { PUT } from '@/app/api/products/[productId]/variants/route'

const PRODUCT = 'prod_1'
const TRAINER = 'trainer_1'
const VARIANT = 'v_medium'

const put = (variants: Record<string, unknown>[]) =>
  PUT(
    new Request(`https://app.pupmanager.com/api/products/${PRODUCT}/variants`, {
      method: 'PUT',
      body: JSON.stringify({ variants }),
    }),
    { params: Promise.resolve({ productId: PRODUCT }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ companyId: TRAINER })
  h.productFindFirst.mockResolvedValue({
    id: PRODUCT, trainerId: TRAINER, priceCents: 4500, salePriceCents: null,
  })
  // First call: the existing rows for reconciliation. Second: what is returned.
  h.variantFindMany.mockResolvedValue([{ id: VARIANT, stockCount: 3 }])
  h.create.mockResolvedValue({ id: 'v_new', stockCount: null })
})

describe('PUT /api/products/[productId]/variants — description', () => {
  it('stores the notes a trainer wrote for one option', async () => {
    await put([{ id: VARIANT, name: 'Medium', description: '<p>Fits 12–18kg.</p>' }])
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: VARIANT },
        data: expect.objectContaining({ description: '<p>Fits 12–18kg.</p>' }),
      }),
    )
  })

  it('stores an EMPTIED editor as NULL, so it goes back to inheriting', async () => {
    await put([{ id: VARIANT, name: 'Medium', description: '<p></p>' }])
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ description: null }) }),
    )
  })

  it('an ABSENT key leaves the notes alone — saving a rename must not wipe them', async () => {
    await put([{ id: VARIANT, name: 'Medium (wide)' }])
    const data = h.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('description')
    expect(data).not.toHaveProperty('imageUrl')
  })

  it('carries the photo and the notes onto a brand-new option', async () => {
    await put([{
      name: 'Red · Large',
      imageUrl: 'https://blob.example/red.jpg',
      description: '<p>Deep chest.</p>',
    }])
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imageUrl: 'https://blob.example/red.jpg',
          description: '<p>Deep chest.</p>',
          trainerId: TRAINER,
        }),
      }),
    )
  })

  it('refuses another business’s product before it writes anything', async () => {
    h.productFindFirst.mockResolvedValue(null)
    const res = await put([{ id: VARIANT, name: 'Medium', description: '<p>x</p>' }])
    expect(res.status).toBe(404)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })
})
