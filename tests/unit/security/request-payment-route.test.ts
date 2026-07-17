import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/trainer/finances/receivables/[id]/request-payment — buzzes the
// client's phone with a tap-through to that invoice's pay screen.
//
// This one MESSAGES A REAL PERSON, so the guards matter more than usual: it must
// never fire for another company's client, never nag about an invoice with
// nothing left to pay, and never point at a pay screen that doesn't exist.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  invoiceFindFirst: vi.fn(),
  notifyClient: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/prisma', () => ({ prisma: { invoice: { findFirst: h.invoiceFindFirst } } }))

import { NextResponse } from 'next/server'
import { POST } from '@/app/api/trainer/finances/receivables/[id]/request-payment/route'

const params = Promise.resolve({ id: 'inv_1' })
const req = () => new Request('https://app.pupmanager.com/x', { method: 'POST' })

const INVOICE = {
  id: 'inv_1',
  status: 'UNPAID',
  amountCents: 3300,
  amountPaidCents: 0,
  currency: 'nzd',
  description: 'Puppy Foundations',
  payToken: 'tok_abc',
  client: { userId: 'user_1' },
  trainer: { businessName: 'Pawsome Dog Training' },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ companyId: 'co_1', role: 'OWNER', permissions: null })
  h.invoiceFindFirst.mockResolvedValue(INVOICE)
  h.notifyClient.mockResolvedValue(undefined)
})

describe('request-payment — what the client receives', () => {
  it('taps through to THIS invoice’s pay screen', async () => {
    const res = await POST(req(), { params })

    expect(res.status).toBe(200)
    expect(h.notifyClient).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        trainerId: 'co_1',
        type: 'CLIENT_PAYMENT_REQUEST',
        link: '/my-invoices/tok_abc',
      }),
    )
  })

  it('asks for the OUTSTANDING balance, not the invoice total', async () => {
    // Part-paid: $33.00 raised, $10.00 already in — so ask for $23.00.
    h.invoiceFindFirst.mockResolvedValue({ ...INVOICE, status: 'PARTIAL', amountPaidCents: 1000 })

    await POST(req(), { params })

    expect(h.notifyClient.mock.calls[0][0].vars).toMatchObject({ amount: '$23.00' })
  })

  it('names the business and what it’s for', async () => {
    await POST(req(), { params })

    expect(h.notifyClient.mock.calls[0][0].vars).toMatchObject({
      trainerName: 'Pawsome Dog Training',
      description: 'Puppy Foundations',
    })
  })

  it('falls back gracefully when the invoice has no description', async () => {
    h.invoiceFindFirst.mockResolvedValue({ ...INVOICE, description: null })

    await POST(req(), { params })

    expect(h.notifyClient.mock.calls[0][0].vars.description).toBe('your booking')
  })
})

describe('request-payment — guards', () => {
  it('rejects when the permission guard fails, without messaging anyone', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))

    const res = await POST(req(), { params })

    expect(res.status).toBe(403)
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('scopes the invoice to the caller’s company', async () => {
    await POST(req(), { params })

    expect(h.invoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv_1', trainerId: 'co_1' } }),
    )
  })

  it('404s another company’s invoice rather than messaging their client', async () => {
    h.invoiceFindFirst.mockResolvedValue(null)

    const res = await POST(req(), { params })

    expect(res.status).toBe(404)
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it.each([
    ['PAID', 'nothing left to pay'],
    ['CANCELLED', 'cancelled'],
  ])('409s on a %s invoice — no nagging for money not owed', async (status) => {
    h.invoiceFindFirst.mockResolvedValue({ ...INVOICE, status })

    const res = await POST(req(), { params })

    expect(res.status).toBe(409)
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('still allows a PARTIAL invoice — there’s a balance owing', async () => {
    h.invoiceFindFirst.mockResolvedValue({ ...INVOICE, status: 'PARTIAL', amountPaidCents: 1000 })

    const res = await POST(req(), { params })

    expect(res.status).toBe(200)
    expect(h.notifyClient).toHaveBeenCalled()
  })

  it('409s when there’s no payToken — nowhere to send them', async () => {
    h.invoiceFindFirst.mockResolvedValue({ ...INVOICE, payToken: null })

    const res = await POST(req(), { params })

    expect(res.status).toBe(409)
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('409s for a guest sale — no client to notify', async () => {
    h.invoiceFindFirst.mockResolvedValue({ ...INVOICE, client: null })

    const res = await POST(req(), { params })

    expect(res.status).toBe(409)
    expect(h.notifyClient).not.toHaveBeenCalled()
  })
})
