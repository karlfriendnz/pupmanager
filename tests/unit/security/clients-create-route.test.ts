import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/clients — create a client (full or quick mode). Security focus:
// permission gating, role gating, per-company required-field enforcement, and
// that trainerId/company come from the membership context, never the body
// (mass-assignment is ignored).
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  trainerProfileFindUnique: vi.fn(),
  customFieldFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  userUpsert: vi.fn(),
  dogCreate: vi.fn(),
  clientProfileCreate: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  clientProfileUpdate: vi.fn(),
  customFieldValueCreate: vi.fn(),
  verificationTokenCreate: vi.fn(),
  onboardingUpdateMany: vi.fn(),
  formFindFirst: vi.fn(),
  $transaction: vi.fn(),
  safeEvaluate: vi.fn(),
  sendEmail: vi.fn(),
  ensureTrainerSlug: vi.fn(),
  /** Callbacks the route handed to `after()`. Run them to exercise the
   *  post-response work (achievements + the invite email). */
  deferred: [] as (() => unknown)[],
}))

// guardPermission returns a NextResponse on failure; the route checks
// `instanceof NextResponse`, so the real next/server module must be used —
// spread the real module and replace only `after`, which throws outside a
// request scope. Capturing the callbacks rather than dropping them means the
// invite email is still under test, just on the other side of the response.
vi.mock('next/server', async (orig) => ({
  ...(await orig() as object),
  after: (fn: () => unknown) => { h.deferred.push(fn) },
}))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerProfileFindUnique },
    customField: { findMany: h.customFieldFindMany },
    user: { findUnique: h.userFindUnique, create: h.userCreate, upsert: h.userUpsert },
    dog: { create: h.dogCreate },
    clientProfile: { create: h.clientProfileCreate, findUnique: h.clientProfileFindUnique, update: h.clientProfileUpdate },
    customFieldValue: { create: h.customFieldValueCreate },
    verificationToken: { create: h.verificationTokenCreate },
    trainerOnboardingProgress: { updateMany: h.onboardingUpdateMany },
    form: { findFirst: h.formFindFirst },
    $transaction: h.$transaction,
  },
}))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail, fromTrainer: (n: string) => n }))
vi.mock('@/lib/client-invite-email', () => ({ renderClientInviteEmail: () => ({ subject: 's', text: 't', html: 'h', displayName: 'd', trainerEmail: null }) }))
vi.mock('@/lib/slug', () => ({ ensureTrainerSlug: h.ensureTrainerSlug, clientInviteUrl: () => 'https://x' }))

import { NextResponse } from 'next/server'
import { POST } from '@/app/api/clients/route'

// guardPermission grants the calling member their company context.
function grant(companyId = 'company-A') {
  h.guardPermission.mockResolvedValue({ companyId, userId: 'u1', membershipId: 'mem1', role: 'OWNER', permissions: {} })
}
function deny(status: number) {
  h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'x' }, { status }))
}

function req(body: unknown) {
  return new Request('https://app.pupmanager.com/api/clients', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  Object.values(h).forEach(v => { if (typeof v === 'function') v.mockReset() })
  h.deferred.length = 0
  // Sensible defaults for the happy-path collaborators.
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u1', trainerId: 'company-A' } })
  h.trainerProfileFindUnique.mockResolvedValue({
    id: 'company-A', businessName: 'A', logoUrl: null, emailAccentColor: null,
    clientFieldConfig: null, // → library defaults: name required, phone quick-add
    user: { name: 'Owner', email: 'owner@a.test' },
  })
  h.customFieldFindMany.mockResolvedValue([])
  h.userFindUnique.mockResolvedValue(null)
  h.safeEvaluate.mockResolvedValue(undefined)
  h.onboardingUpdateMany.mockResolvedValue({})
  // Run the transaction callback against tx fakes.
  h.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({
    user: { findUnique: h.userFindUnique, create: h.userCreate, upsert: h.userUpsert },
    dog: { create: h.dogCreate },
    clientProfile: { create: h.clientProfileCreate, findUnique: h.clientProfileFindUnique, update: h.clientProfileUpdate },
    customFieldValue: { create: h.customFieldValueCreate },
    verificationToken: { create: h.verificationTokenCreate },
  }))
  h.userCreate.mockResolvedValue({ id: 'client-user-1' })
  h.userUpsert.mockResolvedValue({ id: 'client-user-1' })
  h.dogCreate.mockResolvedValue({ id: 'dog-1' })
  h.clientProfileCreate.mockResolvedValue({ id: 'profile-1' })
  h.clientProfileFindUnique.mockResolvedValue(null) // no existing profile → create
  h.clientProfileUpdate.mockResolvedValue({})
  h.formFindFirst.mockResolvedValue(null) // default: no intake form matches
})

