import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  addStock,
  adjustStock,
  inStock,
  recordOpeningBalance,
  setStockCount,
  stockLabel,
  takeStock,
} from '@/lib/stock'

// Stock is deliberately small, so the rules have to be exact: NULL means "I
// never run out of this" and must never read as sold out, and taking the last
// unit must be a single atomic step so two people can't both get it.
//
// It is also BALANCE + LEDGER — Product.stockCount stays the running total and
// every change writes a StockMovement beside it. The pair is only worth having
// if it cannot drift, so the last block here replays a real week of a shelf and
// asserts the movements still sum to the balance.

const db = {
  product: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  stockMovement: { create: vi.fn() },
}
const asDb = () => db as unknown as Parameters<typeof takeStock>[0]

/** What every ledger write ends up carrying. */
const movementData = (call = 0) => db.stockMovement.create.mock.calls[call][0].data

beforeEach(() => {
  vi.clearAllMocks()
  db.stockMovement.create.mockResolvedValue({})
})

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
    db.product.findUnique.mockResolvedValue({ stockCount: null, trainerId: 't1' })

    expect(await takeStock(asDb(), 'p1')).toBe(true)
    expect(db.product.updateMany, 'nothing to decrement').not.toHaveBeenCalled()
    // No shelf, so no line about one. A history of "sold one, balance unknown"
    // against something that cannot run out would swamp the real counts.
    expect(db.stockMovement.create).not.toHaveBeenCalled()
  })

  it('takes one unit from a tracked product', async () => {
    db.product.findUnique
      .mockResolvedValueOnce({ stockCount: 3, trainerId: 't1' })
      .mockResolvedValueOnce({ stockCount: 2, trainerId: 't1' })
    db.product.updateMany.mockResolvedValue({ count: 1 })

    expect(await takeStock(asDb(), 'p1')).toBe(true)
    expect(db.product.updateMany).toHaveBeenCalledWith({
      // Conditional on there being stock, so the decrement and the check are
      // one operation — two buyers can't both take the last one.
      where: { id: 'p1', stockCount: { gt: 0 } },
      data: { stockCount: { decrement: 1 } },
    })
  })

  it('writes a SOLD line naming the client and the balance it left behind', async () => {
    db.product.findUnique
      .mockResolvedValueOnce({ stockCount: 3, trainerId: 't1' })
      .mockResolvedValueOnce({ stockCount: 2, trainerId: 't1' })
    db.product.updateMany.mockResolvedValue({ count: 1 })

    await takeStock(asDb(), 'p1', { clientId: 'c1', note: 'Paid in PupManager' })

    expect(movementData()).toMatchObject({
      productId: 'p1',
      trainerId: 't1',
      delta: -1,
      reason: 'SOLD',
      balanceAfter: 2,
      clientId: 'c1',
      note: 'Paid in PupManager',
      // Variants are coming; null means "the product's only SKU", which is why
      // today's rows need no backfill when they land.
      variantId: null,
    })
  })

  it('takes the tenant scope off the product, never from the caller', async () => {
    // A ledger query must not be able to cross businesses, so trainerId is not
    // something a call site can get wrong.
    db.product.findUnique
      .mockResolvedValueOnce({ stockCount: 1, trainerId: 'trainer-b' })
      .mockResolvedValueOnce({ stockCount: 0, trainerId: 'trainer-b' })
    db.product.updateMany.mockResolvedValue({ count: 1 })

    await takeStock(asDb(), 'p1', { clientId: 'c1' })
    expect(movementData().trainerId).toBe('trainer-b')
  })

  it('refuses when the shelf is empty', async () => {
    db.product.findUnique.mockResolvedValue({ stockCount: 0, trainerId: 't1' })
    db.product.updateMany.mockResolvedValue({ count: 0 })

    expect(await takeStock(asDb(), 'p1')).toBe(false)
    expect(db.stockMovement.create, 'nothing moved').not.toHaveBeenCalled()
  })

  it('refuses when someone else took the last one first', async () => {
    // Read said 1; by the time the conditional update ran, it was gone.
    db.product.findUnique.mockResolvedValue({ stockCount: 1, trainerId: 't1' })
    db.product.updateMany.mockResolvedValue({ count: 0 })

    expect(await takeStock(asDb(), 'p1')).toBe(false)
    expect(db.stockMovement.create).not.toHaveBeenCalled()
  })

  it('refuses a product that no longer exists', async () => {
    db.product.findUnique.mockResolvedValue(null)

    expect(await takeStock(asDb(), 'gone')).toBe(false)
    expect(db.product.updateMany).not.toHaveBeenCalled()
  })
})

