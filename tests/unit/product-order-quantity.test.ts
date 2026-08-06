import { describe, it, expect, vi, beforeEach } from 'vitest'

// Ordering more than one of a thing.
//
// Karl: "when ordering a product i should be able to say I want 2 of these."
// Until this change the number was always one — there was no column to hold
// anything else, takeStock took exactly one unit, the invoice billed for one,
// and adding the same product twice returned the existing row and did nothing
// at all, which is what he saw as "the qty option is not working".
//
// COUNTING IS THE WHOLE TEST. Ordering does three things (units off the shelf,
// the request row, the receivable) and cancelling has to do the same number of
// them in reverse (AGENTS.md #4). Every assertion below is about a number
// matching a number.
const h = vi.hoisted(() => ({
  takeStock: vi.fn(),
  returnStock: vi.fn(),
  createInvoiceForAssignment: vi.fn(),
  requestFindFirst: vi.fn(),
  requestCreate: vi.fn(),
  requestUpdate: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceUpdate: vi.fn(),
  lineUpdate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/stock', () => ({ takeStock: h.takeStock, returnStock: h.returnStock }))
vi.mock('@/lib/invoicing', () => ({ createInvoiceForAssignment: h.createInvoiceForAssignment }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    productRequest: { findFirst: h.requestFindFirst, create: h.requestCreate, update: h.requestUpdate },
    invoice: { findFirst: h.invoiceFindFirst, update: h.invoiceUpdate },
    invoiceLineItem: { update: h.lineUpdate },
    $transaction: h.transaction,
  },
}))

import { placeProductOrder, releaseCancelledRequest } from '@/lib/product-requests'

const HARNESS = {
  id: 'prod_1',
  name: 'Front-clip harness',
  stockCount: 10 as number | null,
  variant: null,
}

const order = (over: Partial<Parameters<typeof placeProductOrder>[0]> = {}) =>
  placeProductOrder({
    trainerId: 'trainer_1',
    clientId: 'client_1',
    product: HARNESS,
    stockNote: 'Added to a client by their trainer',
    ...over,
  })

beforeEach(() => {
  vi.clearAllMocks()
  h.takeStock.mockResolvedValue(true)
  h.returnStock.mockResolvedValue(7)
  h.requestFindFirst.mockResolvedValue(null)
  h.requestCreate.mockResolvedValue({ id: 'req_1', quantity: 1 })
  h.requestUpdate.mockResolvedValue({ id: 'req_1', quantity: 1 })
  h.invoiceFindFirst.mockResolvedValue(null)
  h.createInvoiceForAssignment.mockResolvedValue('inv_1')
  h.transaction.mockResolvedValue([])
})

describe('three of something takes three off the shelf and bills for three', () => {
  it('takes the whole quantity in ONE movement', async () => {
    h.requestCreate.mockResolvedValue({ id: 'req_1', quantity: 3 })
    const out = await order({ quantity: 3 })

    expect(out.ok).toBe(true)
    // One call, for three — not three calls for one. "Sold 3, balance 7" is the
    // true statement about what happened; three lines of -1 would read as three
    // separate sales.
    expect(h.takeStock).toHaveBeenCalledTimes(1)
    expect(h.takeStock).toHaveBeenCalledWith(expect.anything(), 'prod_1', expect.anything(), 3)
  })

  it('writes the quantity on the row', async () => {
    h.requestCreate.mockResolvedValue({ id: 'req_1', quantity: 3 })
    await order({ quantity: 3 })
    expect(h.requestCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 3, status: 'PENDING' }) }),
    )
  })

  it('bills the receivable for three', async () => {
    h.requestCreate.mockResolvedValue({ id: 'req_1', quantity: 3 })
    await order({ quantity: 3 })
    expect(h.createInvoiceForAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'PRODUCT', productId: 'prod_1', quantity: 3 }),
    )
  })

  it('still means one when nobody says otherwise', async () => {
    // Every caller that predates the control, and every phone still running the
    // old build, sends no quantity at all.
    await order()
    expect(h.takeStock).toHaveBeenCalledWith(expect.anything(), 'prod_1', expect.anything(), 1)
    expect(h.createInvoiceForAssignment).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1 }))
  })
})