describe('POST /api/clients — authorisation', () => {
  it('blocks a member lacking clients.invite with the guard status (403)', async () => {
    deny(403)
    const res = await POST(req({ mode: 'full', name: 'Jess' }))
    expect(res.status).toBe(403)
    expect(h.clientProfileCreate).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request via the guard (401)', async () => {
    deny(401)
    const res = await POST(req({ mode: 'full', name: 'Jess' }))
    expect(res.status).toBe(401)
  })

  it('rejects a non-trainer session even if the guard somehow passed (401)', async () => {
    grant()
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'c1' } })
    const res = await POST(req({ mode: 'full', name: 'Jess' }))
    expect(res.status).toBe(401)
    expect(h.clientProfileCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/clients — required-field enforcement (per company config)', () => {
  it('rejects full create with no name (name is always required)', async () => {
    grant()
    const res = await POST(req({ mode: 'full' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required/i)
    expect(h.clientProfileCreate).not.toHaveBeenCalled()
  })

  it('rejects quick create with no name (the one field that is required)', async () => {
    grant()
    const res = await POST(req({ mode: 'quick', phone: '021 000 0000' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name is required/i)
  })

  // Quick-add shows phone and email by default, but showing a field is not the
  // same as demanding it: you have to be able to jot down a walk-in you only
  // caught the name of. Requiring every quick-add field is what broke this.
  it('accepts a quick create with only a name', async () => {
    grant()
    const res = await POST(req({ mode: 'quick', name: 'Jess' }))
    expect(res.status).toBe(201)
    expect(h.clientProfileCreate).toHaveBeenCalledTimes(1)
  })

  it('a custom field on quick-add is only demanded when it is also required', async () => {
    grant()
    h.customFieldFindMany.mockResolvedValue([
      { id: 'cf1', label: 'Goal', required: false, inQuickAdd: true, appliesTo: 'OWNER' },
    ])
    expect((await POST(req({ mode: 'quick', name: 'Jess' }))).status).toBe(201)

    h.customFieldFindMany.mockResolvedValue([
      { id: 'cf1', label: 'Goal', required: true, inQuickAdd: true, appliesTo: 'OWNER' },
    ])
    const res = await POST(req({ mode: 'quick', name: 'Jess' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Goal is required/i)
  })

  it('enforces a custom field marked required', async () => {
    grant()
    h.customFieldFindMany.mockResolvedValue([
      { id: 'cf1', label: 'Goal', required: true, inQuickAdd: false, appliesTo: 'OWNER' },
    ])
    const res = await POST(req({ mode: 'full', name: 'Jess' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Goal is required/i)
  })

  it('creates the client when all required fields are satisfied (201)', async () => {
    grant()
    const res = await POST(req({ mode: 'full', name: 'Jess Carter' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.clientId).toBe('profile-1')
    expect(h.clientProfileCreate).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/clients — intake form assignment', () => {
  it('assigns an owned, intake-usable form, looked up within the caller company', async () => {
    grant('company-A')
    h.formFindFirst.mockResolvedValue({ id: 'form-1' })
    // No email → the placeholder-create branch, where intakeFormId lands on
    // the clientProfile.create itself.
    const res = await POST(req({ mode: 'full', name: 'Jess', formId: 'form-1' }))
    expect(res.status).toBe(201)
    expect(h.formFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'form-1', trainerId: 'company-A', usableAsIntake: true } }),
    )
    expect(h.clientProfileCreate.mock.calls[0][0].data.intakeFormId).toBe('form-1')
  })

  it("ignores a formId the caller doesn't own, or that isn't usable as intake", async () => {
    grant('company-A')
    h.formFindFirst.mockResolvedValue(null) // nothing matches in scope
    const res = await POST(req({ mode: 'full', name: 'Jess', formId: 'someone-elses' }))
    // Silently unassigned rather than a 400: the client is still created, and
    // they simply get the trainer's usual fields.
    expect(res.status).toBe(201)
    expect(h.clientProfileCreate.mock.calls[0][0].data.intakeFormId).toBeNull()
  })
})

describe('POST /api/clients — mass-assignment guard', () => {
  it('takes trainerId from the membership context, ignoring a body trainerId', async () => {
    grant('company-A')
    const res = await POST(req({ mode: 'full', name: 'Jess', trainerId: 'company-EVIL', id: 'forced-id' }))
    expect(res.status).toBe(201)
    // The profile is scoped to the caller's company, NOT the attacker's value.
    const createArg = h.clientProfileCreate.mock.calls[0][0]
    expect(createArg.data.trainerId).toBe('company-A')
    expect(createArg.data.trainerId).not.toBe('company-EVIL')
    // No forced primary-key was honoured.
    expect(createArg.data.id).toBeUndefined()
  })

  it('looks up the trainer profile by the guarded company id, not the body', async () => {
    grant('company-A')
    await POST(req({ mode: 'full', name: 'Jess', trainerId: 'company-EVIL' }))
    expect(h.trainerProfileFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'company-A' } }),
    )
  })

  it('does NOT 409 a duplicate real email — it joins/reuses instead (no second User)', async () => {
    grant()
    // The person already exists; upsert resolves to them, and they already have
    // a profile for this trainer → JOIN, no new User, no new ClientProfile.
    h.userFindUnique.mockResolvedValue({ id: 'existing-user' })
    h.userUpsert.mockResolvedValue({ id: 'existing-user' })
    h.clientProfileFindUnique.mockResolvedValue({ id: 'existing-profile', dogId: 'd0', phone: '021', addressLine: 'x' })
    const res = await POST(req({ mode: 'full', name: 'Jess', email: 'taken@x.test' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.clientId).toBe('existing-profile')
    // No duplicate person, no duplicate profile.
    expect(h.userCreate).not.toHaveBeenCalled()
    expect(h.clientProfileCreate).not.toHaveBeenCalled()
  })
})

// "Adding a full client takes a long time." It did: the response waited on a
// round trip to Resend. Measured on the dev box, a full client with an invite
// took ~860ms versus ~25ms without one. The send now runs after the response.
// These guard the two halves of that: nothing mail-shaped happens before the
// trainer gets their answer, and the mail still goes out afterwards.
describe('POST /api/clients — the invite email does not block the response', () => {
  const fullWithInvite = {
    mode: 'full', name: 'Jess', email: 'jess@x.test', sendInvite: true, emailBody: 'hi',
    dogs: [{ name: 'Rex' }],
  }

  it('answers without having sent anything', async () => {
    grant()
    h.ensureTrainerSlug.mockResolvedValue('a-slug')
    h.sendEmail.mockResolvedValue({ error: null })

    const res = await POST(req(fullWithInvite))

    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ ok: true, clientId: 'profile-1' })
    // Not yet — it's queued, not sent.
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.safeEvaluate).not.toHaveBeenCalled()
    expect(h.deferred).toHaveLength(1)
  })

  it('still sends it — and ticks the onboarding step — once the response is out', async () => {
    grant()
    h.ensureTrainerSlug.mockResolvedValue('a-slug')
    h.sendEmail.mockResolvedValue({ error: null })

    await POST(req(fullWithInvite))
    for (const fn of h.deferred) await fn()

    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.sendEmail.mock.calls[0][0]).toMatchObject({ to: 'jess@x.test' })
    expect(h.safeEvaluate).toHaveBeenCalledWith('profile-1')
    expect(h.onboardingUpdateMany).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the trainer left the invite off', async () => {
    grant()
    const res = await POST(req({ ...fullWithInvite, sendInvite: false }))
    expect(res.status).toBe(201)
    for (const fn of h.deferred) await fn()
    expect(h.sendEmail).not.toHaveBeenCalled()
    // The achievement pass still runs — it isn't conditional on the invite.
    expect(h.safeEvaluate).toHaveBeenCalledWith('profile-1')
  })
})

// Quick add used to be barred from inviting outright — the gate read
// `!isQuick && …`, because quick add had no UI for it, not because a walk-in
// shouldn't be invited. Karl asked for the option, so the bar came off and the
// rule is now the same for both: they asked, and there is an address.
describe('POST /api/clients — quick add can invite, but only when asked', () => {
  const quick = { mode: 'quick', name: 'Jess', email: 'jess@x.test' }

  it('sends when the trainer ticked the box', async () => {
    grant()
    h.ensureTrainerSlug.mockResolvedValue('a-slug')
    h.sendEmail.mockResolvedValue({ error: null })

    const res = await POST(req({ ...quick, sendInvite: true }))
    expect(res.status).toBe(201)
    for (const fn of h.deferred) await fn()

    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.sendEmail.mock.calls[0][0]).toMatchObject({ to: 'jess@x.test' })
  })

  it('sends nothing by default — quick add is for capturing someone in ten seconds', async () => {
    grant()
    const res = await POST(req(quick))
    expect(res.status).toBe(201)
    for (const fn of h.deferred) await fn()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('cannot invite someone with no email, however hard it is asked', async () => {
    // The whole point of quick add is jotting down a walk-in whose address you
    // do not have. Asking to invite them is not an error — there is simply
    // nowhere to send it, and no placeholder address may ever be mailed.
    grant()
    const res = await POST(req({ mode: 'quick', name: 'Jess', sendInvite: true }))
    expect(res.status).toBe(201)
    for (const fn of h.deferred) await fn()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('a failed send is swallowed, not thrown at the (already sent) response', async () => {
    grant()
    h.ensureTrainerSlug.mockRejectedValue(new Error('Resend is down'))
    const res = await POST(req({
      mode: 'full', name: 'Jess', email: 'jess@x.test', sendInvite: true, emailBody: 'hi',
      dogs: [{ name: 'Rex' }],
    }))
    expect(res.status).toBe(201)
    await expect(Promise.all(h.deferred.map(fn => fn()))).resolves.toBeDefined()
  })
})
