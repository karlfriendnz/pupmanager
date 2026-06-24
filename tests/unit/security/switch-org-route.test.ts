import { describe, it, expect, vi, beforeEach } from 'vitest'

// switch-org is the multi-org IDOR surface: a trainer who belongs to >1 business
// picks which one they act in by POSTing a companyId. The guard MUST refuse to
// switch to a company the caller holds no accepted membership for — otherwise a
// trainer could re-point their JWT at a rival tenant. We assert both the 403 AND
// that unstable_update (which actually re-points the session) is never called.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  unstableUpdate: vi.fn(),
  membershipFindUnique: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth, unstable_update: h.unstableUpdate }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerMembership: { findUnique: h.membershipFindUnique },
  },
}))

import { POST } from '@/app/api/trainer/switch-org/route'

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/trainer/switch-org', {
    method: 'POST',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.unstableUpdate.mockResolvedValue(undefined)
})

describe('POST switch-org — cross-tenant org-switch IDOR guard', () => {
  it('returns 403 and does NOT switch when the caller holds no membership for the target company', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1' } })
    // No accepted membership for the requested company → foreign org.
    h.membershipFindUnique.mockResolvedValue(null)

    const res = await POST(req({ companyId: 'FOREIGN-company' }))
    expect(res.status).toBe(403)
    // Critical: the active-company state is never re-pointed.
    expect(h.unstableUpdate).not.toHaveBeenCalled()
  })

  it('scopes the membership lookup to the CALLER (companyId_userId), never company alone', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1' } })
    h.membershipFindUnique.mockResolvedValue(null)

    await POST(req({ companyId: 'company-B' }))

    expect(h.membershipFindUnique).toHaveBeenCalledTimes(1)
    const arg = h.membershipFindUnique.mock.calls[0][0]
    // The where clause must bind BOTH the company AND the caller's own id, so a
    // membership belonging to another user can't satisfy it.
    expect(arg.where.companyId_userId).toEqual({ companyId: 'company-B', userId: 't1' })
  })

  it('switches only when the caller genuinely holds a membership for the company', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1' } })
    h.membershipFindUnique.mockResolvedValue({ id: 'm1' })

    const res = await POST(req({ companyId: 'company-A' }))
    expect(res.status).toBe(200)
    expect(h.unstableUpdate).toHaveBeenCalledTimes(1)
    // It re-points trainerId to the requested (and validated) company.
    expect(h.unstableUpdate).toHaveBeenCalledWith({ trainerId: 'company-A' })
  })

  it('rejects a non-trainer session with 401 (and never touches the DB)', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'c1' } })
    const res = await POST(req({ companyId: 'company-A' }))
    expect(res.status).toBe(401)
    expect(h.membershipFindUnique).not.toHaveBeenCalled()
    expect(h.unstableUpdate).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request with 401', async () => {
    h.auth.mockResolvedValue(null)
    const res = await POST(req({ companyId: 'company-A' }))
    expect(res.status).toBe(401)
  })

  it('rejects a missing/invalid companyId with 400 (and does not switch)', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1' } })
    const res = await POST(req({ companyId: '' }))
    expect(res.status).toBe(400)
    expect(h.membershipFindUnique).not.toHaveBeenCalled()
    expect(h.unstableUpdate).not.toHaveBeenCalled()
  })
})
