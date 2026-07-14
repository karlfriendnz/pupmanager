import { describe, it, expect, vi, beforeEach } from 'vitest'

// The ONBOARDING chokepoint for Connect. The old CONNECT_LIVE_ALLOWLIST rollout
// gate is GONE — payments are open to every trainer, and Stripe's own onboarding
// (charges_enabled) is the only thing standing between a trainer and taking
// money. What still has to hold: auth, owner-only, and Stripe being configured.
// POST /api/connect/account. A non-allowlisted LIVE trainer must be refused a
// payout account (403) so no real trainer can start transacting during the soft
// launch; sandbox (demo) trainers always pass. (The pure predicate is unit-
// tested in payments-fees.test.ts; this asserts the route actually calls it.)

const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  trainerFindUnique: vi.fn(),
  trainerUpdate: vi.fn(),
  isConnectConfigured: vi.fn(),
  createExpressAccount: vi.fn(),
  createOnboardingLink: vi.fn(),
  currencyForCountry: vi.fn(() => 'nzd'),
  recordAudit: vi.fn(),
  auditRequestMeta: vi.fn(() => ({})),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: h.requireSameOrigin }))
vi.mock('@/lib/audit', () => ({ recordAudit: h.recordAudit, auditRequestMeta: h.auditRequestMeta }))
vi.mock('@/lib/connect', () => ({
  createExpressAccount: h.createExpressAccount,
  createOnboardingLink: h.createOnboardingLink,
  currencyForCountry: h.currencyForCountry,
  isConnectConfigured: h.isConnectConfigured,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { trainerProfile: { findUnique: h.trainerFindUnique, update: h.trainerUpdate } },
}))

import { POST } from '@/app/api/connect/account/route'

const req = () => new Request('https://app.pupmanager.com/api/connect/account', { method: 'POST' })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.requireSameOrigin.mockReturnValue(null) // same-origin OK
  h.isConnectConfigured.mockReturnValue(true)
  h.currencyForCountry.mockReturnValue('nzd')
  h.createExpressAccount.mockResolvedValue({ id: 'acct_new' })
  h.createOnboardingLink.mockResolvedValue('https://connect.stripe.test/onboard')
  h.trainerUpdate.mockResolvedValue({})
  h.auditRequestMeta.mockReturnValue({})
})

describe('POST /api/connect/account — live allowlist onboarding gate', () => {
  it('401 when not an authenticated trainer', async () => {
    h.getTrainerContext.mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(h.createExpressAccount).not.toHaveBeenCalled()
  })

  it('an ordinary LIVE trainer can onboard — no allowlist stands in the way', async () => {
    h.getTrainerContext.mockResolvedValue({ userId: 'u1', companyId: 't1', membershipId: 'm1', role: 'OWNER', permissions: {} })
    h.trainerFindUnique.mockResolvedValue({ connectAccountId: null, sandboxBilling: false, payoutCurrency: null, signupCountry: 'NZ', addressCountry: null, businessName: 'X', user: { email: 'a@b.c' } })
    const res = await POST(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://connect.stripe.test/onboard')
    expect(h.createExpressAccount).toHaveBeenCalledTimes(1)
  })

  it('sandbox (demo) trainer can onboard too', async () => {
    h.getTrainerContext.mockResolvedValue({ userId: 'u1', companyId: 't1', membershipId: 'm1', role: 'OWNER', permissions: {} })
    h.trainerFindUnique.mockResolvedValue({ connectAccountId: null, sandboxBilling: true, payoutCurrency: null, signupCountry: 'NZ', addressCountry: null, businessName: 'X', user: { email: 'a@b.c' } })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(h.createExpressAccount).toHaveBeenCalledTimes(1)
  })
})