describe('adding the same product twice increases the quantity', () => {
  it('grows the pending order instead of no-opping', async () => {
    // THE bug. It used to find this row and return it untouched — no stock
    // moved, no money changed, and the second tap looked exactly like the first.
    h.requestFindFirst.mockResolvedValue({ id: 'req_1', quantity: 2 })
    h.requestUpdate.mockResolvedValue({ id: 'req_1', quantity: 5 })

    const out = await order({ quantity: 3 })

    expect(out).toMatchObject({ ok: true, created: false, added: 3 })
    expect(h.requestCreate).not.toHaveBeenCalled()
    expect(h.requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req_1' },
        // `increment`, not a computed value: two taps landing together must add
        // up to two rather than both writing "one more than what I read".
        data: { quantity: { increment: 3 } },
      }),
    )
  })

  it('takes only the ADDED units off the shelf, not the new total', async () => {
    // Two were already taken when the first order was placed. Taking five here
    // would double-charge the shelf for the ones already on it.
    h.requestFindFirst.mockResolvedValue({ id: 'req_1', quantity: 2 })
    h.requestUpdate.mockResolvedValue({ id: 'req_1', quantity: 5 })
    await order({ quantity: 3 })
    expect(h.takeStock).toHaveBeenCalledWith(expect.anything(), 'prod_1', expect.anything(), 3)
  })

  it('bills the receivable for the RUNNING TOTAL, not the increment', async () => {
    // There is one invoice per thing bought, so it has to say what is owed for
    // the whole order — five — rather than for this tap's three.
    h.requestFindFirst.mockResolvedValue({ id: 'req_1', quantity: 2 })
    h.requestUpdate.mockResolvedValue({ id: 'req_1', quantity: 5 })
    await order({ quantity: 3 })
    expect(h.createInvoiceForAssignment).toHaveBeenCalledWith(expect.objectContaining({ quantity: 5 }))
  })

  it('re-prices the receivable that already exists rather than raising a second', async () => {
    h.requestFindFirst.mockResolvedValue({ id: 'req_1', quantity: 1 })
    h.requestUpdate.mockResolvedValue({ id: 'req_1', quantity: 3 })
    h.invoiceFindFirst
      // 1st call: the PAID/PARTIAL guard finds nothing.
      .mockResolvedValueOnce(null)
      // 2nd call: the live receivable, one line at $45.
      .mockResolvedValueOnce({
        id: 'inv_1', status: 'UNPAID', amountCents: 4500,
        lines: [{ id: 'line_1', unitAmountCents: 4500 }],
      })

    await order({ quantity: 2 })

    expect(h.createInvoiceForAssignment).not.toHaveBeenCalled()
    expect(h.lineUpdate).toHaveBeenCalledWith({
      where: { id: 'line_1' },
      data: { quantity: 3, amountCents: 13500 },
    })
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })

  it('leaves a PAID order alone and refuses to grow it', async () => {
    // Money that has already moved is the trainer's decision. Quietly adding
    // units to a paid line would either bill nothing for the extras or rewrite
    // an invoice the client has a receipt for.
    h.requestFindFirst.mockResolvedValue({ id: 'req_1', quantity: 1 })
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv_paid' })

    const out = await order({ quantity: 2 })

    expect(out).toMatchObject({ ok: false, status: 409 })
    expect(h.takeStock).not.toHaveBeenCalled()
    expect(h.requestUpdate).not.toHaveBeenCalled()
    expect(h.lineUpdate).not.toHaveBeenCalled()
  })
})

describe('a re-order after a CANCELLED request is a new order', () => {
  it('never matches a cancelled row', async () => {
    // AGENTS.md #7. The exact shape of this has shipped once: the idempotency
    // check found the CANCELLED row, decided the thing was already ordered, and
    // the re-order was free.
    await order({ quantity: 2 })
    expect(h.requestFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'PENDING' }) }),
    )
  })

  it('raises a fresh receivable, because a cancelled invoice is not a live one', async () => {
    // The lookup that decides raise-or-reprice excludes CANCELLED, so the
    // client is billed for the re-order rather than handed it for nothing.
    await order({ quantity: 2 })
    expect(h.invoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: 'CANCELLED' } }),
      }),
    )
    expect(h.createInvoiceForAssignment).toHaveBeenCalledTimes(1)
  })
})

