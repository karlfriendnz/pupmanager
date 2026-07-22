import { describe, it, expect, vi, beforeEach } from 'vitest'

// Both of these move money around, so the failure modes that matter are
// double-counting, losing a payment, and reaching another business's invoices.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findFirst: h.findFirst, findMany: h.findMany, update: h.update, create: h.create, updateMany: h.updateMany },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ invoice: { create: h.create, updateMany: h.updateMany } }),
  },
}))

import { POST as recordPayment } from '@/app/api/trainer/finances/receivables/[id]/record-payment/route'
import { POST as combine } from '@/app/api/trainer/finances/receivables/combine/route'

const pay = (body: unknown) =>
  recordPayment(new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
                { params: Promise.resolve({ id: 'inv_1' }) })

const merge = (body: unknown) =>
  combine(new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

const INV = (over = {}) => ({
  id: 'a', clientId: 'c1', currency: 'nzd', status: 'UNPAID', amountCents: 5000,
  amountPaidCents: 0, description: 'Puppy class', mergedIntoId: null,
  lines: [{ description: 'Session', quantity: 1, unitAmountCents: 5000, amountCents: 5000 }],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ companyId: 'tr_me', userId: 'u' })
  h.update.mockImplementation(async ({ data }) => ({ id: 'inv_1', amountCents: 5000, ...data }))
  h.create.mockResolvedValue({ id: 'inv_new', amountCents: 8000, payToken: 'tok' })
  h.updateMany.mockResolvedValue({ count: 2 })
})

describe('record a manual payment', () => {
  it('marks it paid in full when no amount is given', async () => {
    h.findFirst.mockResolvedValue({ id: 'inv_1', amountCents: 5000, amountPaidCents: 0, status: 'UNPAID' })
    const res = await pay({ method: 'BANK_TRANSFER', reference: 'ANZ 12 Aug' })
    expect(res.status).toBe(200)
    const data = h.update.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'PAID', amountPaidCents: 5000, paymentMethod: 'BANK_TRANSFER', paymentReference: 'ANZ 12 Aug' })
  })

  it('a part payment lands as PARTIAL', async () => {
    h.findFirst.mockResolvedValue({ id: 'inv_1', amountCents: 5000, amountPaidCents: 0, status: 'UNPAID' })
    await pay({ method: 'CASH', amountCents: 2000 })
    expect(h.update.mock.calls[0][0].data).toMatchObject({ status: 'PARTIAL', amountPaidCents: 2000 })
  })

  // Two $20s against a $50 invoice = $40 paid, not $20.
  it('accumulates instead of replacing', async () => {
    h.findFirst.mockResolvedValue({ id: 'inv_1', amountCents: 5000, amountPaidCents: 2000, status: 'PARTIAL' })
    await pay({ method: 'BANK_TRANSFER', amountCents: 2000 })
    expect(h.update.mock.calls[0][0].data).toMatchObject({ amountPaidCents: 4000, status: 'PARTIAL' })
  })

  it("won't touch another business's invoice", async () => {
    h.findFirst.mockResolvedValue(null)
    expect((await pay({ method: 'CASH' })).status).toBe(404)
    expect(h.update).not.toHaveBeenCalled()
    // The lookup must be scoped, not by id alone.
    expect(h.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'inv_1', trainerId: 'tr_me' })
  })

  it('refuses a cancelled invoice', async () => {
    h.findFirst.mockResolvedValue({ id: 'inv_1', amountCents: 5000, amountPaidCents: 0, status: 'CANCELLED' })
    expect((await pay({ method: 'CASH' })).status).toBe(409)
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe('combine invoices', () => {
  it('sums the total and carries every line across', async () => {
    h.findMany.mockResolvedValue([INV({ id: 'a', amountCents: 5000 }), INV({ id: 'b', amountCents: 3000 })])
    const res = await merge({ invoiceIds: ['a', 'b'] })
    expect(res.status).toBe(200)
    const data = h.create.mock.calls[0][0].data
    expect(data.amountCents).toBe(8000)
    expect(data.lines.create).toHaveLength(2)
    // No sourceType/sourceId — that's the assignment idempotency key, and
    // reusing one would make a later assignment think it was already invoiced.
    expect(data.sourceType).toBeUndefined()
    expect(data.sourceId).toBeUndefined()
  })

  it('cancels the originals and points them at the replacement', async () => {
    h.findMany.mockResolvedValue([INV({ id: 'a' }), INV({ id: 'b' })])
    await merge({ invoiceIds: ['a', 'b'] })
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
      data: { status: 'CANCELLED', mergedIntoId: 'inv_new' },
    })
  })

  it('refuses invoices from different clients', async () => {
    h.findMany.mockResolvedValue([INV({ id: 'a' }), INV({ id: 'b', clientId: 'c2' })])
    expect((await merge({ invoiceIds: ['a', 'b'] })).status).toBe(409)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses mixed currencies', async () => {
    h.findMany.mockResolvedValue([INV({ id: 'a' }), INV({ id: 'b', currency: 'gbp' })])
    expect((await merge({ invoiceIds: ['a', 'b'] })).status).toBe(409)
  })

  // Combining something already part-paid would strand that payment.
  it('refuses anything already paid or part-paid', async () => {
    h.findMany.mockResolvedValue([INV({ id: 'a' }), INV({ id: 'b', amountPaidCents: 1000, status: 'PARTIAL' })])
    expect((await merge({ invoiceIds: ['a', 'b'] })).status).toBe(409)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses one that was already merged', async () => {
    h.findMany.mockResolvedValue([INV({ id: 'a' }), INV({ id: 'b', mergedIntoId: 'inv_old' })])
    expect((await merge({ invoiceIds: ['a', 'b'] })).status).toBe(409)
  })

  // An id belonging to another business simply won't come back from the
  // tenant-scoped query, so the count mismatch catches it.
  it('404s when an id is not reachable', async () => {
    h.findMany.mockResolvedValue([INV({ id: 'a' })])
    expect((await merge({ invoiceIds: ['a', 'b'] })).status).toBe(404)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('needs at least two', async () => {
    expect((await merge({ invoiceIds: ['a'] })).status).toBe(400)
  })
})
