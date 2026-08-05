import { describe, it, expect, vi, beforeEach } from 'vitest'

// The continuous sign-up run's account step is a PUBLIC, UNAUTHENTICATED
// endpoint that creates logins. These are the four things that would each be a
// real incident, asserted against the route rather than against a helper: email
// enumeration, taking over an address that already has an account, landing a
// new client in the wrong business, and running unmetered.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  enquiryFindUnique: vi.fn(),
  enforceRateLimit: vi.fn(),
  resolveContinuation: vi.fn(),
  completeContinuation: vi.fn(),
  sendClientVerificationEmail: vi.fn(async () => {}),
  tokenCreate: vi.fn(async () => ({})),
  completeAccountStepForEnquiry: vi.fn(async () => null),
}))

vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com', AUTH_SECRET: 's3cret' } }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: h.userFindUnique },
    enquiry: { findUnique: h.enquiryFindUnique },
    verificationToken: { create: h.tokenCreate },
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: h.enforceRateLimit,
  getClientIp: () => '203.0.113.9',
}))
vi.mock('@/lib/auth-emails', () => ({ sendClientVerificationEmail: h.sendClientVerificationEmail }))
vi.mock('@/lib/flow-journey', () => ({ completeAccountStepForEnquiry: h.completeAccountStepForEnquiry }))
vi.mock('@/lib/form-continuation', async () => {
  const actual = await vi.importActual<typeof import('@/lib/form-continuation')>('@/lib/form-continuation')
  return {
    ...actual,
    resolveContinuation: h.resolveContinuation,
    completeContinuation: h.completeContinuation,
  }
})

import { POST } from '@/app/api/form/[formId]/continue/route'

const FORM_ID = 'form_abc'
const TOKEN = 'a'.repeat(64)

const RUN = {
  enquiryId: 'enq1',
  email: 'sam@example.com',
  name: 'Sam Rivers',
  phone: '021 555 0100',
  // The tenant the run belongs to — read off the enquiry, which read it off the
  // form. This is the value nothing in the request body may influence.
  trainerId: 'trainerA',
  formId: FORM_ID,
  formName: 'Puppy enquiry',
  intakeFormId: 'intake1',
  trainer: { businessName: 'Mersea Mutts', logoUrl: null, emailAccentColor: '#0f766e' },
}

