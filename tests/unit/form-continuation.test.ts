import { describe, it, expect, vi, beforeEach } from 'vitest'

// The run's library: what a token resolves to, and what completing it writes.
// The rules that matter here are about OTHER people's data — a person who is
// already somebody's client must come out of this with everything they had.

const h = vi.hoisted(() => ({
  enquiryFindUnique: vi.fn(),
  // The back-link lookup: is another enquiry already pointing at this client?
  enquiryFindFirst: vi.fn(),
  enquiryUpdate: vi.fn(),
  enquiryUpdateMany: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  accountCreate: vi.fn(),
  profileUpdate: vi.fn(),
  findOrJoinClient: vi.fn(),
}))

vi.mock('@/lib/env', () => ({ env: { AUTH_SECRET: 's3cret', NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com' } }))
// findOrJoinClient is stubbed (its own rules are tested elsewhere); the
// back-link helper runs for real against the mocked transaction, because
// whether it skips a taken link is exactly what these tests are about.
vi.mock('@/lib/client-upsert', async () => ({
  ...(await vi.importActual<typeof import('@/lib/client-upsert')>('@/lib/client-upsert')),
  findOrJoinClient: h.findOrJoinClient,
}))

const tx = {
  enquiry: { update: h.enquiryUpdate, updateMany: h.enquiryUpdateMany, findFirst: h.enquiryFindFirst },
  user: { findUnique: h.userFindUnique, create: h.userCreate },
  account: { create: h.accountCreate },
  clientProfile: { update: h.profileUpdate },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    enquiry: { findUnique: h.enquiryFindUnique },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}))

import {
  CONTINUATION_TTL_MS,
  completeContinuation,
  continuationPath,
  hashContinuationToken,
  mintContinuationToken,
  resolveContinuation,
  type ResolvedContinuation,
} from '@/lib/form-continuation'

const FORM_ID = 'form_abc'

function enquiryRow(over: Record<string, unknown> = {}) {
  return {
    id: 'enq1',
    email: 'sam@example.com',
    name: 'Sam Rivers',
    phone: '021 555 0100',
    trainerId: 'trainerA',
    unifiedFormId: FORM_ID,
    continuationExpiresAt: new Date(Date.now() + 60_000),
    continuationUsedAt: null,
    trainer: { businessName: 'Mersea Mutts', logoUrl: null, emailAccentColor: '#0f766e' },
    unifiedForm: {
      id: FORM_ID,
      name: 'Puppy enquiry',
      isActive: true,
      continueToAccount: true,
      continueIntakeFormId: 'intake1',
    },
    ...over,
  }
}

const RUN: ResolvedContinuation = {
  enquiryId: 'enq1',
  email: 'sam@example.com',
  name: 'Sam Rivers',
  phone: '021 555 0100',
  trainerId: 'trainerA',
  formId: FORM_ID,
  formName: 'Puppy enquiry',
  intakeFormId: 'intake1',
  trainer: { businessName: 'Mersea Mutts', logoUrl: null, emailAccentColor: '#0f766e' },
}

beforeEach(() => {
  h.enquiryFindUnique.mockReset()
  h.enquiryFindFirst.mockReset().mockResolvedValue(null)
  h.enquiryUpdate.mockReset().mockResolvedValue({})
  h.enquiryUpdateMany.mockReset().mockResolvedValue({ count: 1 })
  h.userFindUnique.mockReset().mockResolvedValue(null)
  h.userCreate.mockReset().mockResolvedValue({ id: 'newuser' })
  h.accountCreate.mockReset().mockResolvedValue({})
  h.profileUpdate.mockReset().mockResolvedValue({})
  h.findOrJoinClient.mockReset().mockResolvedValue({
    clientProfileId: 'cp1', userId: 'u1', joined: false, createdUser: true, createdDogIds: [],
  })
})

describe('the run token', () => {
  it('stores only a digest, never the link itself', () => {
    const { plain, hash } = mintContinuationToken()
    expect(hash).not.toBe(plain)
    expect(hash).toHaveLength(64)
    expect(hashContinuationToken(plain)).toBe(hash)
  })

  it('mints a different token every time', () => {
    expect(mintContinuationToken().plain).not.toBe(mintContinuationToken().plain)
  })

  it('lasts a day — long enough to come back from the email tomorrow', () => {
    const { expires } = mintContinuationToken()
    expect(expires.getTime() - Date.now()).toBeGreaterThan(CONTINUATION_TTL_MS - 5_000)
  })

  it('builds a same-origin path, so it works on any deployment', () => {
    expect(continuationPath('f1', 'abc')).toBe('/form/f1/account?t=abc')
  })
})

describe('resolveContinuation', () => {
  it('resolves a live run', async () => {
    h.enquiryFindUnique.mockResolvedValue(enquiryRow())
    const res = await resolveContinuation(FORM_ID, 'x'.repeat(64))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.run.email).toBe('sam@example.com')
      expect(res.run.trainerId).toBe('trainerA')
      expect(res.run.intakeFormId).toBe('intake1')
    }
  })

  it('refuses a token presented under ANOTHER form id', async () => {
    h.enquiryFindUnique.mockResolvedValue(enquiryRow())
    // A run started on trainer A's website must not be finishable as a client
    // of trainer B by swapping the id in the URL.
    const res = await resolveContinuation('someone-elses-form', 'x'.repeat(64))
    expect(res).toEqual({ ok: false, problem: 'NOT_FOUND' })
  })

  it('rejects an obviously-too-short token without hitting the database', async () => {
    const res = await resolveContinuation(FORM_ID, 'abc')
    expect(res).toEqual({ ok: false, problem: 'NOT_FOUND' })
    expect(h.enquiryFindUnique).not.toHaveBeenCalled()
  })

  it('rejects an expired run', async () => {
    h.enquiryFindUnique.mockResolvedValue(enquiryRow({ continuationExpiresAt: new Date(Date.now() - 1) }))
    const res = await resolveContinuation(FORM_ID, 'x'.repeat(64))
    expect(res).toEqual({ ok: false, problem: 'EXPIRED' })
  })

  it('rejects a spent run', async () => {
    h.enquiryFindUnique.mockResolvedValue(enquiryRow({ continuationUsedAt: new Date() }))
    const res = await resolveContinuation(FORM_ID, 'x'.repeat(64))
    expect(res).toEqual({ ok: false, problem: 'USED' })
  })

  it('stops a run whose form was unpublished mid-way', async () => {
    h.enquiryFindUnique.mockResolvedValue(
      enquiryRow({ unifiedForm: { ...enquiryRow().unifiedForm, isActive: false } }),
    )
    const res = await resolveContinuation(FORM_ID, 'x'.repeat(64))
    expect(res).toEqual({ ok: false, problem: 'NOT_FOUND' })
  })

  it('stops a run whose form had the setting switched off mid-way', async () => {
    // The trainer's CURRENT answer to "may people join themselves?" is the one
    // that counts, not the answer at the moment somebody hit submit.
    h.enquiryFindUnique.mockResolvedValue(
      enquiryRow({ unifiedForm: { ...enquiryRow().unifiedForm, continueToAccount: false } }),
    )
    const res = await resolveContinuation(FORM_ID, 'x'.repeat(64))
    expect(res).toEqual({ ok: false, problem: 'NOT_FOUND' })
  })
})

