import { describe, it, expect, vi, beforeEach } from 'vitest'

// The CONNECT_LIVE_ALLOWLIST gate as enforced at the ONBOARDING chokepoint:
// POST /api/connect/account. A non-allowlisted LIVE trainer must be refused a
// payout account (403) so no real trainer can start transacting during the soft
// launch; sandbox (demo) trainers always pass. (The pure predicate is unit-
// tested in payments-fees.test.ts; this asserts the route actually calls it.)

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSameOrigin: vi.fn(),
  trainerFindUnique: vi.fn(),
  trainerUpdate: vi.fn(),
  isConnectConfigured: vi.fn(),
  isLivePaymentsAllowed: vi.fn(),
  createExpressAccount: vi.fn(),
  createOnboardingLink: vi.fn(),
  currencyForCountry: vi.fn(() => 'nzd'),
  recordAudit: vi.fn(),
  auditRequestMeta: vi.fn(() => ({})),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: h.requireSameOrigin }))
vi.mock('@/lib/audit', () => ({ recordAudit: h.recordAudit, auditRequestMeta: h.auditRequestMeta }))
vi.mock('@/lib/connect', () => ({
  createExpressAccount: h.createExpressAccount,
  createOnboardingLink: h.createOnboardingLink,
  currencyForCountry: h.currencyForCountry,
  isConnectConfigured: h.isConnectConfigured,
  isLivePaymentsAllowed: h.isLivePaymentsAllowed,
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
    h.auth.mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(h.createExpressAccount).not.toHaveBeenCalled()
  })

  it('403 for a non-allowlisted LIVE trainer (no account created)', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u1', trainerId: 't1' } })
    h.trainerFindUnique.mockResolvedValue({ connectAccountId: null, sandboxBilling: false, payoutCurrency: null, signupCountry: 'NZ', addressCountry: null, businessName: 'X', user: { email: 'a@b.c' } })
    h.isLivePaymentsAllowed.mockReturnValue(false)
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect(h.isLivePaymentsAllowed).toHaveBeenCalledWith('t1', false)
    expect(h.createExpressAccount).not.toHaveBeenCalled()
  })

  it('sandbox (demo) trainer is always allowed to onboard', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u1', trainerId: 't1' } })
    h.trainerFindUnique.mockResolvedValue({ connectAccountId: null, sandboxBilling: true, payoutCurrency: null, signupCountry: 'NZ', addressCountry: null, businessName: 'X', user: { email: 'a@b.c' } })
    h.isLivePaymentsAllowed.mockReturnValue(true)
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(h.isLivePaymentsAllowed).toHaveBeenCalledWith('t1', true)
    expect(h.createExpressAccount).toHaveBeenCalledTimes(1)
  })

  it('allowlisted LIVE trainer is allowed and gets an onboarding link', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u1', trainerId: 't1' } })
    h.trainerFindUnique.mockResolvedValue({ connectAccountId: null, sandboxBilling: false, payoutCurrency: null, signupCountry: 'NZ', addressCountry: null, businessName: 'X', user: { email: 'a@b.c' } })
    h.isLivePaymentsAllowed.mockReturnValue(true)
    const res = await POST(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://connect.stripe.test/onboard')
  })
})
