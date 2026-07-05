import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/trainer/finances/receivables/[id] — the printable invoice detail.
// Security focus:
//   - billing.view guarded (a failing guard's response is returned verbatim)
//   - every read is scoped by trainerId=companyId (can't read another company's
//     invoice by id) → 404 when not found under this trainer
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceUpdate: vi.fn(),
  lineDeleteMany: vi.fn(),
  lineCreateMany: vi.fn(),
  transaction: vi.fn(),
  resyncReceivableToXero: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findFirst: h.invoiceFindFirst, update: h.invoiceUpdate },
    invoiceLineItem: { deleteMany: h.lineDeleteMany, createMany: h.lineCreateMany },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/invoicing', () => ({ resyncReceivableToXero: h.resyncReceivableToXero }))

import { GET, PATCH } from '@/app/api/trainer/finances/receivables/[id]/route'
import { NextResponse } from 'next/server'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}
function patchReq(body: unknown) {
  return new Request('http://x/api/trainer/finances/receivables/inv-1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
function line(description: string, quantity: number, unitAmountCents: number) {
  return { description, quantity, unitAmountCents }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ companyId: 't-1', role: 'OWNER', permissions: {} })
  h.invoiceUpdate.mockReturnValue(Promise.resolve({}))
  h.lineDeleteMany.mockReturnValue(Promise.resolve({}))
  h.lineCreateMany.mockReturnValue(Promise.resolve({}))
  h.transaction.mockImplementation((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]))
  h.resyncReceivableToXero.mockResolvedValue({ ok: true })
})

describe('auth gating', () => {
  it('returns the guard response when billing.view is denied', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Not allowed' }, { status: 403 }))
    const res = await GET(new Request('http://x/api/trainer/finances/receivables/inv-1'), params('inv-1'))
    expect(res.status).toBe(403)
    expect(h.invoiceFindFirst).not.toHaveBeenCalled()
  })
})