function req(body: unknown): Request {
  return new Request(`https://app.pupmanager.com/api/form/${FORM_ID}/continue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ formId: FORM_ID }) }

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue(null)
  h.userFindUnique.mockReset().mockResolvedValue(null)
  h.enforceRateLimit.mockReset().mockResolvedValue(null)
  h.resolveContinuation.mockReset().mockResolvedValue({ ok: true, run: RUN })
  h.completeContinuation.mockReset().mockResolvedValue({ clientProfileId: 'cp1', hasIntake: true })
  h.sendClientVerificationEmail.mockClear()
  h.tokenCreate.mockClear()
  h.completeAccountStepForEnquiry.mockReset().mockResolvedValue(null)
})

describe('POST /api/form/[formId]/continue — account takeover', () => {
  it('NEVER sets a password on an address that already has an account', async () => {
    h.userFindUnique.mockResolvedValue({ id: 'existing-user' })

    const res = await POST(req({ token: TOKEN, password: 'hunter2hunter2' }), ctx)
    const body = await res.json()

    expect(body.status).toBe('signin')
    // The decisive assertion: nothing was written. No user, no account, no
    // password — the run is not spent, so signing in still resumes it.
    expect(h.completeContinuation).not.toHaveBeenCalled()
  })

  it('creates the login only when the address has no account at all', async () => {
    h.userFindUnique.mockResolvedValue(null)

    const res = await POST(req({ token: TOKEN, password: 'hunter2hunter2' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ready')
    expect(h.completeContinuation).toHaveBeenCalledWith(RUN, { password: 'hunter2hunter2' })
  })

  it('refuses to attach the run to a DIFFERENT signed-in account', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u9', email: 'someone.else@example.com' } })

    const res = await POST(req({ token: TOKEN, password: 'hunter2hunter2' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.status).toBe('wrong_account')
    expect(h.completeContinuation).not.toHaveBeenCalled()
  })

  it('resumes without a password when the RIGHT person has signed in', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', email: 'SAM@example.com' } })

    const res = await POST(req({ token: TOKEN }), ctx)

    expect(res.status).toBe(200)
    // Identity is the session, not a password — nothing is re-hashed onto a
    // user who already had credentials.
    expect(h.completeContinuation).toHaveBeenCalledWith(RUN, { userId: 'u1' })
  })
})

describe('POST /api/form/[formId]/continue — email enumeration', () => {
  it('takes the address from the run, so an email in the body is inert', async () => {
    h.userFindUnique.mockResolvedValue(null)

    await POST(
      req({ token: TOKEN, password: 'hunter2hunter2', email: 'victim@example.com' }),
      ctx,
    )

    // The existence check ran against the RUN's address, never the posted one —
    // which is why this endpoint cannot answer "does victim@example.com have an
    // account?" at any rate at all.
    expect(h.userFindUnique).toHaveBeenCalledWith({
      where: { email: 'sam@example.com' },
      select: { id: true },
    })
    expect(h.completeContinuation).toHaveBeenCalledWith(RUN, { password: 'hunter2hunter2' })
  })

  it('gives an unresolvable token the same answer whatever address it names', async () => {
    h.resolveContinuation.mockResolvedValue({ ok: false, problem: 'NOT_FOUND' })

    const res = await POST(req({ token: TOKEN, email: 'victim@example.com' }), ctx)

    expect(res.status).toBe(410)
    expect(h.userFindUnique).not.toHaveBeenCalled()
  })
})

describe('POST /api/form/[formId]/continue — tenant binding', () => {
  it('passes the run through untouched, so trainerId cannot be posted', async () => {
    h.userFindUnique.mockResolvedValue(null)

    await POST(
      req({ token: TOKEN, password: 'hunter2hunter2', trainerId: 'trainerB', formId: 'other' }),
      ctx,
    )

    const [runArg] = h.completeContinuation.mock.calls[0]
    expect(runArg.trainerId).toBe('trainerA')
    expect(runArg.formId).toBe(FORM_ID)
  })

  it('resolves the token against the form id in the URL, not one in the body', async () => {
    await POST(req({ token: TOKEN, formId: 'someone-elses-form' }), ctx)
    expect(h.resolveContinuation).toHaveBeenCalledWith(FORM_ID, TOKEN)
  })
})

describe('POST /api/form/[formId]/continue — rate limiting', () => {
  it('limits per IP before anything is read', async () => {
    h.enforceRateLimit.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Too many requests.' }), { status: 429 }),
    )

    const res = await POST(req({ token: TOKEN, password: 'hunter2hunter2' }), ctx)

    expect(res.status).toBe(429)
    expect(h.resolveContinuation).not.toHaveBeenCalled()
    expect(h.completeContinuation).not.toHaveBeenCalled()
  })

  it('limits the individual run as well as the IP', async () => {
    // First call (per IP) passes, second (per run) trips.
    h.enforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Too many requests.' }), { status: 429 }))

    const res = await POST(req({ token: TOKEN, password: 'hunter2hunter2' }), ctx)

    expect(res.status).toBe(429)
    expect(h.completeContinuation).not.toHaveBeenCalled()
    expect(h.enforceRateLimit.mock.calls[1][0].key).toBe('form-continue-run:enq1')
  })
})

describe('POST /api/form/[formId]/continue — spent and stale links', () => {
  it('rejects an expired link with an explanation, not a blank 404', async () => {
    h.resolveContinuation.mockResolvedValue({ ok: false, problem: 'EXPIRED' })

    const res = await POST(req({ token: TOKEN, password: 'hunter2hunter2' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(410)
    expect(body.problem).toBe('EXPIRED')
    expect(body.error).toMatch(/expired/i)
  })

  it('rejects a link that has already been used', async () => {
    h.resolveContinuation.mockResolvedValue({ ok: false, problem: 'USED' })

    const res = await POST(req({ token: TOKEN }), ctx)
    expect(res.status).toBe(410)
    expect(h.completeContinuation).not.toHaveBeenCalled()
  })

  it('will not create an account without a password', async () => {
    h.userFindUnique.mockResolvedValue(null)

    const res = await POST(req({ token: TOKEN }), ctx)

    expect(res.status).toBe(400)
    expect(h.completeContinuation).not.toHaveBeenCalled()
  })

  it('rejects a password shorter than eight characters', async () => {
    const res = await POST(req({ token: TOKEN, password: 'short' }), ctx)

    expect(res.status).toBe(400)
    expect(h.resolveContinuation).not.toHaveBeenCalled()
  })
})

describe('POST /api/form/[formId]/continue — landing in the right business', () => {
  it('pins the new relationship as the active one', async () => {
    h.userFindUnique.mockResolvedValue(null)

    const res = await POST(req({ token: TOKEN, password: 'hunter2hunter2' }), ctx)

    // Someone who is already another trainer's client would otherwise land on
    // that trainer's home screen and never see the business whose form they
    // just filled in.
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('pm-active-trainer=cp1')
    expect(cookie).toContain('HttpOnly')
  })

  it('sends the confirm-your-email code, but does not make it a gate', async () => {
    h.userFindUnique.mockResolvedValue(null)

    const res = await POST(req({ token: TOKEN, password: 'hunter2hunter2' }), ctx)
    const body = await res.json()

    // Through to the intake step regardless — verifying up front would rebuild
    // the "check your email, then start again" break this feature removes.
    expect(body.status).toBe('ready')
    expect(body.hasIntake).toBe(true)
  })
})

// ── Phase 3: the run this step belongs to ──────────────────────────────────
//
// The token has just been spent, which is what proves this is the person the
// enquiry was about — so, and only then, the journey is told who is walking it.
// There is deliberately no new resume mechanism: the token remains the boundary.
describe('the journey moves on once the account exists', () => {
  it('advances the run, keyed on the enquiry the token resolved to', async () => {
    h.auth.mockResolvedValue(null)
    h.resolveContinuation.mockResolvedValue({ ok: true, run: RUN })
    h.userFindUnique.mockResolvedValue(null)
    h.completeContinuation.mockResolvedValue({ clientProfileId: 'cp1', hasIntake: true })

    const res = await POST(req({ token: TOKEN, password: 'a-good-password' }), ctx)
    expect(res.status).toBe(200)
    expect(h.completeAccountStepForEnquiry).toHaveBeenCalledWith({
      enquiryId: RUN.enquiryId,
      clientProfileId: 'cp1',
    })
  })

  it('a journey that cannot advance does NOT undo an account that now exists', async () => {
    h.auth.mockResolvedValue(null)
    h.resolveContinuation.mockResolvedValue({ ok: true, run: RUN })
    h.userFindUnique.mockResolvedValue(null)
    h.completeContinuation.mockResolvedValue({ clientProfileId: 'cp1', hasIntake: false })
    h.completeAccountStepForEnquiry.mockRejectedValue(new Error('boom'))

    const res = await POST(req({ token: TOKEN, password: 'a-good-password' }), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ready')
  })

  it('is never reached when the run was refused', async () => {
    h.auth.mockResolvedValue(null)
    h.resolveContinuation.mockResolvedValue({ ok: false, problem: 'EXPIRED' })
    const res = await POST(req({ token: TOKEN, password: 'a-good-password' }), ctx)
    expect(res.status).toBe(410)
    expect(h.completeAccountStepForEnquiry).not.toHaveBeenCalled()
  })
})
