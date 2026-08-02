import { describe, it, expect, vi, beforeEach } from 'vitest'

// The catalogue half of an in-person sale: the check that runs BEFORE any money
// is raised, and the two records written after it — a unit off the shelf and a
// hand-over against the product.
//
// The rules that matter, and why each is here:
//   - a product from another business is not sellable, even with a valid id
//   - an option must belong to the product it claims to
//   - a product with sizes cannot be sold as itself (its counts are per option)
//   - a tracked shelf that can't fill the cart refuses, naming the item
//   - an UNTRACKED shelf (a service, a download) never refuses and never
//     writes a ledger line — there is no count to move
const h = vi.hoisted(() => ({
  productFindMany: vi.fn(),
  requestCreate: vi.fn(),
  takeStock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { product: { findMany: h.productFindMany } } }))
vi.mock('@/lib/stock', () => ({ takeStock: h.takeStock }))

import { fulfilInPersonSale, resolveSaleItems, IN_PERSON_SALE_NOTE } from '@/lib/in-person-sale'

const db = () => ({ productRequest: { create: h.requestCreate } }) as unknown as Parameters<typeof fulfilInPersonSale>[0]

const harness = (over: Record<string, unknown> = {}) => ({
  id: 'p_harness',
  name: 'Harness',
  stockCount: null,
  variants: [
    { id: 'v_s', name: 'Small', stockCount: 1 },
    { id: 'v_l', name: 'Large', stockCount: 4 },
  ],
  ...over,
})

const treats = (over: Record<string, unknown> = {}) => ({
  id: 'p_treats',
  name: 'Liver treats',
  stockCount: 3,
  variants: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.takeStock.mockResolvedValue(true)
  h.requestCreate.mockResolvedValue({})
})

describe('resolveSaleItems — whose catalogue is it', () => {
  it('scopes the lookup by trainerId, never by product id alone', async () => {
    h.productFindMany.mockResolvedValue([treats()])

    await resolveSaleItems('co_1', [{ productId: 'p_treats', quantity: 1 }])

    expect(h.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['p_treats'] }, trainerId: 'co_1' },
      }),
    )
  })

  it('refuses a product that isn’t this trainer’s (the scoped read finds nothing)', async () => {
    h.productFindMany.mockResolvedValue([])

    const res = await resolveSaleItems('co_1', [{ productId: 'p_someone_elses', quantity: 1 }])

    expect(res).toEqual({ ok: false, error: expect.stringMatching(/catalogue/i) })
  })

  it('refuses an option that belongs to some other product', async () => {
    h.productFindMany.mockResolvedValue([harness()])

    const res = await resolveSaleItems('co_1', [{ productId: 'p_harness', variantId: 'v_other', quantity: 1 }])

    expect(res.ok).toBe(false)
  })

  // A varianted product's counts live on the variants and Product.stockCount is
  // ignored, so selling "a harness" would take a unit off a shelf nobody counts.
  it('refuses a product with sizes when no size was picked', async () => {
    h.productFindMany.mockResolvedValue([harness()])

    const res = await resolveSaleItems('co_1', [{ productId: 'p_harness', quantity: 1 }])

    expect(res).toEqual({ ok: false, error: expect.stringMatching(/choose an option for harness/i) })
  })

  it('has nothing to check when the sale is all one-off lines', async () => {
    const res = await resolveSaleItems('co_1', [])

    expect(res).toEqual({ ok: true, items: [] })
    expect(h.productFindMany).not.toHaveBeenCalled()
  })
})