describe('more than is on the shelf is refused, server-side', () => {
  it('refuses the whole order rather than part-filling it', async () => {
    // ALL OR NOTHING. Handing over two against a receivable for three is a
    // refund conversation; a refusal is something the trainer can act on.
    h.takeStock.mockResolvedValue(false)
    const out = await order({ quantity: 5 })

    expect(out).toMatchObject({ ok: false, status: 409 })
    expect(h.requestCreate).not.toHaveBeenCalled()
    expect(h.createInvoiceForAssignment).not.toHaveBeenCalled()
  })

  it('says how many are actually left, not just "out of stock"', async () => {
    // "Out of stock" against a product sitting on the shelf sends someone
    // looking for a thing that is right there.
    h.takeStock.mockResolvedValue(false)
    const out = await order({ product: { ...HARNESS, stockCount: 2 }, quantity: 5 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toBe('Only 2 of Front-clip harness left — you asked for 5.')
  })

  it('checks the OPTION’s shelf when one was picked', async () => {
    h.takeStock.mockResolvedValue(false)
    const out = await order({
      product: { ...HARNESS, stockCount: 99, variant: { id: 'v_l', name: 'Large', stockCount: 1 } },
      quantity: 4,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toBe('Only 1 of Front-clip harness — Large left — you asked for 4.')
  })

  it('an untracked product can never run short', async () => {
    await order({ product: { ...HARNESS, stockCount: null }, quantity: 20 })
    expect(h.takeStock).toHaveBeenCalledWith(expect.anything(), 'prod_1', expect.anything(), 20)
  })
})

describe('a quantity that is not a whole number of things', () => {
  it('clamps a nonsense value rather than moving nonsense stock', async () => {
    // The routes REFUSE these outright (their zod schema and the buy route's
    // hand-rolled check both do). This is the floor underneath that, for a
    // value arriving from our own code.
    for (const [given, expected] of [[0, 1], [-3, 1], [2.7, 2], [500, 20]] as const) {
      vi.clearAllMocks()
      h.takeStock.mockResolvedValue(true)
      h.requestFindFirst.mockResolvedValue(null)
      h.requestCreate.mockResolvedValue({ id: 'req_1', quantity: expected })
      h.invoiceFindFirst.mockResolvedValue(null)
      await order({ quantity: given })
      expect(h.takeStock, `quantity ${given}`).toHaveBeenCalledWith(
        expect.anything(), 'prod_1', expect.anything(), expected,
      )
    }
  })
})

describe('cancelling undoes the same number of things', () => {
  beforeEach(() => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv_1' })
  })

  it('returns exactly as many as the order took', async () => {
    const out = await releaseCancelledRequest({
      trainerId: 'trainer_1', clientId: 'client_1', productId: 'prod_1', variantId: null, quantity: 3,
    })

    expect(h.returnStock).toHaveBeenCalledTimes(1)
    expect(h.returnStock).toHaveBeenCalledWith(expect.anything(), 'prod_1', 3, expect.anything())
    expect(out.unitsReturned).toBe(3)
  })

  it('cancels the receivable for the same order', async () => {
    const out = await releaseCancelledRequest({
      trainerId: 'trainer_1', clientId: 'client_1', productId: 'prod_1', variantId: null, quantity: 3,
    })
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: { status: 'CANCELLED' },
    })
    expect(out.invoiceCancelled).toBe(true)
  })

  it('leaves a PAID invoice alone', async () => {
    // The lookup only ever asks for UNPAID, so a PAID or PARTIAL one is never
    // found and never touched — a refund is the trainer's decision.
    h.invoiceFindFirst.mockResolvedValue(null)
    const out = await releaseCancelledRequest({
      trainerId: 'trainer_1', clientId: 'client_1', productId: 'prod_1', variantId: null, quantity: 3,
    })
    expect(h.invoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'UNPAID' }) }),
    )
    expect(h.invoiceUpdate).not.toHaveBeenCalled()
    // The stock still comes back — the client isn't getting the item either way.
    expect(out.unitsReturned).toBe(3)
  })

  it('order then cancel nets to zero on the shelf', async () => {
    // The round trip, stated as one arithmetic fact: whatever ordering took,
    // cancelling gave back.
    h.requestCreate.mockResolvedValue({ id: 'req_1', quantity: 4 })
    await order({ quantity: 4 })
    const taken = h.takeStock.mock.calls[0][3] as number

    await releaseCancelledRequest({
      trainerId: 'trainer_1', clientId: 'client_1', productId: 'prod_1', variantId: null, quantity: 4,
    })
    const returned = h.returnStock.mock.calls[0][2] as number

    expect(returned - taken).toBe(0)
  })
})
