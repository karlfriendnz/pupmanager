import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Deleting the wrong `trainerId` would destroy a paying customer's business.
 *
 * `purgeDemoTenant` therefore refuses unless FOUR independent facts hold, and
 * these tests knock out one leg at a time. Every case asserts the same thing:
 * `user.delete` was NOT called.
 *
 * The last block proves the other half of the promise — that a purge which DOES
 * go ahead leaves the marketing record alone.
 */

const h = vi.hoisted(() => ({
  profileFindUnique: vi.fn(),
  demoSessionFindUnique: vi.fn(),
  demoSessionUpdate: vi.fn(),
  clientFindMany: vi.fn(),
  userDelete: vi.fn(),
  userDeleteMany: vi.fn(),
  leadDelete: vi.fn(),
  leadDeleteMany: vi.fn(),
  leadUpdate: vi.fn(),
}))

const prismaMock = {
  trainerProfile: { findUnique: h.profileFindUnique },
  demoSession: { findUnique: h.demoSessionFindUnique, update: h.demoSessionUpdate },
  clientProfile: { findMany: h.clientFindMany },
  user: { delete: h.userDelete, deleteMany: h.userDeleteMany },
  demoLead: { delete: h.leadDelete, deleteMany: h.leadDeleteMany, update: h.leadUpdate },
}

vi.mock('@/lib/demo-seed', () => ({ seedDemoData: vi.fn(async () => ({})), resetDemoData: vi.fn(async () => ({})) }))

import { DEMO_EMAIL_DOMAIN, NotADemoTenantError, purgeDemoTenant } from '@/lib/demo-tenant'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = prismaMock as any

/** A tenant that satisfies every check. Individual tests spoil one leg. */
function goodTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 't-demo',
    demoSessionId: 'ds-1',
    demoExpiresAt: new Date(Date.now() + 60_000),
    userId: 'u-demo',
    user: { id: 'u-demo', email: `demo-ds-1${DEMO_EMAIL_DOMAIN}` },
    ...overrides,
  }
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.profileFindUnique.mockResolvedValue(goodTenant())
  h.demoSessionFindUnique.mockResolvedValue({ id: 'ds-1', trainerId: 't-demo' })
  h.demoSessionUpdate.mockResolvedValue({})
  h.clientFindMany.mockResolvedValue([])
  h.userDelete.mockResolvedValue({})
  h.userDeleteMany.mockResolvedValue({ count: 0 })
})

describe('purgeDemoTenant — refuses anything not marked demo', () => {
  it('refuses a real, paying business (no markers at all)', async () => {
    h.profileFindUnique.mockResolvedValue({
      id: 't-real',
      demoSessionId: null,
      demoExpiresAt: null,
      userId: 'u-real',
      user: { id: 'u-real', email: 'brooke@pawsandthrive.co.nz' },
    })
    await expect(purgeDemoTenant(prisma, 't-real')).rejects.toBeInstanceOf(NotADemoTenantError)
    expect(h.userDelete).not.toHaveBeenCalled()
  })

  it('refuses a tenant missing demoSessionId', async () => {
    h.profileFindUnique.mockResolvedValue(goodTenant({ demoSessionId: null }))
    await expect(purgeDemoTenant(prisma, 't-demo')).rejects.toThrow(/demoSessionId is not set/)
    expect(h.userDelete).not.toHaveBeenCalled()
  })

  it('refuses a tenant missing demoExpiresAt', async () => {
    h.profileFindUnique.mockResolvedValue(goodTenant({ demoExpiresAt: null }))
    await expect(purgeDemoTenant(prisma, 't-demo')).rejects.toThrow(/demoExpiresAt is not set/)
    expect(h.userDelete).not.toHaveBeenCalled()
  })

  it('refuses when the owner login is a REAL address, however the markers look', async () => {
    // The nightmare shape: somebody managed to write the marker columns onto a
    // real customer's business. The reserved .test domain is the leg that
    // cannot be forged, because a real account cannot sign up on it.
    h.profileFindUnique.mockResolvedValue(goodTenant({ user: { id: 'u-real', email: 'brooke@pawsandthrive.co.nz' } }))
    await expect(purgeDemoTenant(prisma, 't-demo')).rejects.toThrow(/owner email is not on/)
    expect(h.userDelete).not.toHaveBeenCalled()
  })

  it('refuses when the demo session does not exist', async () => {
    h.demoSessionFindUnique.mockResolvedValue(null)
    await expect(purgeDemoTenant(prisma, 't-demo')).rejects.toThrow(/names no demo session/)
    expect(h.userDelete).not.toHaveBeenCalled()
  })

  it('refuses when the pairing is not MUTUAL — the copy-paste accident', async () => {
    // The tenant names a session, but that session points at a different
    // tenant. Exactly the shape a mistyped id would take.
    h.demoSessionFindUnique.mockResolvedValue({ id: 'ds-1', trainerId: 't-somebody-else' })
    await expect(purgeDemoTenant(prisma, 't-demo')).rejects.toThrow(/does not point back at this tenant/)
    expect(h.userDelete).not.toHaveBeenCalled()
  })

  it('refuses a tenant that does not exist rather than reporting success', async () => {
    h.profileFindUnique.mockResolvedValue(null)
    await expect(purgeDemoTenant(prisma, 't-gone')).rejects.toBeInstanceOf(NotADemoTenantError)
    expect(h.userDelete).not.toHaveBeenCalled()
  })
})

describe('purgeDemoTenant — what it does when every check passes', () => {
  it('deletes the owner, which cascades the whole tenant', async () => {
    await purgeDemoTenant(prisma, 't-demo')
    expect(h.userDelete).toHaveBeenCalledWith({ where: { id: 'u-demo' } })
  })

  it('sweeps the sandbox\'s sample client logins, but only orphaned ones on a test domain', async () => {
    h.clientFindMany.mockResolvedValue([{ userId: 'cu-1' }, { userId: 'cu-2' }])
    h.userDeleteMany.mockResolvedValue({ count: 2 })
    const res = await purgeDemoTenant(prisma, 't-demo')

    const where = h.userDeleteMany.mock.calls[0][0].where
    expect(where.id).toEqual({ in: ['cu-1', 'cu-2'] })
    // Nothing with a life outside this sandbox is touched.
    expect(where.clientProfiles).toEqual({ none: {} })
    expect(where.memberships).toEqual({ none: {} })
    expect(where.trainerProfile).toBeNull()
    expect(res.clientUsersDeleted).toBe(2)
  })

  it('NEVER touches the lead — that is the entire point of the exercise', async () => {
    await purgeDemoTenant(prisma, 't-demo')
    expect(h.leadDelete).not.toHaveBeenCalled()
    expect(h.leadDeleteMany).not.toHaveBeenCalled()
    expect(h.leadUpdate).not.toHaveBeenCalled()
  })

  it('keeps the visit on record with its tenant pointers nulled', async () => {
    await purgeDemoTenant(prisma, 't-demo')
    const data = h.demoSessionUpdate.mock.calls[0][0].data
    expect(data.status).toBe('PURGED')
    expect(data.purgedAt).toBeInstanceOf(Date)
    expect(data.trainerId).toBeNull()
    expect(data.ownerUserId).toBeNull()
    // A used-up sandbox must not leave a working entry token behind.
    expect(data.entryTokenHash).toBeNull()
  })
})
