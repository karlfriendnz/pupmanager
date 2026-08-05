import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The account somebody creates after tapping "Start my own account" is an
 * ORDINARY trial. Nothing about the sandbox they just left follows them.
 *
 * This is the failure that would matter most in the whole feature: a
 * `demoSessionId` or `demoExpiresAt` on a real business puts a paying customer
 * in front of the purge cron. The drift test next door forbids those columns
 * being written anywhere but `lib/demo-tenant`; this file proves the specific
 * path — sign-up carrying a trade-show prefill cookie — creates a normal
 * TrainerProfile and only ever writes back to the LEAD.
 */

const h = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  profileCreate: vi.fn(),
  membershipCreate: vi.fn(),
  promoUpdate: vi.fn(),
  tokenCreate: vi.fn(),
  leadUpdateMany: vi.fn(),
  sendVerificationEmail: vi.fn(),
  notifyNewTrainerSignup: vi.fn(),
  validatePromoCode: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: h.enforceRateLimit,
  getClientIp: () => '203.0.113.7',
}))
vi.mock('@/lib/auth-emails', () => ({ sendVerificationEmail: h.sendVerificationEmail }))
vi.mock('@/lib/notify-new-trainer', () => ({ notifyNewTrainerSignup: h.notifyNewTrainerSignup }))
vi.mock('@/lib/promo', () => ({ validatePromoCode: h.validatePromoCode }))
vi.mock('@/lib/prisma', () => {
  const tx = {
    user: { create: h.userCreate },
    trainerProfile: { create: h.profileCreate },
    trainerMembership: { create: h.membershipCreate },
    promoCode: { update: h.promoUpdate },
  }
  return {
    prisma: {
      user: { findUnique: h.userFindUnique },
      verificationToken: { create: h.tokenCreate },
      demoLead: { updateMany: h.leadUpdateMany },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx as any),
    },
  }
})

import { POST } from '@/app/api/auth/register/route'
import { TRY_PREFILL_COOKIE } from '@/lib/demo-lead'

const BODY = {
  name: 'Jess Carter',
  businessName: 'Carter Canine',
  phone: '+64 21 555 0100',
  email: 'jess@cartercanine.co.nz',
  signupCountry: 'NZ',
}

function req(cookie?: string): Request {
  return new Request('https://app.pupmanager.com/api/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(BODY),
  })
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.enforceRateLimit.mockResolvedValue(null)
  h.userFindUnique.mockResolvedValue(null)
  h.userCreate.mockResolvedValue({ id: 'u-new' })
  h.profileCreate.mockResolvedValue({ id: 't-new' })
  h.membershipCreate.mockResolvedValue({})
  h.tokenCreate.mockResolvedValue({})
  h.leadUpdateMany.mockResolvedValue({ count: 1 })
  h.sendVerificationEmail.mockResolvedValue({})
  h.notifyNewTrainerSignup.mockResolvedValue({})
  h.validatePromoCode.mockResolvedValue({ ok: false })
})

describe('signing up after a demo', () => {
  it('creates a completely ordinary trainer profile — no demo markers', async () => {
    const res = await POST(req(`${TRY_PREFILL_COOKIE}=lead-1`))
    expect(res.status).toBe(201)

    const data = h.profileCreate.mock.calls[0][0].data
    expect(data).not.toHaveProperty('demoSessionId')
    expect(data).not.toHaveProperty('demoExpiresAt')
    // Nor the flags that keep a sandbox out of real numbers and off live Stripe.
    expect(data).not.toHaveProperty('isInternal')
    expect(data).not.toHaveProperty('sandboxBilling')
    // A normal trial: TrainerProfile defaults to TRIALING and this stamps the end.
    expect(data.trialEndsAt).toBeInstanceOf(Date)
    expect(data).not.toHaveProperty('subscriptionStatus')
  })

  it('creates an ordinary user, verified the normal way (not pre-verified)', async () => {
    await POST(req(`${TRY_PREFILL_COOKIE}=lead-1`))
    const data = h.userCreate.mock.calls[0][0].data
    expect(data.emailVerified).toBeNull()
    expect(data.email).toBe(BODY.email)
    // A sandbox login lives on the reserved .test domain. A real one never does.
    expect(data.email).not.toMatch(/\.test$/)
  })

  it('still emails the verification code — this account is real', async () => {
    await POST(req(`${TRY_PREFILL_COOKIE}=lead-1`))
    expect(h.sendVerificationEmail).toHaveBeenCalledTimes(1)
  })

  it('writes back ONLY to the lead, and only the conversion stamp', async () => {
    await POST(req(`${TRY_PREFILL_COOKIE}=lead-1`))
    expect(h.leadUpdateMany).toHaveBeenCalledTimes(1)
    const call = h.leadUpdateMany.mock.calls[0][0]
    // First conversion wins — a second account from the same lead does not move it.
    expect(call.where).toEqual({ id: 'lead-1', signupCompletedAt: null })
    expect(Object.keys(call.data)).toEqual(['signupCompletedAt'])
  })

  it('spends the prefill cookie, so the next person on that phone does not inherit it', async () => {
    const res = await POST(req(`${TRY_PREFILL_COOKIE}=lead-1`))
    expect(res.headers.getSetCookie().join('\n')).toMatch(new RegExp(`${TRY_PREFILL_COOKIE}=;`))
  })
})

describe('an ordinary signup with no demo behind it', () => {
  it('touches no lead at all', async () => {
    const res = await POST(req())
    expect(res.status).toBe(201)
    expect(h.leadUpdateMany).not.toHaveBeenCalled()
  })

  it('is byte-for-byte the same profile as the post-demo one', async () => {
    await POST(req())
    const plain = h.profileCreate.mock.calls[0][0].data
    h.profileCreate.mockClear()
    await POST(req(`${TRY_PREFILL_COOKIE}=lead-1`))
    const afterDemo = h.profileCreate.mock.calls[0][0].data
    // trialEndsAt is a clock reading, so compare the shape and everything else.
    expect(Object.keys(afterDemo).sort()).toEqual(Object.keys(plain).sort())
    expect({ ...afterDemo, trialEndsAt: null }).toEqual({ ...plain, trialEndsAt: null })
  })

  it('ignores a prefill cookie naming a lead that no longer exists', async () => {
    h.leadUpdateMany.mockResolvedValue({ count: 0 })
    const res = await POST(req(`${TRY_PREFILL_COOKIE}=lead-gone`))
    expect(res.status).toBe(201)
  })

  it('survives the lead stamp failing — a marketing write must never block a signup', async () => {
    h.leadUpdateMany.mockRejectedValue(new Error('database on fire'))
    const res = await POST(req(`${TRY_PREFILL_COOKIE}=lead-1`))
    expect(res.status).toBe(201)
  })
})