describe('addStock', () => {
  it('defaults to RECEIVED — the reason a delivery is the usual one', async () => {
    db.product.findUnique.mockResolvedValue({ stockCount: 4, trainerId: 't1' })
    db.product.update.mockResolvedValue({ stockCount: 10 })

    expect(await addStock(asDb(), 'p1', 6, { userId: 'u1' })).toBe(10)
    expect(movementData()).toMatchObject({ delta: 6, reason: 'RECEIVED', balanceAfter: 10, userId: 'u1' })
  })

  it('records a return as a return, not as a delivery', async () => {
    db.product.findUnique.mockResolvedValue({ stockCount: 4, trainerId: 't1' })
    db.product.update.mockResolvedValue({ stockCount: 5 })

    await addStock(asDb(), 'p1', 1, { reason: 'RETURNED' })
    expect(movementData().reason).toBe('RETURNED')
  })

  it('leaves an untracked product untracked', async () => {
    // Incrementing NULL leaves NULL, so a line here would describe a balance
    // that does not exist. Starting to count goes through setStockCount.
    db.product.findUnique.mockResolvedValue({ stockCount: null, trainerId: 't1' })

    expect(await addStock(asDb(), 'p1', 5)).toBeNull()
    expect(db.product.update).not.toHaveBeenCalled()
    expect(db.stockMovement.create).not.toHaveBeenCalled()
  })
})

describe('adjustStock', () => {
  it('writes off breakages with the reason attached', async () => {
    db.product.findUnique.mockResolvedValue({ stockCount: 12, trainerId: 't1' })
    db.product.update.mockResolvedValue({ stockCount: 9 })

    expect(await adjustStock(asDb(), 'p1', { delta: -3, reason: 'DAMAGED', userId: 'u1' })).toBe(9)
    expect(movementData()).toMatchObject({ delta: -3, reason: 'DAMAGED', balanceAfter: 9 })
  })

  it('clamps at zero and records the delta that actually happened', async () => {
    // A negative count on hand is never a true statement about a shelf, and a
    // line claiming −5 against a balance of 0 is the drift this table exists
    // to expose.
    db.product.findUnique.mockResolvedValue({ stockCount: 2, trainerId: 't1' })
    db.product.update.mockResolvedValue({ stockCount: 0 })

    expect(await adjustStock(asDb(), 'p1', { delta: -5, reason: 'LOST' })).toBe(0)
    expect(movementData()).toMatchObject({ delta: -2, balanceAfter: 0 })
  })

  it('does nothing to an untracked product', async () => {
    db.product.findUnique.mockResolvedValue({ stockCount: null, trainerId: 't1' })

    expect(await adjustStock(asDb(), 'p1', { delta: -1, reason: 'LOST' })).toBeNull()
    expect(db.stockMovement.create).not.toHaveBeenCalled()
  })
})

describe('setStockCount', () => {
  it('records an opening balance when a trainer starts counting', async () => {
    // The edge case that would otherwise drift on day one: typing 12 into a
    // product that had no count is not "received 12", it is a declaration, and
    // without a line for it the ledger sums to 0 against twelve on the shelf.
    db.product.findUnique.mockResolvedValue({ stockCount: null, trainerId: 't1' })

    expect(await setStockCount(asDb(), 'p1', 12, { userId: 'u1' })).toBe(12)
    expect(movementData()).toMatchObject({
      delta: 12,
      reason: 'CORRECTION',
      balanceAfter: 12,
      note: 'Started counting this product',
    })
  })

  it('records a stocktake as the difference it found', async () => {
    db.product.findUnique.mockResolvedValue({ stockCount: 12, trainerId: 't1' })

    expect(await setStockCount(asDb(), 'p1', 9, { userId: 'u1', note: 'Counted the box' })).toBe(9)
    expect(movementData()).toMatchObject({ delta: -3, reason: 'CORRECTION', balanceAfter: 9 })
  })

  it('writes nothing when the number has not changed', async () => {
    // Saving the product form must not stamp a movement on every visit.
    db.product.findUnique.mockResolvedValue({ stockCount: 9, trainerId: 't1' })

    expect(await setStockCount(asDb(), 'p1', 9)).toBe(9)
    expect(db.product.update).not.toHaveBeenCalled()
    expect(db.stockMovement.create).not.toHaveBeenCalled()
  })

  it('turning tracking off leaves no line — there is no balance to describe', async () => {
    db.product.findUnique.mockResolvedValue({ stockCount: 9, trainerId: 't1' })

    expect(await setStockCount(asDb(), 'p1', null)).toBeNull()
    expect(db.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { stockCount: null } })
    expect(db.stockMovement.create).not.toHaveBeenCalled()
  })
})

