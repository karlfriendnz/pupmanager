import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/trainer/finances/receivables — the "instant sale" (POS) flow.
// This is the only Invoice creation path a trainer drives directly, and it
// takes arbitrary line items, so the guards matter more than usual:
//   - unauthenticated / missing billing.view → rejected before anything is read
//   - the `pos` add-on off → 403 ADDON_REQUIRED
//   - a client belonging to ANOTHER trainer → refused (id alone is not enough)
//   - a PRODUCT belonging to another trainer → refused, and no stock moved
//   - malformed / out-of-bounds lines → 400, no write
//
// Since a catalogue line now moves real stock, the guards cover the shelf too:
// a sale the shelf can't fill is refused BEFORE the invoice exists, and a
// replayed idempotency key must never take the units twice.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  hasAddon: vi.fn(),
  clientFindFirst: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceCreate: vi.fn(),
  trainerFindUnique: vi.fn(),
  productFindMany: vi.fn(),
  requestCreate: vi.fn(),
  takeStock: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/stock', () => ({ takeStock: h.takeStock }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findFirst: h.clientFindFirst },
    invoice: { findFirst: h.invoiceFindFirst, create: h.invoiceCreate },
    trainerProfile: { findUnique: h.trainerFindUnique },
    product: { findMany: h.productFindMany },
    productRequest: { create: h.requestCreate },
    // The fulfilment runs in one transaction so the units and the hand-overs
    // land together; the interactive form hands the callback a client.
    $transaction: (fn: (tx: unknown) => unknown) =>
      Promise.resolve(fn({ productRequest: { create: h.requestCreate } })),
  },
}))
// `after()` defers the email/Xero side effects; run nothing in tests. Keep the
// rest of next/server real so NextResponse still works.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))
// Pulled in by invoicing.ts at module load; the sale path never calls them.
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/push', () => ({ sendPush: vi.fn() }))
vi.mock('@/lib/xero', () => ({ createXeroInvoice: vi.fn(), fetchXeroInvoiceState: vi.fn() }))
vi.mock('@/lib/xero-sync', () => ({ ensureClientXeroContact: vi.fn() }))
vi.mock('@/lib/xero-clearing', () => ({ postPaymentThroughClearing: vi.fn(), isSurchargeItem: vi.fn() }))

import { NextResponse } from 'next/server'
import { POST } from '@/app/api/trainer/finances/receivables/route'

const LINES = [{ description: 'Ball thrower', quantity: 1, unitAmountCents: 2500 }]

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/trainer/finances/receivables', {
    method: 'POST',
    body: JSON.stringify(body),
  })

const validBody = (over: Record<string, unknown> = {}) => ({
  clientId: 'cl_1',
  lines: LINES,
  idempotencyKey: 'sale_abcdef123456',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ companyId: 'co_1', role: 'OWNER', permissions: null })
  h.hasAddon.mockResolvedValue(true)
  h.clientFindFirst.mockResolvedValue({ id: 'cl_1' })
  h.invoiceFindFirst.mockResolvedValue(null)
  h.trainerFindUnique.mockResolvedValue({
    autoSendInvoices: false,
    payoutCurrency: 'nzd',
    businessName: 'Pawsome',
    sandboxBilling: false,
    xeroConnection: null,
  })
  h.invoiceCreate.mockResolvedValue({ id: 'inv_1', payToken: 'tok_1', amountCents: 2500 })
  h.productFindMany.mockResolvedValue([
    { id: 'p_1', name: 'Ball thrower', stockCount: 5, variants: [] },
  ])
  h.takeStock.mockResolvedValue(true)
  h.requestCreate.mockResolvedValue({})
})

/** The same sale, but rung up off the catalogue rather than typed. */
const catalogueBody = (over: Record<string, unknown> = {}) =>
  validBody({
    lines: [{ description: 'Ball thrower', quantity: 1, unitAmountCents: 2500, productId: 'p_1' }],
    ...over,
  })

describe('POST /api/trainer/finances/receivables — guards', () => {
  it('rejects when the permission guard fails, without touching the DB', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))

    const res = await POST(req(validBody()))

    expect(res.status).toBe(403)
    expect(h.invoiceCreate).not.toHaveBeenCalled()
    expect(h.clientFindFirst).not.toHaveBeenCalled()
  })

  it('403s ADDON_REQUIRED when the pos add-on is off', async () => {
    h.hasAddon.mockResolvedValue(false)

    const res = await POST(req(validBody()))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'ADDON_REQUIRED' })
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('checks the add-on against the caller’s own company', async () => {
    h.guardPermission.mockResolvedValue({ companyId: 'co_99', role: 'OWNER', permissions: null })

    await POST(req(validBody()))

    expect(h.hasAddon).toHaveBeenCalledWith('co_99', 'pos')
  })

  it('refuses a client that belongs to another trainer', async () => {
    // Scoped lookup finds nothing ⇒ the id was valid but not this trainer's.
    h.clientFindFirst.mockResolvedValue(null)

    const res = await POST(req(validBody({ clientId: 'cl_someone_elses' })))

    expect(res.status).toBe(500)
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('scopes the client lookup by trainerId, not by id alone', async () => {
    await POST(req(validBody()))

    expect(h.clientFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cl_1', trainerId: 'co_1' } }),
    )
  })

  it('always writes the invoice against the caller’s company', async () => {
    await POST(req(validBody()))

    expect(h.invoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trainerId: 'co_1', clientId: 'cl_1' }),
      }),
    )
  })
})

