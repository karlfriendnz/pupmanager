import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/pay/[token]/checkout — the PUBLIC (no-login) invoice checkout.
// Security focus: unguessable-token lookup, SERVER-side balance (never trust a
// client amount), reject non-payable / zero-balance invoices, rate-limited,
// and the charge lands on the invoice's OWN trainer's Connect account.
const h = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  createConnectCheckout: vi.fn(),
  isConnectConfigured: vi.fn(() => true),
  enforceRateLimit: vi.fn(),
  getClientIp: vi.fn(() => '1.2.3.4'),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { invoice: { findUnique: h.invoiceFindUnique } } }))
vi.mock('@/lib/connect-checkout', () => ({ createConnectCheckout: h.createConnectCheckout }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: h.isConnectConfigured }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: h.getClientIp }))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }))

import { POST } from '@/app/api/pay/[token]/checkout/route'
import { NextResponse } from 'next/server'

// The client tries to sneak an amount in — it must be ignored.
function req() {
  return new Request('http://x/api/pay/tok/checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 1 }),
  })
}
function params(token = 'tok-abcdefgh') {
  return { params: Promise.resolve({ token }) }
}

const TRAINER = { id: 't-1', connectAccountId: 'acct_1', acceptPaymentsEnabled: true, connectChargesEnabled: true, sandboxBilling: false }

function seedInvoice(over: Record<string, unknown> = {}) {
  h.invoiceFindUnique.mockResolvedValue({
    id: 'inv-1', amountCents: 38000, amountPaidCents: 0, currency: 'nzd', status: 'UNPAID',
    description: 'Course', clientId: 'cp-1', payToken: 'tok-abcdefgh', trainer: { ...TRAINER },
    ...over,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.enforceRateLimit.mockResolvedValue(null)
  h.getClientIp.mockReturnValue('1.2.3.4')
  h.isConnectConfigured.mockReturnValue(true)
  h.createConnectCheckout.mockResolvedValue({ url: 'https://checkout.stripe/x', paymentId: 'pay-1' })
  seedInvoice()
})

describe('POST /api/pay/[token]/checkout', () => {
  it('404s an unknown token', async () => {
    h.invoiceFindUnique.mockResolvedValue(null)
    const res = await POST(req(), params())
    expect(res.status).toBe(404)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('404s a too-short token without a DB lookup', async () => {
    const res = await POST(req(), params('short'))
    expect(res.status).toBe(404)
    expect(h.invoiceFindUnique).not.toHaveBeenCalled()
  })

  it('charges the SERVER-computed balance (ignores any client-sent amount) on the trainer’s account', async () => {
    seedInvoice({ amountCents: 38000, amountPaidCents: 15000 }) // balance 23000
    const res = await POST(req(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe('https://checkout.stripe/x')
    const arg = h.createConnectCheckout.mock.calls[0][0]
    expect(arg.lines[0].unitAmount).toBe(23000) // NOT the client's { amount: 1 }
    expect(arg.lines[0].intent).toMatchObject({ invoicePayment: true, invoiceId: 'inv-1' })
    expect(arg.metadata).toEqual({ invoiceId: 'inv-1' })
    expect(arg.connectAccountId).toBe('acct_1')
    expect(arg.trainerId).toBe('t-1')
    expect(arg.clientId).toBe('cp-1')
  })

  it('409s a PAID invoice', async () => {
    seedInvoice({ status: 'PAID' })
    expect((await POST(req(), params())).status).toBe(409)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('409s a CANCELLED invoice', async () => {
    seedInvoice({ status: 'CANCELLED' })
    expect((await POST(req(), params())).status).toBe(409)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('409s a zero-balance invoice', async () => {
    seedInvoice({ amountCents: 38000, amountPaidCents: 38000 })
    expect((await POST(req(), params())).status).toBe(409)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('409s when the trainer isn’t taking card payments', async () => {
    seedInvoice({ trainer: { ...TRAINER, connectChargesEnabled: false } })
    expect((await POST(req(), params())).status).toBe(409)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response straight through (429) before any lookup', async () => {
    h.enforceRateLimit.mockResolvedValue(NextResponse.json({ error: 'slow down' }, { status: 429 }))
    const res = await POST(req(), params())
    expect(res.status).toBe(429)
    expect(h.invoiceFindUnique).not.toHaveBeenCalled()
  })
})
