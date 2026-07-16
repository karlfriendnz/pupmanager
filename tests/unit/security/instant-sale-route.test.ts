import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/trainer/finances/receivables — the "instant sale" (POS) flow.
// This is the only Invoice creation path a trainer drives directly, and it
// takes arbitrary line items, so the guards matter more than usual:
//   - unauthenticated / missing billing.view → rejected before anything is read
//   - the `pos` add-on off → 403 ADDON_REQUIRED
//   - a client belonging to ANOTHER trainer → refused (id alone is not enough)
//   - malformed / out-of-bounds lines → 400, no write
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  hasAddon: vi.fn(),
  clientFindFirst: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceCreate: vi.fn(),
  trainerFindUnique: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findFirst: h.clientFindFirst },
    invoice: { findFirst: h.invoiceFindFirst, create: h.invoiceCreate },
    trainerProfile: { findUnique: h.trainerFindUnique },
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
