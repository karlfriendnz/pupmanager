import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Xero manual retry route. Security/behaviour focus:
//   - same-origin + owner-only
//   - ownership scoping (can't retry another trainer's payment → 404)
//   - dispatches to payment sync when PAID, invoice sync when unpaid
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  paymentFindFirst: vi.fn(),
  requireSameOrigin: vi.fn((): Response | null => null),
  syncInvoiceToXero: vi.fn(),
  syncPaymentToXero: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: h.requireSameOrigin }))
vi.mock('@/lib/prisma', () => ({ prisma: { payment: { findFirst: h.paymentFindFirst } } }))
vi.mock('@/lib/xero-sync', () => ({ syncInvoiceToXero: h.syncInvoiceToXero, syncPaymentToXero: h.syncPaymentToXero }))

import { POST } from '@/app/api/xero/retry/route'

function asOwner(trainerId = 't-1') {
  h.guardPermission.mockResolvedValue({ userId: 'u-1', companyId: trainerId, membershipId: 'm-1', role: 'OWNER', permissions: {} })
}
function req(body: unknown = { paymentId: 'pay-1' }) {
  return new Request('http://localhost/api/xero/retry', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSameOrigin.mockReturnValue(null)
  h.syncInvoiceToXero.mockResolvedValue({ ok: true, invoiceId: 'INV-1' })
  h.syncPaymentToXero.mockResolvedValue({ ok: true, xeroPaymentId: 'PAY-1' })
})

describe('guards', () => {
  it('respects the CSRF guard', async () => {
    asOwner()
    h.requireSameOrigin.mockReturnValue(new Response('no', { status: 403 }))
    expect((await POST(req())).status).toBe(403)
    expect(h.paymentFindFirst).not.toHaveBeenCalled()
  })

  it('401s a non-owner', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await POST(req())).status).toBe(403)
  })

  it('404s when the payment is not this trainer’s', async () => {
    asOwner()
    h.paymentFindFirst.mockResolvedValue(null)
    expect((await POST(req())).status).toBe(404)
    // ownership is enforced in the query filter
    expect(h.paymentFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pay-1', trainerId: 't-1' },
      select: expect.anything(),
    }))
  })
})

describe('dispatch', () => {
  it('runs the payment sync for a PAID invoice', async () => {
    asOwner()
    h.paymentFindFirst.mockResolvedValue({ id: 'pay-1', status: 'PAID' })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(h.syncPaymentToXero).toHaveBeenCalledWith('pay-1')
    expect(h.syncInvoiceToXero).not.toHaveBeenCalled()
  })

  it('runs the invoice sync for an unpaid invoice', async () => {
    asOwner()
    h.paymentFindFirst.mockResolvedValue({ id: 'pay-1', status: 'PENDING' })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(h.syncInvoiceToXero).toHaveBeenCalledWith('pay-1')
    expect(h.syncPaymentToXero).not.toHaveBeenCalled()
  })
})
