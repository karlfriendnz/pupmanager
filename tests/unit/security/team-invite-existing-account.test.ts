import { describe, it, expect, vi, beforeEach } from 'vitest'

// Inviting someone who already has a PupManager login used to 409 outright
// ("Someone with this email already has a PupManager account"), so a person who
// owns a business could never contract for another. They're now LINKED — a new
// membership on the existing user, with their role and name left alone.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getTrainerContext: vi.fn(),
  requirePermission: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  memberFindUnique: vi.fn(),
  memberCreate: vi.fn(),
  memberCount: vi.fn(),
  profileFindUnique: vi.fn(),
  tokenCreate: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
class FakePermissionError extends Error {}
vi.mock('@/lib/membership', () => ({
  getTrainerContext: h.getTrainerContext,
  guardPermission: vi.fn(),
  requirePermission: h.requirePermission,
  PermissionError: FakePermissionError,
}))
vi.mock('@/lib/permissions', () => ({
  can: () => true,
  canManageMemberRole: () => true,
  asPermissionMap: (p: unknown) => (p ?? {}),
  PERMISSION_KEYS: [],
}))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail, fromTrainer: (n: string) => n }))
vi.mock('@/lib/emails/team-invite', () => ({
  renderTeamInviteEmail: () => ({ subject: 's', text: 't', html: '<p>h</p>' }),
}))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: h.userFindUnique },
    trainerMembership: { findUnique: h.memberFindUnique, count: h.memberCount },
    trainerProfile: { findUnique: h.profileFindUnique },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: h.userCreate },
        trainerMembership: { create: h.memberCreate },
        verificationToken: { create: h.tokenCreate },
      }),
  },
}))

const EXISTING = { id: 'u_owner_of_another_business', name: 'Jess Carter' }

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u_me', role: 'TRAINER', trainerId: 'co_1' } })
  const ctx = { userId: 'u_me', companyId: 'co_1', membershipId: 'm_1', role: 'OWNER', permissions: {} }
  h.getTrainerContext.mockResolvedValue(ctx)
  h.requirePermission.mockResolvedValue(ctx)
  h.profileFindUnique.mockResolvedValue({
    businessName: 'Paws & Thrive', logoUrl: null, emailAccentColor: null,
    seatCount: 10, subscriptionStatus: 'ACTIVE',
    user: { name: 'Me', email: 'me@x.com' },
  })
  h.memberCount.mockResolvedValue(1)
  h.memberFindUnique.mockResolvedValue(null)
  h.sendEmail.mockResolvedValue({ error: null })
})

async function invite(email: string) {
  const { POST } = await import('@/app/api/trainer/team/route')
  return POST(new Request('http://localhost/api/trainer/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Jess Carter', email, role: 'STAFF', permissions: {} }),
  }))
}

describe('POST /api/trainer/team — existing accounts', () => {
  it('links an existing account instead of refusing it', async () => {
    h.userFindUnique.mockResolvedValue(EXISTING)
    const res = await invite('jess@herownbusiness.com')

    expect(res.status).not.toBe(409)
    // Linked to the SAME user — no second account for the same person.
    expect(h.userCreate).not.toHaveBeenCalled()
    expect(h.memberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: 'co_1', userId: EXISTING.id }),
      }),
    )
  })

  it('never rewrites the existing person’s role or name', async () => {
    h.userFindUnique.mockResolvedValue(EXISTING)
    await invite('jess@herownbusiness.com')
    // The only user write in this flow would be a create; there is none.
    expect(h.userCreate).not.toHaveBeenCalled()
  })

  it('still creates a brand-new user when the email is unknown', async () => {
    h.userFindUnique.mockResolvedValue(null)
    h.userCreate.mockResolvedValue({ id: 'u_new' })
    await invite('brand@new.com')
    expect(h.userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'TRAINER' }) }),
    )
  })

  it('refuses a duplicate invite to someone already on this team', async () => {
    h.userFindUnique.mockResolvedValue(EXISTING)
    h.memberFindUnique.mockResolvedValue({ acceptedAt: new Date() })
    const res = await invite('jess@herownbusiness.com')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'They are already on your team.' })
    expect(h.memberCreate).not.toHaveBeenCalled()
  })

  it('distinguishes a still-pending invite from an active member', async () => {
    h.userFindUnique.mockResolvedValue(EXISTING)
    h.memberFindUnique.mockResolvedValue({ acceptedAt: null })
    const res = await invite('jess@herownbusiness.com')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already been invited/i)
  })
})
