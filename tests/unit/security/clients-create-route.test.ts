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
  $transaction: vi.fn(),
  safeEvaluate: vi.fn(),
  sendEmail: vi.fn(),
  ensureTrainerSlug: vi.fn(),
}))

// guardPermission returns a NextResponse on failure; the route checks
// `instanceof NextResponse`, so the real next/server module must be used.
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
  Object.values(h).forEach(fn => fn.mockReset())
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

  it('rejects quick create missing the other required fields (name + phone + email)', async () => {
    grant()
    // Quick-add captures email as well now, so a name-only create is rejected —
    // whichever of the missing fields is reported first.
    const res = await POST(req({ mode: 'quick', name: 'Jess' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/phone|email/i)
  })

  it('rejects quick create that has a phone but no email', async () => {
    grant()
    const res = await POST(req({ mode: 'quick', name: 'Jess', phone: '021 000 0000' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/email/i)
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
