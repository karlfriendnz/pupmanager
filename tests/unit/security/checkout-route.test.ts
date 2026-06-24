import { describe, it, expect, vi, beforeEach } from 'vitest'

// Security coverage for the client→trainer checkout chokepoints:
//   1) POST /api/my/products/[productId]/buy — the route that starts a charge.
//   2) connect-checkout lib (createPaymentRecord + mintCheckoutSession) — the
//      money math + the live-allowlist mint gate.
//
// Everything external is mocked: no Stripe network call, no real DB. We assert
// REAL status codes and that amounts come from server-side records, never the
// request body.

const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  clientFindUnique: vi.fn(),
  productFindUnique: vi.fn(),
  trainerFindUnique: vi.fn(),
  enforceRateLimit: vi.fn(),
  createConnectCheckout: vi.fn(),
  isConnectConfigured: vi.fn(),
  env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com' },
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit }))
vi.mock('@/lib/connect-checkout', () => ({ createConnectCheckout: h.createConnectCheckout }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: h.isConnectConfigured }))
vi.mock('@/lib/env', () => ({ env: h.env }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientFindUnique },
    product: { findUnique: h.productFindUnique },
    trainerProfile: { findUnique: h.trainerFindUnique },
  },
}))

import { POST } from '@/app/api/my/products/[productId]/buy/route'

function buyReq(body?: unknown, headers?: Record<string, string>) {
  return new Request('https://app.pupmanager.com/api/my/products/p1/buy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const params = (productId: string) => ({ params: Promise.resolve({ productId }) })

beforeEach(() => {
  Object.values(h).forEach(v => { if (typeof v === 'function') (v as ReturnType<typeof vi.fn>).mockReset() })
  h.enforceRateLimit.mockResolvedValue(null) // not rate-limited by default
  h.isConnectConfigured.mockReturnValue(true)
  h.createConnectCheckout.mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1', paymentId: 'pay_1' })
})

describe('POST /api/my/products/[productId]/buy — authz + tenant + amount-trust', () => {
  it('401 when there is no acting client (unauthenticated)', async () => {
    h.getActiveClient.mockResolvedValue(null)
    const res = await POST(buyReq(), params('p1'))
    expect(res.status).toBe(401)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('403 when a trainer is PREVIEWING the client app (no real charge)', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'c1', isPreview: true })
    h.clientFindUnique.mockResolvedValue({ id: 'c1', trainerId: 't1' })
    const res = await POST(buyReq(), params('p1'))
    expect(res.status).toBe(403)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('404 when the product belongs to ANOTHER trainer (cross-tenant)', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'c1', isPreview: false })
    h.clientFindUnique.mockResolvedValue({ id: 'c1', trainerId: 'MY-trainer' })
    // Product is owned by a different trainer than the acting client's trainer.
    h.productFindUnique.mockResolvedValue({ id: 'p1', trainerId: 'OTHER-trainer', active: true, name: 'Leash', kind: 'PHYSICAL', priceCents: 5000 })
    const res = await POST(buyReq(), params('p1'))
    expect(res.status).toBe(404)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('404 when the product is inactive', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'c1', isPreview: false })
    h.clientFindUnique.mockResolvedValue({ id: 'c1', trainerId: 't1' })
    h.productFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', active: false, name: 'Leash', kind: 'PHYSICAL', priceCents: 5000 })
    const res = await POST(buyReq(), params('p1'))
    expect(res.status).toBe(404)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('400 when the product has no online price', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'c1', isPreview: false })
    h.clientFindUnique.mockResolvedValue({ id: 'c1', trainerId: 't1' })
    h.productFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', active: true, name: 'Leash', kind: 'PHYSICAL', priceCents: 0 })
    const res = await POST(buyReq(), params('p1'))
    expect(res.status).toBe(400)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('409 when the trainer is not accepting payments', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'c1', isPreview: false })
    h.clientFindUnique.mockResolvedValue({ id: 'c1', trainerId: 't1' })
    h.productFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', active: true, name: 'Leash', kind: 'PHYSICAL', priceCents: 5000 })
    h.trainerFindUnique.mockResolvedValue({ acceptPaymentsEnabled: false, connectChargesEnabled: true, connectAccountId: 'acct_1', payoutCurrency: 'nzd', sandboxBilling: true })
    const res = await POST(buyReq(), params('p1'))
    expect(res.status).toBe(409)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('403 backstop: a DIGITAL product cannot be bought from the iOS native app', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'c1', isPreview: false })
    h.clientFindUnique.mockResolvedValue({ id: 'c1', trainerId: 't1' })
    h.productFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', active: true, name: 'eBook', kind: 'DIGITAL', priceCents: 5000 })
    const res = await POST(buyReq(undefined, { 'x-pm-platform': 'ios' }), params('p1'))
    expect(res.status).toBe(403)
    expect(h.createConnectCheckout).not.toHaveBeenCalled()
  })

  it('charges the SERVER-SIDE product price and IGNORES any amount in the request body', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'c1', isPreview: false })
    h.clientFindUnique.mockResolvedValue({ id: 'c1', trainerId: 't1' })
    h.productFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', active: true, name: 'Leash', kind: 'PHYSICAL', priceCents: 5000 })
    h.trainerFindUnique.mockResolvedValue({ acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: 'acct_1', payoutCurrency: 'nzd', sandboxBilling: true })

    // Attacker tries to pay 1 cent (and tamper trainerId/connectAccountId).
    const res = await POST(buyReq({ priceCents: 1, unitAmount: 1, amount: 1, trainerId: 'OTHER', connectAccountId: 'acct_evil' }), params('p1'))
    expect(res.status).toBe(200)
    expect(h.createConnectCheckout).toHaveBeenCalledTimes(1)
    const arg = h.createConnectCheckout.mock.calls[0][0]
    // Amount + tenant come from server records, not the body.
    expect(arg.lines[0].unitAmount).toBe(5000)
    expect(arg.trainerId).toBe('t1')
    expect(arg.connectAccountId).toBe('acct_1')
  })
})

// NOTE: the connect-checkout LIBRARY internals (createPaymentRecord totals +
// surcharge, mintCheckoutSession allowlist/direct-charge) are exercised in
// connect-checkout-lib.test.ts — that file must NOT mock @/lib/connect-checkout
// (which we mock here for the route), so they live apart.
