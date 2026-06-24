import { describe, it, expect, vi, beforeEach } from 'vitest'

// Account deletion is a destructive, CSRF-attractive endpoint. It must require:
// same-origin, auth, rate-limit, AND re-authentication (password for credential
// users / typing DELETE for OAuth-only). On success it SOFT-deletes (sets
// deactivatedAt) on the CALLER's own row only — never another user. We mock every
// imported side-effect so the test exercises only the authz/branching logic.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSameOrigin: vi.fn(),
  enforceRateLimit: vi.fn(),
  recordAudit: vi.fn(),
  auditRequestMeta: vi.fn(),
  notifyTrainerDeletion: vi.fn(),
  bcryptCompare: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: h.requireSameOrigin }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit }))
vi.mock('@/lib/audit', () => ({ recordAudit: h.recordAudit, auditRequestMeta: h.auditRequestMeta }))
vi.mock('@/lib/notify-new-trainer', () => ({ notifyTrainerDeletion: h.notifyTrainerDeletion }))
vi.mock('bcryptjs', () => ({ default: { compare: h.bcryptCompare }, compare: h.bcryptCompare }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: h.userFindUnique, update: h.userUpdate },
  },
}))

import { DELETE } from '@/app/api/user/delete/route'

const req = (body: unknown = {}) =>
  new Request('https://app.pupmanager.com/api/user/delete', {
    method: 'DELETE',
    body: JSON.stringify(body),
  })

// A credentials user whose stored password hash is 'HASH'.
const credUser = {
  id: 'u1', deactivatedAt: null, name: 'Olivia', email: 'o@x.test', role: 'TRAINER',
  trainerProfile: { businessName: 'Dog School', phone: '021' },
  accounts: [{ provider: 'credentials', providerAccountId: 'HASH' }],
}
// An OAuth-only user (no credentials account) — re-auth is "type DELETE".
const oauthUser = {
  id: 'u2', deactivatedAt: null, name: 'Greg', email: 'g@x.test', role: 'TRAINER',
  trainerProfile: { businessName: 'Greg Dogs', phone: '022' },
  accounts: [{ provider: 'google', providerAccountId: 'google-sub' }],
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.requireSameOrigin.mockReturnValue(null) // same-origin OK by default
  h.enforceRateLimit.mockResolvedValue(null) // under limit by default
  h.auditRequestMeta.mockReturnValue({ ip: '1.2.3.4', userAgent: 'test' })
  h.recordAudit.mockResolvedValue(undefined)
  h.notifyTrainerDeletion.mockResolvedValue(undefined)
  h.userUpdate.mockResolvedValue({})
})

describe('DELETE user/delete — auth + re-auth + self-only soft delete', () => {
  it('blocks a cross-origin request before any auth/DB work (CSRF guard)', async () => {
    const blocked = new Response('forbidden', { status: 403 })
    h.requireSameOrigin.mockReturnValue(blocked)
    const res = await DELETE(req())
    expect(res.status).toBe(403)
    expect(h.auth).not.toHaveBeenCalled()
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request with 401', async () => {
    h.auth.mockResolvedValue(null)
    const res = await DELETE(req({ password: 'secret123' }))
    expect(res.status).toBe(401)
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('honours the rate limiter (returns its response, no deletion)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } })
    h.enforceRateLimit.mockResolvedValue(new Response('slow down', { status: 429 }))
    const res = await DELETE(req({ password: 'secret123' }))
    expect(res.status).toBe(429)
    expect(h.userFindUnique).not.toHaveBeenCalled()
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('rejects a credentials user with the WRONG password (403) and does not delete', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } })
    h.userFindUnique.mockResolvedValue(credUser)
    h.bcryptCompare.mockResolvedValue(false)
    const res = await DELETE(req({ password: 'wrong' }))
    expect(res.status).toBe(403)
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('rejects a credentials user supplying NO password (403)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } })
    h.userFindUnique.mockResolvedValue(credUser)
    const res = await DELETE(req({})) // no password field
    expect(res.status).toBe(403)
    expect(h.bcryptCompare).not.toHaveBeenCalled()
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('rejects an OAuth-only user who does not type DELETE (403)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u2' } })
    h.userFindUnique.mockResolvedValue(oauthUser)
    const res = await DELETE(req({ confirm: 'delete please' }))
    expect(res.status).toBe(403)
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('soft-deletes ONLY the caller own row on correct password', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', trainerId: 'co1' } })
    h.userFindUnique.mockResolvedValue(credUser)
    h.bcryptCompare.mockResolvedValue(true)

    const res = await DELETE(req({ password: 'secret123' }))
    expect(res.status).toBe(200)

    // The lookup AND the update are both keyed to the session user id — there is
    // no body-supplied target, so you cannot delete another user.
    expect(h.userFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }))
    expect(h.userUpdate).toHaveBeenCalledTimes(1)
    const upd = h.userUpdate.mock.calls[0][0]
    expect(upd.where).toEqual({ id: 'u1' })
    // SOFT delete — sets deactivatedAt, never a hard prisma.user.delete.
    expect(upd.data.deactivatedAt).toBeInstanceOf(Date)
    expect(h.recordAudit).toHaveBeenCalledTimes(1)
  })

  it('lets an OAuth-only user delete by typing DELETE (case-insensitive)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u2' } })
    h.userFindUnique.mockResolvedValue(oauthUser)
    const res = await DELETE(req({ confirm: 'delete' }))
    expect(res.status).toBe(200)
    expect(h.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u2' } }),
    )
  })

  it('is idempotent — an already-deactivated account returns ok without re-deleting', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } })
    h.userFindUnique.mockResolvedValue({ ...credUser, deactivatedAt: new Date() })
    const res = await DELETE(req({ password: 'secret123' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ alreadyScheduled: true })
    expect(h.userUpdate).not.toHaveBeenCalled()
  })
})
