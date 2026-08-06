import { describe, it, expect, vi, beforeEach } from 'vitest'

// Ordering a product takes units off the shelf, creates the request and raises
// a receivable. Cancelling used to undo one of the three, so a client who
// cancelled still owed for something they'd never receive (audit C-3).
//
// The counts are the other half of it: an order for three has to put THREE
// back, and returning one would leave the shelf two short with no movement
// explaining it — the same bug, two thirds of the way along.
const h = vi.hoisted(() => ({
  returnStock: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceUpdate: vi.fn(),
}))

vi.mock('@/lib/stock', () => ({ returnStock: h.returnStock, takeStock: vi.fn() }))
vi.mock('@/lib/invoicing', () => ({ createInvoiceForAssignment: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { invoice: { findFirst: h.invoiceFindFirst, update: h.invoiceUpdate } },
}))

import { releaseCancelledRequest } from '@/lib/product-requests'

const ROW = { trainerId: 'trainer-1', clientId: 'client-1', productId: 'prod-1', variantId: null, quantity: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  h.returnStock.mockResolvedValue(4)
  h.invoiceFindFirst.mockResolvedValue({ id: 'inv-1' })
  h.invoiceUpdate.mockResolvedValue({})
})

describe('cancelling a shop order', () => {
  it('puts the unit back on the shelf and cancels the receivable', async () => {
    const out = await releaseCancelledRequest(ROW)

    expect(h.returnStock).toHaveBeenCalledWith(
      expect.anything(), 'prod-1', 1,
      expect.objectContaining({ clientId: 'client-1', variantId: null }),
    )
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { status: 'CANCELLED' },
    })
    expect(out).toEqual({ stockReturned: true, invoiceCancelled: true, unitsReturned: 1 })
  })

  it('puts back exactly as many as the order took', async () => {
    // THE count test. Cancelling an order for three returns three — not one,
    // and not one call per unit that a later refactor could quietly drop.
    const out = await releaseCancelledRequest({ ...ROW, quantity: 3 })

    expect(h.returnStock).toHaveBeenCalledTimes(1)
    expect(h.returnStock).toHaveBeenCalledWith(expect.anything(), 'prod-1', 3, expect.anything())
    expect(out.unitsReturned).toBe(3)
  })

  it('never returns a nonsense number of units', async () => {
    // A corrupt or hand-edited row must not be able to mint stock. Clamped to
    // at least one, and never fractional.
    await releaseCancelledRequest({ ...ROW, quantity: 0 })
    expect(h.returnStock).toHaveBeenCalledWith(expect.anything(), 'prod-1', 1, expect.anything())

    h.returnStock.mockClear()
    await releaseCancelledRequest({ ...ROW, quantity: -5 })
    expect(h.returnStock).toHaveBeenCalledWith(expect.anything(), 'prod-1', 1, expect.anything())
  })

  it('cancels the receivable for the VARIANT that was ordered', async () => {
    // A varianted product invoices per variant — cancelling the Large must not
    // cancel the invoice for the Small.
    await releaseCancelledRequest({ ...ROW, variantId: 'var-large' })
    expect(h.invoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sourceId: 'var-large' }) }),
    )
  })

  it('only ever touches an UNPAID invoice', async () => {
    // Money that has already moved is a refund decision, and that belongs to the
    // trainer rather than to a tap in the client app. True however many units
    // the order was for.
    await releaseCancelledRequest({ ...ROW, quantity: 3 })
    expect(h.invoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'UNPAID' }) }),
    )
    expect(h.invoiceUpdate).toHaveBeenCalledTimes(1)
  })

  it('is fine when there was no invoice to cancel — an unpriced product', async () => {
    h.invoiceFindFirst.mockResolvedValue(null)
    const out = await releaseCancelledRequest(ROW)
    expect(h.invoiceUpdate).not.toHaveBeenCalled()
    expect(out).toEqual({ stockReturned: true, invoiceCancelled: false, unitsReturned: 1 })
  })

  it('reports untracked stock rather than inventing a balance', async () => {
    // A product that isn't counted returns null from returnStock and writes no
    // ledger line — there is no balance to describe.
    h.returnStock.mockResolvedValue(null)
    const out = await releaseCancelledRequest(ROW)
    expect(out.stockReturned).toBe(false)
  })
})
