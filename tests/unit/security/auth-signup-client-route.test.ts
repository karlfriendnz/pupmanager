import { describe, it, expect, vi, beforeEach } from 'vitest'

// Dog-owner self-registration (/api/auth/signup-client).
//
// This route exists because /api/auth/register and /api/auth/signup BOTH
// hardcode role: 'TRAINER' — a dog owner told "we use PupManager, go sign up"
// became a trainer on a free trial (six such accounts in production have no
// business name). So the headline assertion here is the inverse of the trainer
// suite's: this route must create a CLIENT and must NOT create a trainer.
//
// It is public and unauthenticated, so it also has to: rate limit, reject a
// body that tries to name its own role, refuse a duplicate email, and never
// write into a trainer's client list on its own.

const h = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  sendClientVerificationEmail: vi.fn(),
  notifyEnquiryTrainer: vi.fn(),
  bcryptHash: vi.fn(),
  randomInt: vi.fn(),
  userFindUnique: vi.fn(),
  trainerFindFirst: vi.fn(),
  trainerFindUnique: vi.fn(),
  verificationTokenCreate: vi.fn(),
  transaction: vi.fn(),
  userCreate: vi.fn(),
  accountCreate: vi.fn(),
  enquiryCreate: vi.fn(),
  clientProfileCreate: vi.fn(),
  trainerProfileCreate: vi.fn(),
  trainerMembershipCreate: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: h.getClientIp }))
vi.mock('@/lib/auth-emails', () => ({ sendClientVerificationEmail: h.sendClientVerificationEmail }))
vi.mock('@/lib/notify-enquiry-trainer', () => ({ notifyEnquiryTrainer: h.notifyEnquiryTrainer }))
vi.mock('bcryptjs', () => ({ default: { hash: h.bcryptHash }, hash: h.bcryptHash }))
vi.mock('crypto', () => ({ default: { randomInt: h.randomInt }, randomInt: h.randomInt }))

const tx = {
  user: { create: h.userCreate },
  account: { create: h.accountCreate },
  enquiry: { create: h.enquiryCreate },
  clientProfile: { create: h.clientProfileCreate },
  trainerProfile: { create: h.trainerProfileCreate },
  trainerMembership: { create: h.trainerMembershipCreate },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: h.userFindUnique },
    trainerProfile: { findFirst: h.trainerFindFirst, findUnique: h.trainerFindUnique },
    verificationToken: { create: h.verificationTokenCreate },
    $transaction: h.transaction,
  },
}))

import { POST } from '@/app/api/auth/signup-client/route'

const body = (overrides: Record<string, unknown> = {}) => ({
  name: 'Olivia Owner',
  email: 'Olivia@Example.test',
  password: 'supersecret',
  ...overrides,
})

const req = (b: unknown) =>
  new Request('https://app.pupmanager.com/api/auth/signup-client', {
    method: 'POST',
    body: JSON.stringify(b),
  })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.enforceRateLimit.mockResolvedValue(null)
  h.getClientIp.mockReturnValue('1.2.3.4')
  h.sendClientVerificationEmail.mockResolvedValue(undefined)
  h.notifyEnquiryTrainer.mockResolvedValue(undefined)
  h.bcryptHash.mockResolvedValue('HASHED')
  h.randomInt.mockReturnValue(123456)
  h.userFindUnique.mockResolvedValue(null) // email free
  h.trainerFindFirst.mockResolvedValue({ id: 'trainer-1', businessName: 'Pawsome' })
  h.trainerFindUnique.mockResolvedValue({ businessName: 'Pawsome', logoUrl: null, emailAccentColor: '#7c3aed' })
  h.verificationTokenCreate.mockResolvedValue({})
  h.userCreate.mockResolvedValue({ id: 'client-user' })
  h.accountCreate.mockResolvedValue({})
  h.enquiryCreate.mockResolvedValue({ id: 'enq-1' })
  h.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx))
})

