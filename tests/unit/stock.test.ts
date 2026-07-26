import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inStock, stockLabel, takeStock } from '@/lib/stock'

// Stock is deliberately small, so the rules have to be exact: NULL means "I
// never run out of this" and must never read as sold out, and taking the last
// unit must be a single atomic step so two people can't both get it.

const db = {
  product: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
}
const asDb = () => db as unknown as Parameters<typeof takeStock>[0]

beforeEach(() => vi.clearAllMocks())

describe('inStock', () => {
  it('treats an untracked product as always available', () => {
    expect(inStock(null)).toBe(true)
    expect(inStock(undefined)).toBe(true)
  })

  it('is available while there is any left', () => {
    expect(inStock(1)).toBe(true)
    expect(inStock(99)).toBe(true)
  })

  it('is not available at zero — or below it', () => {
    expect(inStock(0)).toBe(false)
    expect(inStock(-1)).toBe(false)
  })
})

describe('stockLabel', () => {
  it('says nothing at all for an untracked product', () => {
    // "In stock" on something that can't run out is noise.
    expect(stockLabel(null)).toBeNull()
    expect(stockLabel(undefined)).toBeNull()
  })

  it('warns when it is running low', () => {
    expect(stockLabel(1)).toBe('Only 1 left')
    expect(stockLabel(5)).toBe('Only 5 left')
  })

  it('states the count when there is plenty', () => {
    expect(stockLabel(6)).toBe('6 in stock')
  })

  it('says out of stock at zero', () => {
    expect(stockLabel(0)).toBe('Out of stock')
  })
})

describe('takeStock', () => {
  it('lets an untracked product through without touching the count', async () => {
    db.product.findUnique.mockResolvedValue({ stockCount: null })

    expect(await takeStock(asDb(), 'p1')).toBe(true)
    expect(db.product.updateMany, 'nothing to decrement').not.toHaveBeenCalled()
  })

  it('takes one unit from a tracked product', async () => {
    db.product.findUnique.mockResolvedValue({ stockCount: 3 })
    db.product.updateMany.mockResolvedValue({ count: 1 })

    expect(await takeStock(asDb(), 'p1')).toBe(true)
    expect(db.product.updateMany).toHaveBeenCalledWith({
      // Conditional on there being stock, so the decrement and the check are
      // one operation — two buyers can't both take the last one.
      where: { id: 'p1', stockCount: { gt: 0 } },
      data: { stockCount: { decrement: 1 } },
    })
  })

  it('refuses when the shelf is empty', async () => {
    db.product.findUnique.mockResolvedValue({ stockCount: 0 })
    db.product.updateMany.mockResolvedValue({ count: 0 })

    expect(await takeStock(asDb(), 'p1')).toBe(false)
  })

  it('refuses when someone else took the last one first', async () => {
    // Read said 1; by the time the conditional update ran, it was gone.
    db.product.findUnique.mockResolvedValue({ stockCount: 1 })
    db.product.updateMany.mockResolvedValue({ count: 0 })

    expect(await takeStock(asDb(), 'p1')).toBe(false)
  })

  it('refuses a product that no longer exists', async () => {
    db.product.findUnique.mockResolvedValue(null)

    expect(await takeStock(asDb(), 'gone')).toBe(false)
    expect(db.product.updateMany).not.toHaveBeenCalled()
  })
})