describe('completeContinuation — creating a login', () => {
  it('creates the user and a bcrypt credentials account', async () => {
    await completeContinuation(RUN, { password: 'hunter2hunter2' })

    expect(h.userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'sam@example.com', role: 'CLIENT' }) }),
    )
    const account = h.accountCreate.mock.calls[0][0].data
    expect(account.provider).toBe('credentials')
    // bcrypt(12), the one scheme lib/auth.ts compares against.
    expect(account.providerAccountId).toMatch(/^\$2[aby]\$12\$/)
    expect(account.providerAccountId).not.toBe('hunter2hunter2')
  })

  it('leaves the address unverified rather than gating on it', async () => {
    await completeContinuation(RUN, { password: 'hunter2hunter2' })
    expect(h.userCreate.mock.calls[0][0].data.emailVerified).toBeNull()
  })

  it('refuses inside the transaction if a user appeared mid-flight', async () => {
    // The route checked and found nothing; a racing signup got there first.
    h.userFindUnique.mockResolvedValue({ id: 'raced-in' })
    await expect(completeContinuation(RUN, { password: 'hunter2hunter2' })).rejects.toThrow(/already has an account/i)
    expect(h.userCreate).not.toHaveBeenCalled()
  })

  it('claims the link before doing anything, so two tabs cannot both win', async () => {
    h.enquiryUpdateMany.mockResolvedValue({ count: 0 })
    await expect(completeContinuation(RUN, { password: 'hunter2hunter2' })).rejects.toThrow(/already been used/i)
    expect(h.userCreate).not.toHaveBeenCalled()
    expect(h.findOrJoinClient).not.toHaveBeenCalled()
  })

  it('never touches a password when the person signed in instead', async () => {
    await completeContinuation(RUN, { userId: 'existing-user' })
    expect(h.userCreate).not.toHaveBeenCalled()
    expect(h.accountCreate).not.toHaveBeenCalled()
  })
})

