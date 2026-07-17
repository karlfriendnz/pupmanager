import { describe, it, expect, vi, beforeEach } from 'vitest'

// PATCH /api/trainer/finances/receivables/[id] — the endpoint the sale composer
// uses to settle a pay-later booking and add an upsell to it.
//
// Why this suite exists: PATCH is REPLACE-ALL. It deletes every existing
// InvoiceLineItem and recreates the set from the request body. So a caller that
// sends only the upsell line silently WIPES what the client already owed — a
// $770 package invoice would quietly become a $32 one. These tests pin the
// replace-all semantics and the UNPAID-only lock that protects an invoice once
// money has moved.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  invoiceFindFirst: vi.fn(),
  lineDeleteMany: vi.fn(),
  lineCreateMany: vi.fn(),
  invoiceUpdate: vi.fn(),
  transaction: vi.fn(),
  resync: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/invoicing', () => ({ resyncReceivableToXero: h.resync }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findFirst: h.invoiceFindFirst, update: h.invoiceUpdate },
    invoiceLineItem: { deleteMany: h.lineDeleteMany, createMany: h.lineCreateMany },
    $transaction: h.transaction,
  },
}))

import { PATCH } from '@/app/api/trainer/finances/receivables/[id]/route'

const params = Promise.resolve({ id: 'inv_1' })

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/trainer/finances/receivables/inv_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

// What the composer sends when settling a $770 package and upselling a pouch:
// the ORIGINAL line plus the new one, never the new one alone.
const MERGED = [
  { description: 'Puppy Foundations 6-pack', quantity: 1, unitAmountCents: 77000 },
  { description: 'High-value treat pouch', quantity: 1, unitAmountCents: 3200 },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ companyId: 'co_1', role: 'OWNER', permissions: null })
  h.invoiceFindFirst.mockResolvedValue({ id: 'inv_1', status: 'UNPAID', xeroInvoiceId: null })
  h.transaction.mockResolvedValue([])
})

describe('settling a pay-later invoice with an upsell', () => {
  it('writes the full merged set and totals it correctly', async () => {
    const res = await PATCH(req({ lines: MERGED }), { params })

    expect(res.status).toBe(200)
    // deleteMany + createMany + update are handed to $transaction as an array.
    expect(h.lineDeleteMany).toHaveBeenCalledWith({ where: { invoiceId: 'inv_1' } })
    expect(h.lineCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ description: 'Puppy Foundations 6-pack', amountCents: 77000, sortOrder: 0 }),
        expect.objectContaining({ description: 'High-value treat pouch', amountCents: 3200, sortOrder: 1 }),
      ],
    })
    expect(h.invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountCents: 80200 }) }),
    )
  })

  it('recomputes each line total rather than trusting the client', async () => {
    await PATCH(req({ lines: [{ description: 'Long line', quantity: 3, unitAmountCents: 4500 }] }), { params })

    expect(h.lineCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ quantity: 3, unitAmountCents: 4500, amountCents: 13500 })],
    })
    expect(h.invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountCents: 13500 }) }),
    )
  })

  it('demonstrates the replace-all hazard: sending only the upsell drops the package', async () => {
    // NOT how the composer must call it — this pins WHY it sends the merged set.
    await PATCH(req({ lines: [{ description: 'High-value treat pouch', quantity: 1, unitAmountCents: 3200 }] }), { params })

    // The $770 package line is gone and the invoice is now $32.
    expect(h.lineCreateMany.mock.calls[0][0].data).toHaveLength(1)
    expect(h.invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountCents: 3200 }) }),
    )
  })
})

describe('settling is locked once money has moved', () => {
  it.each([
    ['PARTIAL', /partly paid/i],
    ['PAID', /has been paid/i],
    ['CANCELLED', /locked/i],
  ])('409s on a %s invoice without touching the lines', async (status, msg) => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv_1', status, xeroInvoiceId: null })

    const res = await PATCH(req({ lines: MERGED }), { params })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toMatch(msg)
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.lineDeleteMany).not.toHaveBeenCalled()
  })
})

describe('settling — scoping and validation', () => {
  it('scopes the invoice lookup to the caller’s company', async () => {
    await PATCH(req({ lines: MERGED }), { params })

    expect(h.invoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv_1', trainerId: 'co_1' } }),
    )
  })

  it('404s another company’s invoice', async () => {
    h.invoiceFindFirst.mockResolvedValue(null)

    const res = await PATCH(req({ lines: MERGED }), { params })

    expect(res.status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('rejects an empty line set — an invoice always has at least one line', async () => {
    const res = await PATCH(req({ lines: [] }), { params })

    expect(res.status).toBe(400)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('re-pushes to Xero only when the invoice is already mirrored there', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv_1', status: 'UNPAID', xeroInvoiceId: 'xero_1' })
    h.resync.mockResolvedValue(undefined)

    await PATCH(req({ lines: MERGED }), { params })

    expect(h.resync).toHaveBeenCalledWith('inv_1')
  })

  it('does not touch Xero for an unmirrored invoice', async () => {
    await PATCH(req({ lines: MERGED }), { params })

    expect(h.resync).not.toHaveBeenCalled()
  })
})