describe('POST /api/auth/signup-client — creates a CLIENT, never a trainer', () => {
  it('writes role CLIENT and no trainer rows at all', async () => {
    const res = await POST(req(body()))
    expect(res.status).toBe(201)

    expect(h.userCreate).toHaveBeenCalledTimes(1)
    expect(h.userCreate.mock.calls[0][0].data.role).toBe('CLIENT')

    // The bug this route fixes, asserted directly.
    expect(h.userCreate.mock.calls[0][0].data.role).not.toBe('TRAINER')
    expect(h.trainerProfileCreate).not.toHaveBeenCalled()
    expect(h.trainerMembershipCreate).not.toHaveBeenCalled()
  })

  it('ignores a role supplied in the body (no escalation)', async () => {
    await POST(req(body({ role: 'ADMIN', trainerId: undefined })))
    expect(h.userCreate.mock.calls[0][0].data.role).toBe('CLIENT')
  })

  it('stores the email lower-cased and hashes the password with bcrypt', async () => {
    await POST(req(body()))
    expect(h.userCreate.mock.calls[0][0].data.email).toBe('olivia@example.test')
    expect(h.bcryptHash).toHaveBeenCalledWith('supersecret', 12)
    // The digest is the credentials Account's providerAccountId — the shape
    // lib/auth.ts authorize() compares against.
    expect(h.accountCreate.mock.calls[0][0].data).toMatchObject({
      provider: 'credentials',
      type: 'credentials',
      providerAccountId: 'HASHED',
    })
  })

  it('never creates a ClientProfile — attaching to a trainer is the trainer’s call', async () => {
    await POST(req(body({ trainerId: 'trainer-1' })))
    expect(h.clientProfileCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/signup-client — the join request', () => {
  it('raises a SELF_SIGNUP enquiry against the named trainer and notifies them', async () => {
    const res = await POST(req(body({ trainerId: 'trainer-1', dogName: 'Bailey', message: 'Tuesday class' })))
    expect(res.status).toBe(201)

    expect(h.enquiryCreate).toHaveBeenCalledTimes(1)
    expect(h.enquiryCreate.mock.calls[0][0].data).toMatchObject({
      trainerId: 'trainer-1',
      source: 'SELF_SIGNUP',
      email: 'olivia@example.test',
      dogName: 'Bailey',
      message: 'Tuesday class',
      formId: null,
    })
    expect(h.notifyEnquiryTrainer).toHaveBeenCalledWith({ enquiryId: 'enq-1' })
  })

  it('creates the account with no request when no trainer was chosen', async () => {
    const res = await POST(req(body()))
    expect(res.status).toBe(201)
    expect(h.userCreate).toHaveBeenCalledTimes(1)
    expect(h.enquiryCreate).not.toHaveBeenCalled()
    expect(h.notifyEnquiryTrainer).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ requested: false })
  })

  it('404s on an unknown or deactivated trainer, creating nothing', async () => {
    h.trainerFindFirst.mockResolvedValue(null)
    const res = await POST(req(body({ trainerId: 'nope' })))
    expect(res.status).toBe(404)
    expect(h.userCreate).not.toHaveBeenCalled()
    expect(h.enquiryCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/signup-client — guards', () => {
  it('409s a duplicate email without touching an existing account', async () => {
    h.userFindUnique.mockResolvedValue({ id: 'existing' })
    const res = await POST(req(body()))
    expect(res.status).toBe(409)
    // Critically: it must NOT set a password on somebody else's user row.
    expect(h.userCreate).not.toHaveBeenCalled()
    expect(h.accountCreate).not.toHaveBeenCalled()
  })

  it('rejects a short password with 400 and creates nothing', async () => {
    const res = await POST(req(body({ password: 'short' })))
    expect(res.status).toBe(400)
    expect(h.userCreate).not.toHaveBeenCalled()
  })

  it('honours the rate limiter', async () => {
    h.enforceRateLimit.mockResolvedValue(new Response('slow down', { status: 429 }))
    const res = await POST(req(body()))
    expect(res.status).toBe(429)
    expect(h.userCreate).not.toHaveBeenCalled()
  })

  it('sends the dog-owner verification email, not the trainer one', async () => {
    await POST(req(body({ trainerId: 'trainer-1' })))
    expect(h.sendClientVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'olivia@example.test',
        code: '123456',
        trainer: expect.objectContaining({ businessName: 'Pawsome' }),
      }),
    )
  })

  // The email a dog owner gets must look like the business they signed up to —
  // they have never heard of PupManager. That means the send needs the
  // trainer's brand, not just their name.
  it('hands the trainer’s branding to the verification email', async () => {
    await POST(req(body({ trainerId: 'trainer-1' })))
    expect(h.sendClientVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        trainer: { businessName: 'Pawsome', logoUrl: null, emailAccentColor: '#7c3aed' },
      }),
    )
    const select = h.trainerFindUnique.mock.calls[0][0].select
    expect(select).toMatchObject({ businessName: true, logoUrl: true, emailAccentColor: true })
  })

  // No trainer = a generic signup, which is the one case PupManager branding is
  // honest — the renderer keys off exactly this being null.
  it('passes trainer: null when they signed up without a trainer', async () => {
    await POST(req(body()))
    expect(h.sendClientVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ trainer: null }),
    )
  })
})
