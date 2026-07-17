import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/trainer/finances/sales/guest — an instant sale to a walk-up who
// isn't a client.
//
// The load-bearing test here is "never sends productId". The Connect webhook
// fulfils a paid line with:
//
//   if (item.kind === 'PRODUCT' && item.productId)
//     tx.productRequest.create({ data: { clientId: payment.clientId, ... } })
//
// A guest Payment has clientId: null, and ProductRequest.clientId is REQUIRED —
// so sending productId would throw inside the fulfilment transaction *after the
// customer has already been charged*. Omitting it skips that branch entirely.
// If someone "helpfully" adds productId back to make the line link to a
// product, this suite is what stops it reaching prod.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  hasAddon: vi.fn(),
  trainerFindUnique: vi.fn(),
  createConnectCheckout: vi.fn(),
  isConnectConfigured: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/prisma', () => ({ prisma: { trainerProfile: { findUnique: h.trainerFindUnique } } }))
vi.mock('@/lib/connect-checkout', () => ({ createConnectCheckout: h.createConnectCheckout }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: h.isConnectConfigured }))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com' } }))

import { POST } from '@/app/api/trainer/finances/sales/guest/route'

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/trainer/finances/sales/guest', {
    method: 'POST',
    body: JSON.stringify(body),
  })

const body = (over: Record<string, unknown> = {}) => ({
  lines: [{ description: 'Treat pouch', quantity: 2, unitAmountCents: 3200 }],
  ...over,
})

const PAYING_TRAINER = {
  acceptPaymentsEnabled: true,
  connectChargesEnabled: true,
  connectAccountId: 'acct_123',
  payoutCurrency: 'nzd',
  sandboxBilling: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ companyId: 'co_1', role: 'OWNER', permissions: null })
  h.hasAddon.mockResolvedValue(true)
  h.trainerFindUnique.mockResolvedValue(PAYING_TRAINER)
  h.isConnectConfigured.mockReturnValue(true)
  h.createConnectCheckout.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/abc', paymentId: 'pay_1' })
})

describe('guest sale — the webhook hazard', () => {
  it('never sends productId or intent, so the webhook cannot fulfil to a null client', async () => {
    await POST(req(body()))

    const { lines } = h.createConnectCheckout.mock.calls[0][0]
    for (const line of lines) {
      expect(line.productId, 'productId would make the webhook write ProductRequest.clientId = null').toBeUndefined()
      expect(line.intent).toBeUndefined()
    }
  })

  it('charges with no client attached', async () => {
    await POST(req(body()))

    expect(h.createConnectCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: null, trainerId: 'co_1', connectAccountId: 'acct_123' }),
    )
  })

  it('still snapshots the line so it shows in earnings', async () => {
    await POST(req(body()))

    const { lines } = h.createConnectCheckout.mock.calls[0][0]
    expect(lines[0]).toMatchObject({ kind: 'PRODUCT', description: 'Treat pouch', quantity: 2, unitAmount: 3200 })
  })
})

describe('guest sale — payment prerequisites', () => {
  it.each([
    ['payments switched off', { ...PAYING_TRAINER, acceptPaymentsEnabled: false }],
    ['charges not enabled yet', { ...PAYING_TRAINER, connectChargesEnabled: false }],
    ['no connected account', { ...PAYING_TRAINER, connectAccountId: null }],
  ])('409s PAYMENTS_REQUIRED when %s — a guest can’t be invoiced instead', async (_l, trainer) => {
    h.trainerFindUnique.mockResolvedValue(trainer)

    const res = await POST(req(body()))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'PAYMENTS_REQUIRED' })
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('503s when Connect isn’t configured on the platform', async () => {
    h.isConnectConfigured.mockReturnValue(false)

    const res = await POST(req(body()))

    expect(res.status).toBe(503)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('502s rather than pretending it worked when Stripe returns no url', async () => {
    h.createConnectCheckout.mockResolvedValue({ url: null, paymentId: 'pay_1' })

    const res = await POST(req(body()))

    expect(res.status).toBe(502)
  })
})

describe('guest sale — guards', () => {
  it('rejects when the permission guard fails', async () => {
    const { NextResponse } = await import('next/server')
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))

    const res = await POST(req(body()))

    expect(res.status).toBe(403)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('403s when the pos add-on is off', async () => {
    h.hasAddon.mockResolvedValue(false)

    const res = await POST(req(body()))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'ADDON_REQUIRED' })
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it.each([
    ['no lines', body({ lines: [] })],
    ['zero quantity', body({ lines: [{ description: 'x', quantity: 0, unitAmountCents: 100 }] })],
    ['negative amount', body({ lines: [{ description: 'x', quantity: 1, unitAmountCents: -1 }] })],
    ['empty description', body({ lines: [{ description: '', quantity: 1, unitAmountCents: 100 }] })],
  ])('400s on %s', async (_l, b) => {
    const res = await POST(req(b))

    expect(res.status).toBe(400)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('400s a zero-total sale rather than minting a £0 checkout', async () => {
    const res = await POST(req(body({ lines: [{ description: 'Freebie', quantity: 2, unitAmountCents: 0 }] })))

    expect(res.status).toBe(400)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })
})

describe('guest sale — response', () => {
  it('returns the checkout url and total for the QR', async () => {
    const res = await POST(req(body()))

    await expect(res.json()).resolves.toEqual({
      url: 'https://checkout.stripe.com/c/pay/abc',
      amountCents: 6400, // 2 × 3200
    })
  })

  it('sends the guest back to the public thanks page, not a gated one', async () => {
    await POST(req(body()))

    const { successUrl, cancelUrl } = h.createConnectCheckout.mock.calls[0][0]
    // A guest has no login, so the return page must be in PUBLIC_PATHS.
    expect(successUrl).toContain('/sale/thanks')
    expect(cancelUrl).toContain('/sale/thanks')
  })

  it('summarises a multi-line guest sale', async () => {
    await POST(req(body({
      lines: [
        { description: 'Treat pouch', quantity: 1, unitAmountCents: 3200 },
        { description: 'Long line', quantity: 1, unitAmountCents: 4500 },
      ],
    })))

    expect(h.createConnectCheckout.mock.calls[0][0].description).toBe('Treat pouch +1 more')
  })
})