// ─── Reconciliation ──────────────────────────────────────────────────────────

/**
 * A shelf, in memory: the balance and the ledger, behaving the way Postgres
 * does. Mocked call-by-call assertions cannot catch drift — drift only shows
 * up over a SEQUENCE of writes, which is exactly what a real shelf is.
 */
function fakeDb(initial: { stockCount: number | null; trainerId: string }) {
  const product = { ...initial }
  const movements: { delta: number; balanceAfter: number | null; reason: string }[] = []
  const db = {
    product: {
      findUnique: async () => ({ stockCount: product.stockCount, trainerId: product.trainerId }),
      update: async ({ data }: { data: { stockCount: number | { increment: number } | null } }) => {
        const next = data.stockCount
        if (next === null || typeof next === 'number') product.stockCount = next
        else product.stockCount = (product.stockCount ?? 0) + next.increment
        return { stockCount: product.stockCount }
      },
      updateMany: async () => {
        if (product.stockCount === null || product.stockCount <= 0) return { count: 0 }
        product.stockCount -= 1
        return { count: 1 }
      },
    },
    stockMovement: {
      create: async ({ data }: { data: { delta: number; balanceAfter: number | null; reason: string } }) => {
        movements.push({ delta: data.delta, balanceAfter: data.balanceAfter, reason: data.reason })
        return data
      },
    },
  }
  return { db: db as unknown as Parameters<typeof takeStock>[0], product, movements }
}

describe('the ledger reconciles with the balance', () => {
  it('sums to stockCount after a week of everything that can happen', async () => {
    const { db, product, movements } = fakeDb({ stockCount: null, trainerId: 't1' })

    await setStockCount(db, 'p1', 10, { userId: 'u1' }) // started counting: +10
    await takeStock(db, 'p1', { clientId: 'c1' }) // sold: −1
    await takeStock(db, 'p1', { clientId: 'c2' }) // sold: −1
    await addStock(db, 'p1', 6, { userId: 'u1' }) // delivery: +6
    await addStock(db, 'p1', 1, { reason: 'RETURNED', clientId: 'c1' }) // came back: +1
    await adjustStock(db, 'p1', { delta: -2, reason: 'DAMAGED', userId: 'u1' }) // −2
    await setStockCount(db, 'p1', 11, { userId: 'u1' }) // counted them: −2

    expect(product.stockCount).toBe(11)
    expect(movements.reduce((sum, m) => sum + m.delta, 0)).toBe(product.stockCount)
    // Every line also carries where it left the balance, so the history renders
    // without replaying the sums.
    expect(movements.at(-1)!.balanceAfter).toBe(11)
    expect(movements.map(m => m.reason)).toEqual([
      'CORRECTION', 'SOLD', 'SOLD', 'RECEIVED', 'RETURNED', 'DAMAGED', 'CORRECTION',
    ])
  })

  it('an untracked product records nothing at all, so nothing can drift', async () => {
    const { db, product, movements } = fakeDb({ stockCount: null, trainerId: 't1' })

    expect(await takeStock(db, 'p1', { clientId: 'c1' })).toBe(true)
    await addStock(db, 'p1', 5)
    await adjustStock(db, 'p1', { delta: -1, reason: 'LOST' })

    expect(product.stockCount).toBeNull()
    expect(movements).toHaveLength(0)
  })

  it('an opening balance on a brand-new product starts the ledger at the shelf', async () => {
    // The product is created with the count already on it, so setStockCount has
    // no before-and-after to notice — this is the only line that can exist.
    const { db, movements } = fakeDb({ stockCount: 12, trainerId: 't1' })

    await recordOpeningBalance(db, { productId: 'p1', trainerId: 't1', units: 12, userId: 'u1' })

    expect(movements.reduce((sum, m) => sum + m.delta, 0)).toBe(12)
    expect(movements[0]).toMatchObject({ reason: 'CORRECTION', balanceAfter: 12 })
  })
})