describe('completeContinuation — one client, many trainers', () => {
  it('joins through the shared find-or-join, bound to the run’s trainer', async () => {
    await completeContinuation(RUN, { password: 'hunter2hunter2' })

    expect(h.findOrJoinClient).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ email: 'sam@example.com', trainerId: 'trainerA', name: 'Sam Rivers' }),
    )
  })

  it('gates a BRAND-NEW relationship behind the trainer’s intake form', async () => {
    await completeContinuation(RUN, { password: 'hunter2hunter2' })

    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'cp1' },
      data: { intakeFormId: 'intake1', intakeCompletedAt: null },
    })
  })

  it('leaves an EXISTING relationship’s intake completely alone', async () => {
    // Already this trainer's client: they have either done their intake or are
    // part-way through it, and re-pointing them at a different form would throw
    // that away and lock them out of an app they already use.
    h.findOrJoinClient.mockResolvedValue({
      clientProfileId: 'cp-existing', userId: 'u1', joined: true, createdUser: false, createdDogIds: [],
    })

    const out = await completeContinuation(RUN, { userId: 'u1' })

    expect(h.profileUpdate).not.toHaveBeenCalled()
    expect(out.hasIntake).toBe(false)
  })

  it('skips the intake step when the trainer nominated no form', async () => {
    const out = await completeContinuation({ ...RUN, intakeFormId: null }, { password: 'hunter2hunter2' })
    expect(h.profileUpdate).not.toHaveBeenCalled()
    expect(out.hasIntake).toBe(false)
  })
})

describe('completeContinuation — what the trainer sees afterwards', () => {
  it('closes the enquiry, links the client, and drops the spent digest', async () => {
    await completeContinuation(RUN, { password: 'hunter2hunter2' })

    expect(h.enquiryUpdate).toHaveBeenCalledWith({
      where: { id: 'enq1' },
      data: {
        status: 'ACCEPTED',
        // Says plainly that this person signed themselves up, rather than
        // leaving the trainer wondering which team member tapped Accept.
        source: 'FORM_SIGNUP',
        clientProfileId: 'cp1',
        continuationTokenHash: null,
      },
    })
  })

  it('survives a SECOND enquiry from the same person', async () => {
    // Enquiry.clientProfileId is @unique. Someone who asked in March, joined,
    // and asks again in September resolves to the same ClientProfile — and
    // writing the back-link twice is a P2002 that used to 500 the whole
    // hand-over (and the trainer's Accept button with it). The arrow is a
    // convenience; being able to finish is not.
    h.enquiryFindFirst.mockResolvedValue({ id: 'the-march-enquiry' })
    h.findOrJoinClient.mockResolvedValue({
      clientProfileId: 'cp1', userId: 'u1', joined: true, createdUser: false, createdDogIds: [],
    })

    await expect(completeContinuation(RUN, { userId: 'u1' })).resolves.toMatchObject({
      clientProfileId: 'cp1',
    })

    const data = h.enquiryUpdate.mock.calls[0][0].data
    expect(data.status).toBe('ACCEPTED')
    expect(data.clientProfileId).toBeUndefined()
  })
})