describe('scoping', () => {
  it('scopes the lookup by trainerId=companyId', async () => {
    h.invoiceFindFirst.mockResolvedValue(null)
    await GET(new Request('http://x/api/trainer/finances/receivables/inv-1'), params('inv-1'))
    expect(h.invoiceFindFirst.mock.calls[0][0].where).toEqual({ id: 'inv-1', trainerId: 't-1' })
  })

  it('404s when the invoice is not found under this trainer', async () => {
    h.invoiceFindFirst.mockResolvedValue(null)
    const res = await GET(new Request('http://x/api/trainer/finances/receivables/inv-1'), params('inv-1'))
    expect(res.status).toBe(404)
  })

  it('returns the full document shape (business header + bill-to + reference)', async () => {
    h.invoiceFindFirst.mockResolvedValue({
      id: 'clabc123def456', description: 'Puppy Course', amountCents: 12500, currency: 'nzd',
      status: 'UNPAID', sentAt: null, paidAt: null, createdAt: new Date('2026-07-01T00:00:00Z'),
      xeroInvoiceId: null, xeroSyncStatus: null, xeroSyncError: null,
      lines: [{ id: 'l1', description: 'Puppy Course', quantity: 1, unitAmountCents: 12500, amountCents: 12500 }],
      client: { addressLine: '1 Bark Lane', phone: '021', user: { name: 'Sam', email: 's@x.com' } },
      trainer: {
        businessName: 'Pawsome', logoUrl: 'https://x/l.png', publicEmail: 'hi@paw.com',
        addressLine1: '2 Main St', addressLine2: null, addressCity: 'Auckland',
        addressRegion: null, addressPostcode: '1010', addressCountry: 'NZ',
      },
    })
    const res = await GET(new Request('http://x/api/trainer/finances/receivables/x'), params('clabc123def456'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reference).toBe('INV-DEF456')
    expect(body.client).toMatchObject({ name: 'Sam', email: 's@x.com', address: '1 Bark Lane' })
    expect(body.business).toMatchObject({ name: 'Pawsome', logoUrl: 'https://x/l.png', email: 'hi@paw.com' })
    expect(body.business.address).toBe('2 Main St, Auckland, 1010, NZ')
    expect(body.lines).toEqual([{ id: 'l1', description: 'Puppy Course', quantity: 1, unitAmountCents: 12500, amountCents: 12500 }])
  })
})

describe('PATCH (multi-line, replace-all)', () => {
  it('scopes the lookup by trainerId and 404s when foreign', async () => {
    h.invoiceFindFirst.mockResolvedValue(null)
    const res = await PATCH(patchReq({ lines: [line('X', 1, 5000)] }), params('inv-1'))
    expect(res.status).toBe(404)
    expect(h.invoiceFindFirst.mock.calls[0][0].where).toEqual({ id: 'inv-1', trainerId: 't-1' })
    expect(h.lineDeleteMany).not.toHaveBeenCalled()
  })

  it('409s when the invoice is PAID (locked)', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv-1', status: 'PAID', xeroInvoiceId: null })
    const res = await PATCH(patchReq({ lines: [line('X', 1, 5000)] }), params('inv-1'))
    expect(res.status).toBe(409)
    expect(h.lineDeleteMany).not.toHaveBeenCalled()
  })

  it('409s when the invoice is CANCELLED (locked)', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv-1', status: 'CANCELLED', xeroInvoiceId: null })
    const res = await PATCH(patchReq({ lines: [line('X', 1, 5000)] }), params('inv-1'))
    expect(res.status).toBe(409)
    expect(h.lineDeleteMany).not.toHaveBeenCalled()
  })

  it('409s when the invoice is PARTIAL (already partly paid — locked)', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv-1', status: 'PARTIAL', xeroInvoiceId: null })
    const res = await PATCH(patchReq({ lines: [line('X', 1, 5000)] }), params('inv-1'))
    expect(res.status).toBe(409)
    expect(h.lineDeleteMany).not.toHaveBeenCalled()
  })

  it('400s when there are no lines', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv-1', status: 'UNPAID', xeroInvoiceId: null })
    expect((await PATCH(patchReq({}), params('inv-1'))).status).toBe(400)
    expect((await PATCH(patchReq({ lines: [] }), params('inv-1'))).status).toBe(400)
    expect(h.lineDeleteMany).not.toHaveBeenCalled()
  })

  it('400s when a line is invalid (quantity 0 / negative unit)', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv-1', status: 'UNPAID', xeroInvoiceId: null })
    expect((await PATCH(patchReq({ lines: [line('X', 0, 100)] }), params('inv-1'))).status).toBe(400)
    expect((await PATCH(patchReq({ lines: [line('X', 1, -1)] }), params('inv-1'))).status).toBe(400)
  })

  it('replaces the lines and recomputes the invoice total (multi-line)', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv-1', status: 'UNPAID', xeroInvoiceId: null })
    const res = await PATCH(patchReq({ lines: [line('Course', 1, 12500), line('Treats', 2, 1250)] }), params('inv-1'))
    expect(res.status).toBe(200)
    // Old lines cleared first.
    expect(h.lineDeleteMany).toHaveBeenCalledWith({ where: { invoiceId: 'inv-1' } })
    // New lines written with per-line amountCents = quantity * unit, ordered.
    const created = h.lineCreateMany.mock.calls[0][0].data
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ invoiceId: 'inv-1', description: 'Course', quantity: 1, unitAmountCents: 12500, amountCents: 12500, sortOrder: 0 })
    expect(created[1]).toMatchObject({ invoiceId: 'inv-1', description: 'Treats', quantity: 2, unitAmountCents: 1250, amountCents: 2500, sortOrder: 1 })
    // Cached total (sum) + label (first line).
    expect(h.invoiceUpdate).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { amountCents: 15000, description: 'Course' } })
    expect(h.resyncReceivableToXero).not.toHaveBeenCalled()
  })

  it('replace-all: a single posted line becomes the whole invoice (line removal)', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv-1', status: 'UNPAID', xeroInvoiceId: null })
    await PATCH(patchReq({ lines: [line('Only', 1, 3000)] }), params('inv-1'))
    expect(h.lineCreateMany.mock.calls[0][0].data).toHaveLength(1)
    expect(h.invoiceUpdate).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { amountCents: 3000, description: 'Only' } })
  })

  it('re-pushes to Xero after saving when the invoice is already synced', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv-1', status: 'UNPAID', xeroInvoiceId: 'XINV-1' })
    const res = await PATCH(patchReq({ lines: [line('X', 1, 9900)] }), params('inv-1'))
    expect(res.status).toBe(200)
    expect(h.resyncReceivableToXero).toHaveBeenCalledWith('inv-1')
  })
})
