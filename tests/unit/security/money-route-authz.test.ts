import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression tests for the privilege-escalation + abuse fixes found in the audit:
//   - refund + Stripe Connect account = OWNER-only (a STAFF/MANAGER member, who
//     also authenticates as role TRAINER, must be rejected)
//   - billing checkout = billing.seats permission (OWNER by default)
//   - signup is IP rate-limited
// Restricted members carry role TRAINER, so a role check alone is NOT enough —
// these assert the company-role / permission gate specifically.
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  auth: vi.fn(),
  requireSameOrigin: vi.fn((): Response | null => null),
  enforceRateLimit: vi.fn(async (): Promise<Response | null> => null),
  getClientIp: vi.fn(() => '1.2.3.4'),
  paymentFindUnique: vi.fn(),
  trainerProfileFindUnique: vi.fn(),
  trainerProfileUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  isStripeConfigured: vi.fn(() => true),
  isConnectConfigured: vi.fn(() => true),
  isLivePaymentsAllowed: vi.fn(() => true),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: h.requireSameOrigin }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: h.getClientIp }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: { findUnique: h.paymentFindUnique },
    trainerProfile: { findUnique: h.trainerProfileFindUnique, update: h.trainerProfileUpdate },
    user: { findUnique: h.userFindUnique },
  },
}))
vi.mock('@/lib/stripe', () => ({ stripeFor: vi.fn(), isStripeConfigured: h.isStripeConfigured }))
vi.mock('@/lib/connect', () => ({
  createExpressAccount: vi.fn(), createOnboardingLink: vi.fn(),
  currencyForCountry: vi.fn(() => 'NZD'),
  isConnectConfigured: h.isConnectConfigured, isLivePaymentsAllowed: h.isLivePaymentsAllowed,
}))
vi.mock('@/lib/audit', () => ({ recordAudit: h.recordAudit, auditRequestMeta: () => ({}) }))

import { POST as refundPOST } from '@/app/api/trainer/payments/[id]/refund/route'
import { PATCH as connectPATCH } from '@/app/api/connect/account/route'
import { POST as checkoutPOST } from '@/app/api/billing/checkout/route'
import { POST as signupPOST } from '@/app/api/auth/signup/route'

const ctx = (role: 'OWNER' | 'MANAGER' | 'STAFF') => ({ userId: 'u1', companyId: 'co1', membershipId: 'm1', role, permissions: {} })
const jsonReq = (url: string, body: unknown = {}) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSameOrigin.mockReturnValue(null)
  h.enforceRateLimit.mockResolvedValue(null)
})

describe('refund — OWNER only', () => {
  const run = (role: 'OWNER' | 'MANAGER' | 'STAFF') => {
    h.getTrainerContext.mockResolvedValue(ctx(role))
    return refundPOST(jsonReq('http://localhost/api/trainer/payments/p1/refund', {}), { params: Promise.resolve({ id: 'p1' }) })
  }

  it('403s a STAFF member and never looks up the payment', async () => {
    const res = await run('STAFF')
    expect(res.status).toBe(403)
    expect(h.paymentFindUnique).not.toHaveBeenCalled()
  })

  it('403s a MANAGER member', async () => {
    expect((await run('MANAGER')).status).toBe(403)
  })

  it('lets the OWNER through the gate (reaches ownership lookup)', async () => {
    h.paymentFindUnique.mockResolvedValue(null) // → 404, proving we passed the owner gate
    const res = await run('OWNER')
    expect(res.status).toBe(404)
    expect(h.paymentFindUnique).toHaveBeenCalled()
  })
})

describe('Stripe Connect account PATCH — OWNER only', () => {
  const run = (role: 'OWNER' | 'MANAGER' | 'STAFF') => {
    h.getTrainerContext.mockResolvedValue(ctx(role))
    return connectPATCH(jsonReq('http://localhost/api/connect/account', { acceptPaymentsEnabled: false }))
  }

  it('403s a STAFF member and never mutates the profile', async () => {
    const res = await run('STAFF')
    expect(res.status).toBe(403)
    expect(h.trainerProfileUpdate).not.toHaveBeenCalled()
  })

  it('lets the OWNER toggle payment settings', async () => {
    h.trainerProfileUpdate.mockResolvedValue({})
    const res = await run('OWNER')
    expect(res.status).toBe(200)
    expect(h.trainerProfileUpdate).toHaveBeenCalled()
  })
})

describe('billing checkout — billing.seats permission', () => {
  const run = (role: 'OWNER' | 'MANAGER' | 'STAFF') => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: 'co1', id: 'u1' } })
    h.getTrainerContext.mockResolvedValue(ctx(role))
    return checkoutPOST(jsonReq('http://localhost/api/billing/checkout', { planId: 'p', phone: '123456', addressCity: 'X', addressCountry: 'NZ' }))
  }

  it('403s a STAFF member (no billing.seats by default) before any Stripe/DB work', async () => {
    const res = await run('STAFF')
    expect(res.status).toBe(403)
    expect(h.trainerProfileFindUnique).not.toHaveBeenCalled()
  })

  it('403s a MANAGER member (billing.seats off by default)', async () => {
    expect((await run('MANAGER')).status).toBe(403)
  })
})

describe('signup — IP rate limited', () => {
  it('returns the limiter response and never touches the DB when throttled', async () => {
    h.enforceRateLimit.mockResolvedValue(new Response(JSON.stringify({ error: 'rate' }), { status: 429 }))
    const res = await signupPOST(jsonReq('http://localhost/api/auth/signup', { name: 'A', businessName: 'B', phone: '123456', email: 'a@b.com', password: 'password1' }))
    expect(res.status).toBe(429)
    expect(h.userFindUnique).not.toHaveBeenCalled()
    expect(h.enforceRateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: 'signup:1.2.3.4' }))
  })
})
