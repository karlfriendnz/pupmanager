import { describe, it, expect, vi, beforeEach } from 'vitest'

// Ordering a product takes a unit off the shelf, creates the request and raises
// a receivable. Cancelling used to undo one of the three, so a client who
// cancelled still owed for something they'd never receive (audit C-3).
const h = vi.hoisted(() => ({
  addStock: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceUpdate: vi.fn(),
}))

vi.mock('@/lib/stock', () => ({ addStock: h.addStock }))
vi.mock('@/lib/prisma', () => ({
  prisma: { invoice: { findFirst: h.invoiceFindFirst, update: h.invoiceUpdate } },
}))

import { releaseCancelledRequest } from '@/lib/product-requests'

const ROW = { trainerId: 'trainer-1', clientId: 'client-1', productId: 'prod-1', variantId: null }

beforeEach(() => {
  vi.clearAllMocks()
  h.addStock.mockResolvedValue(4)
  h.invoiceFindFirst.mockResolvedValue({ id: 'inv-1' })
  h.invoiceUpdate.mockResolvedValue({})
})

describe('cancelling a shop order', () => {
  it('puts the unit back on the shelf and cancels the receivable', async () => {
    const out = await releaseCancelledRequest(ROW)

    expect(h.addStock).toHaveBeenCalledWith(
      expect.anything(), 'prod-1', 1,
      expect.objectContaining({ clientId: 'client-1', variantId: null, reason: 'RETURNED' }),
    )
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { status: 'CANCELLED' },
    })
    expect(out).toEqual({ stockReturned: true, invoiceCancelled: true })
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
    // trainer rather than to a tap in the client app.
    await releaseCancelledRequest(ROW)
    expect(h.invoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'UNPAID' }) }),
    )
  })

  it('is fine when there was no invoice to cancel — an unpriced product', async () => {
    h.invoiceFindFirst.mockResolvedValue(null)
    const out = await releaseCancelledRequest(ROW)
    expect(h.invoiceUpdate).not.toHaveBeenCalled()
    expect(out).toEqual({ stockReturned: true, invoiceCancelled: false })
  })

  it('reports untracked stock rather than inventing a balance', async () => {
    // A product that isn't counted returns null from addStock and writes no
    // ledger line — there is no balance to describe.
    h.addStock.mockResolvedValue(null)
    const out = await releaseCancelledRequest(ROW)
    expect(out.stockReturned).toBe(false)
  })
})