describe('POST /api/trainer/finances/receivables — input validation', () => {
  it.each([
    ['no lines', validBody({ lines: [] })],
    ['missing clientId', { lines: LINES, idempotencyKey: 'sale_abcdef123456' }],
    ['missing idempotencyKey', { clientId: 'cl_1', lines: LINES }],
    ['short idempotencyKey', validBody({ idempotencyKey: 'abc' })],
    ['zero quantity', validBody({ lines: [{ description: 'x', quantity: 0, unitAmountCents: 100 }] })],
    ['negative amount', validBody({ lines: [{ description: 'x', quantity: 1, unitAmountCents: -100 }] })],
    ['fractional cents', validBody({ lines: [{ description: 'x', quantity: 1, unitAmountCents: 10.5 }] })],
    ['empty description', validBody({ lines: [{ description: '', quantity: 1, unitAmountCents: 100 }] })],
    ['too many lines', validBody({ lines: Array.from({ length: 51 }, () => LINES[0]) })],
  ])('400s on %s and writes nothing', async (_label, body) => {
    const res = await POST(req(body))

    expect(res.status).toBe(400)
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('accepts a line with no product — a one-off "Something else" charge', async () => {
    const res = await POST(req(validBody()))

    expect(res.status).toBe(200)
    // Nothing to look up, nothing to de-stock.
    expect(h.productFindMany).not.toHaveBeenCalled()
    expect(h.takeStock).not.toHaveBeenCalled()
  })

  it('400s on a non-JSON body rather than throwing', async () => {
    const bad = new Request('https://app.pupmanager.com/api/trainer/finances/receivables', {
      method: 'POST',
      body: 'not json',
    })

    const res = await POST(bad)

    expect(res.status).toBe(400)
  })

  it('rejects a sale that totals zero — nothing to charge for', async () => {
    const res = await POST(req(validBody({ lines: [{ description: 'Freebie', quantity: 2, unitAmountCents: 0 }] })))

    expect(res.status).toBe(500)
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })
})

// A catalogue line moves real stock, so it gets the same treatment as the
// client id: an id is a claim, not a permission.
describe('POST /api/trainer/finances/receivables — the catalogue and the shelf', () => {
  it('looks products up scoped to the caller’s own company', async () => {
    await POST(req(catalogueBody()))

    expect(h.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['p_1'] }, trainerId: 'co_1' } }),
    )
  })

  it('refuses a product that belongs to another trainer, before any invoice', async () => {
    h.productFindMany.mockResolvedValue([]) // the scoped read finds nothing

    const res = await POST(req(catalogueBody({
      lines: [{ description: 'Ball thrower', quantity: 1, unitAmountCents: 2500, productId: 'p_someone_elses' }],
    })))

    expect(res.status).toBe(409)
    expect(h.invoiceCreate).not.toHaveBeenCalled()
    expect(h.takeStock).not.toHaveBeenCalled()
  })

  it('refuses a sale the shelf can’t fill, and raises no invoice for it', async () => {
    h.productFindMany.mockResolvedValue([{ id: 'p_1', name: 'Ball thrower', stockCount: 1, variants: [] }])

    const res = await POST(req(catalogueBody({
      lines: [{ description: 'Ball thrower', quantity: 4, unitAmountCents: 2500, productId: 'p_1' }],
    })))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: expect.stringMatching(/only 1/i) })
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('takes the stock and records the hand-over against the client', async () => {
    const res = await POST(req(catalogueBody()))

    expect(res.status).toBe(200)
    expect(h.takeStock).toHaveBeenCalledWith(
      expect.anything(),
      'p_1',
      expect.objectContaining({ clientId: 'cl_1', variantId: null }),
    )
    expect(h.requestCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clientId: 'cl_1', productId: 'p_1', status: 'FULFILLED' }) }),
    )
  })

  // A double-tap at the till resolves to the SAME sale. The units came off the
  // shelf the first time; taking them again would show two sold where one went.
  it('moves no stock when the idempotency key replays an existing sale', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv_1', payToken: 'tok_1', amountCents: 2500 })

    const res = await POST(req(catalogueBody()))

    expect(res.status).toBe(200)
    expect(h.takeStock).not.toHaveBeenCalled()
    expect(h.requestCreate).not.toHaveBeenCalled()
  })

  // A service or a digital download has no count. It must sell without being
  // refused and without inventing a ledger line for a shelf that doesn't exist.
  it('sells an untracked product without touching a count', async () => {
    h.productFindMany.mockResolvedValue([{ id: 'p_1', name: 'Puppy guide (PDF)', stockCount: null, variants: [] }])

    const res = await POST(req(catalogueBody({
      lines: [{ description: 'Puppy guide (PDF)', quantity: 9, unitAmountCents: 2500, productId: 'p_1' }],
    })))

    expect(res.status).toBe(200)
    // takeStock is still called — it is the one place that decides an untracked
    // product writes no movement — and it never refuses one.
    expect(h.takeStock).toHaveBeenCalledTimes(9)
  })
})