describe('resolveSaleItems — the shelf', () => {
  it('passes a sale the shelf can fill, labelling the option', async () => {
    h.productFindMany.mockResolvedValue([harness()])

    const res = await resolveSaleItems('co_1', [{ productId: 'p_harness', variantId: 'v_l', quantity: 3 }])

    expect(res).toEqual({
      ok: true,
      items: [{ productId: 'p_harness', variantId: 'v_l', quantity: 3, label: 'Harness · Large' }],
    })
  })

  it('refuses an empty shelf, and says which item and what to do', async () => {
    h.productFindMany.mockResolvedValue([treats({ stockCount: 0 })])

    const res = await resolveSaleItems('co_1', [{ productId: 'p_treats', quantity: 1 }])

    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toMatch(/Liver treats is out of stock/i)
  })

  it('refuses when the cart asks for more than is left, and says how many', async () => {
    h.productFindMany.mockResolvedValue([treats({ stockCount: 2 })])

    const res = await resolveSaleItems('co_1', [{ productId: 'p_treats', quantity: 5 }])

    expect(res.ok === false && res.error).toMatch(/Only 2 of Liver treats left/i)
  })

  // Two lines of the same Large are three units off ONE count. Checking them
  // line by line would let a cart of two-plus-two clear a shelf holding three.
  it('adds up every line against the same shelf', async () => {
    h.productFindMany.mockResolvedValue([harness()])

    const res = await resolveSaleItems('co_1', [
      { productId: 'p_harness', variantId: 'v_l', quantity: 3 },
      { productId: 'p_harness', variantId: 'v_l', quantity: 2 },
    ])

    expect(res.ok).toBe(false)
  })

  it('keeps each option to its own shelf', async () => {
    h.productFindMany.mockResolvedValue([harness()])

    const res = await resolveSaleItems('co_1', [
      { productId: 'p_harness', variantId: 'v_s', quantity: 1 },
      { productId: 'p_harness', variantId: 'v_l', quantity: 4 },
    ])

    expect(res.ok).toBe(true)
  })

  // stockCount: null = "I never run out of this" — a service, a digital
  // download, a made-to-order item. It can't be refused and can't go negative.
  it('never refuses an untracked product, however many are sold', async () => {
    h.productFindMany.mockResolvedValue([treats({ stockCount: null })])

    const res = await resolveSaleItems('co_1', [{ productId: 'p_treats', quantity: 999 }])

    expect(res.ok).toBe(true)
  })
})

describe('fulfilInPersonSale', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    productId: 'p_treats', variantId: null, quantity: 1, label: 'Liver treats', ...over,
  })

  it('takes one unit per item sold, not one per line', async () => {
    await fulfilInPersonSale(db(), {
      trainerId: 'co_1', clientId: 'cl_1', userId: 'u_1', items: [item({ quantity: 3 })],
    })

    expect(h.takeStock).toHaveBeenCalledTimes(3)
    expect(h.requestCreate).toHaveBeenCalledTimes(3)
  })

  it('names the client, the staff member and the option on the ledger line', async () => {
    await fulfilInPersonSale(db(), {
      trainerId: 'co_1', clientId: 'cl_1', userId: 'u_1',
      items: [item({ productId: 'p_harness', variantId: 'v_l' })],
    })

    expect(h.takeStock).toHaveBeenCalledWith(expect.anything(), 'p_harness', {
      clientId: 'cl_1',
      userId: 'u_1',
      variantId: 'v_l',
      note: IN_PERSON_SALE_NOTE,
    })
  })

  // Over the counter the item is already in their hands, so the hand-over is
  // FULFILLED from the first second — the same record the Stripe webhook writes
  // for a product paid for in the app.
  it('records the hand-over as already fulfilled', async () => {
    await fulfilInPersonSale(db(), {
      trainerId: 'co_1', clientId: 'cl_1', userId: 'u_1', items: [item({ variantId: 'v_l' })],
    })

    expect(h.requestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'cl_1',
        productId: 'p_treats',
        variantId: 'v_l',
        status: 'FULFILLED',
        note: IN_PERSON_SALE_NOTE,
      }),
    })
    expect(h.requestCreate.mock.calls[0][0].data.fulfilledAt).toBeInstanceOf(Date)
  })

  // Only reachable with two tills open on one catalogue. The sale is already
  // rung up, so telling the trainer it failed after it didn't would be worse
  // than a count they have to correct.
  it('still records the hand-over when the shelf emptied mid-sale', async () => {
    h.takeStock.mockResolvedValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await fulfilInPersonSale(db(), {
      trainerId: 'co_1', clientId: 'cl_1', userId: 'u_1', items: [item()],
    })

    expect(h.requestCreate).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
