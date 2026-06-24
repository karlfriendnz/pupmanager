import { describe, it, expect, vi, beforeEach } from 'vitest'

// Trainer signup (two routes: legacy /register and marketing /signup). Both must:
// validate input via Zod, reject duplicate emails (409), and — security-critical —
// FORCE role: 'TRAINER' server-side so a body can't escalate (e.g. {role:'ADMIN'}).
// Every side-effecting import is mocked; we assert on what gets written to prisma.
const h = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  sendVerificationEmail: vi.fn(),
  notifyNewTrainerSignup: vi.fn(),
  validatePromoCode: vi.fn(),
  bcryptHash: vi.fn(),
  randomInt: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  accountCreate: vi.fn(),
  profileCreate: vi.fn(),
  membershipCreate: vi.fn(),
  promoUpdate: vi.fn(),
  verificationTokenCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: h.getClientIp }))
vi.mock('@/lib/auth-emails', () => ({ sendVerificationEmail: h.sendVerificationEmail }))
vi.mock('@/lib/notify-new-trainer', () => ({ notifyNewTrainerSignup: h.notifyNewTrainerSignup }))
vi.mock('@/lib/promo', () => ({ validatePromoCode: h.validatePromoCode }))
vi.mock('bcryptjs', () => ({ default: { hash: h.bcryptHash }, hash: h.bcryptHash }))
vi.mock('crypto', () => ({ default: { randomInt: h.randomInt }, randomInt: h.randomInt }))

// A tx object exposing the same model methods the routes call inside $transaction.
const tx = {
  user: { create: h.userCreate },
  account: { create: h.accountCreate },
  trainerProfile: { create: h.profileCreate },
  trainerMembership: { create: h.membershipCreate },
  promoCode: { update: h.promoUpdate },
}
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: h.userFindUnique },
    verificationToken: { create: h.verificationTokenCreate },
    $transaction: h.transaction,
  },
}))

import { POST as REGISTER } from '@/app/api/auth/register/route'
import { POST as SIGNUP } from '@/app/api/auth/signup/route'

const body = (overrides: Record<string, unknown> = {}) => ({
  name: 'Olivia Owner',
  businessName: 'Dog School',
  phone: '021123456',
  email: 'olivia@x.test',
  password: 'supersecret',
  ...overrides,
})

const req = (b: unknown) =>
  new Request('https://app.pupmanager.com/api/auth/x', { method: 'POST', body: JSON.stringify(b) })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.enforceRateLimit.mockResolvedValue(null)
  h.getClientIp.mockReturnValue('1.2.3.4')
  h.sendVerificationEmail.mockResolvedValue(undefined)
  h.notifyNewTrainerSignup.mockResolvedValue(undefined)
  h.bcryptHash.mockResolvedValue('HASHED')
  h.randomInt.mockReturnValue(123456)
  h.userFindUnique.mockResolvedValue(null) // email free
  h.userCreate.mockResolvedValue({ id: 'new-user' })
  h.accountCreate.mockResolvedValue({})
  h.profileCreate.mockResolvedValue({ id: 'profile-1' })
  h.membershipCreate.mockResolvedValue({})
  h.promoUpdate.mockResolvedValue({})
  h.verificationTokenCreate.mockResolvedValue({})
  // Run the route's transaction callback against our tx stub.
  h.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))
})

// Both routes share the same validation/duplicate/role-escalation contract, so
// run the shared assertions against each.
const routes: Array<[string, typeof REGISTER]> = [
  ['register', REGISTER],
  ['signup', SIGNUP],
]

describe.each(routes)('POST /api/auth/%s — validation, duplicates, role escalation', (label, POST) => {
  it('rejects invalid input with 400 (no user created)', async () => {
    const res = await POST(req(body({ email: 'not-an-email', password: 'short' })))
    expect(res.status, label).toBe(400)
    expect(h.userCreate).not.toHaveBeenCalled()
  })

  it('rejects a missing/short phone with 400 (required field)', async () => {
    const res = await POST(req(body({ phone: '12' })))
    expect(res.status, label).toBe(400)
    expect(h.userCreate).not.toHaveBeenCalled()
  })

  it('returns 409 when the email is already registered', async () => {
    h.userFindUnique.mockResolvedValue({ id: 'existing' })
    const res = await POST(req(body()))
    expect(res.status, label).toBe(409)
    expect(h.userCreate).not.toHaveBeenCalled()
  })

  it('forces role TRAINER — a body role/admin flag cannot escalate', async () => {
    const res = await POST(req(body({ role: 'ADMIN', isAdmin: true })))
    expect([200, 201], label).toContain(res.status)
    // Whatever the body said, the persisted role is hard-coded TRAINER.
    expect(h.userCreate).toHaveBeenCalledTimes(1)
    expect(h.userCreate.mock.calls[0][0].data.role).toBe('TRAINER')
  })

  it('hashes the password (never stores plaintext) and the account holds the hash', async () => {
    await POST(req(body({ password: 'plaintext-pw' })))
    expect(h.bcryptHash).toHaveBeenCalledWith('plaintext-pw', 12)
    expect(h.accountCreate.mock.calls[0][0].data.providerAccountId).toBe('HASHED')
    // emailVerified stays null — login is blocked until the code is entered.
    expect(h.userCreate.mock.calls[0][0].data.emailVerified).toBeNull()
  })

  it('makes the founder an OWNER member of their own new business', async () => {
    await POST(req(body()))
    expect(h.membershipCreate).toHaveBeenCalledTimes(1)
    const m = h.membershipCreate.mock.calls[0][0].data
    expect(m.role).toBe('OWNER')
    expect(m.companyId).toBe('profile-1')
  })

  it('blocks signup with an invalid promo code (400, no account)', async () => {
    h.validatePromoCode.mockResolvedValue({ ok: false, reason: 'Expired code' })
    const res = await POST(req(body({ promoCode: 'BADCODE' })))
    expect(res.status, label).toBe(400)
    expect(h.userCreate).not.toHaveBeenCalled()
  })

  it('creates the trainer on a clean request (201)', async () => {
    const res = await POST(req(body()))
    expect(res.status, label).toBe(201)
    expect(h.verificationTokenCreate).toHaveBeenCalledTimes(1)
  })
})

describe('register route — IP rate limiting', () => {
  it('returns the limiter response and creates nothing when over the limit', async () => {
    h.enforceRateLimit.mockResolvedValue(new Response('slow', { status: 429 }))
    const res = await REGISTER(req(body()))
    expect(res.status).toBe(429)
    expect(h.userFindUnique).not.toHaveBeenCalled()
    expect(h.userCreate).not.toHaveBeenCalled()
  })
})
