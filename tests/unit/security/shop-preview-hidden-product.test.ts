import { describe, it, expect, vi, beforeEach } from 'vitest'

// Previewing a product a trainer hasn't published yet.
//
// The feature deliberately reaches PAST the one filter that hides unfinished
// work from clients (`active: true` on the shop query), so the tests that
// matter are the ones that prove the hole is exactly one product wide:
//
//   1. the OWNER, in preview, can read their own hidden product;
//   2. a REAL CLIENT asking for the same id gets nothing — the shop never even
//      runs the query;
//   3. another trainer's product is not found, previewing or not.

const h = vi.hoisted(() => ({ findMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { product: { findMany: h.findMany } },
}))

import { listShopProducts, loadPreviewOnlyProduct } from '@/lib/shop-catalog'

const HIDDEN = { id: 'p_draft', name: 'New long line', variants: [] }

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([HIDDEN])
})

describe('the shop list itself', () => {
  it('only ever asks for ACTIVE products, for one trainer', async () => {
    h.findMany.mockResolvedValue([])
    await listShopProducts('trainer_A')
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trainerId: 'trainer_A', active: true } }),
    )
  })

  it('leaves hidden variants out of a live product', async () => {
    h.findMany.mockResolvedValue([])
    await listShopProducts('trainer_A')
    const select = h.findMany.mock.calls[0][0].select
    expect(select.variants.where).toEqual({ active: true })
  })
})

describe('loadPreviewOnlyProduct — a trainer previewing their own draft', () => {
  it('returns the hidden product to its owner', async () => {
    const product = await loadPreviewOnlyProduct({
      trainerId: 'trainer_A',
      productId: 'p_draft',
      isPreview: true,
    })
    expect(product).toEqual(HIDDEN)
  })

  it('asks only for that one product, that one trainer, and only while hidden', async () => {
    await loadPreviewOnlyProduct({ trainerId: 'trainer_A', productId: 'p_draft', isPreview: true })
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // active: false, not "any": a LIVE product is already in the shop list,
        // and matching it here would show it to the trainer twice.
        where: { trainerId: 'trainer_A', id: 'p_draft', active: false },
      }),
    )
  })

  it('never flips the product live — it only reads', async () => {
    await loadPreviewOnlyProduct({ trainerId: 'trainer_A', productId: 'p_draft', isPreview: true })
    // The mocked client exposes findMany and nothing else; any write would have
    // thrown. Stated as an assertion so the intent survives a refactor.
    expect(Object.keys(h)).toEqual(['findMany'])
  })
})

describe('loadPreviewOnlyProduct — everybody else', () => {
  it('gives a REAL client nothing, however they got the id', async () => {
    const product = await loadPreviewOnlyProduct({
      trainerId: 'trainer_A',
      productId: 'p_draft',
      isPreview: false,
    })
    expect(product).toBeNull()
    // Not merely filtered afterwards — the hidden product is never fetched at
    // all, so there is nothing to leak into the payload the page renders.
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('404s across tenants — another trainer’s draft is simply not there', async () => {
    // What Prisma returns for `{ id: theirs, trainerId: mine }`.
    h.findMany.mockResolvedValue([])
    const product = await loadPreviewOnlyProduct({
      trainerId: 'trainer_A',
      productId: 'p_belongs_to_B',
      isPreview: true,
    })
    expect(product).toBeNull()
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ trainerId: 'trainer_A' }),
      }),
    )
  })

  it('does nothing at all without a ?product= to open', async () => {
    expect(await loadPreviewOnlyProduct({ trainerId: 'trainer_A', productId: null, isPreview: true }))
      .toBeNull()
    expect(h.findMany).not.toHaveBeenCalled()
  })
})
