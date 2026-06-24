import { describe, it, expect, vi, beforeEach } from 'vitest'

// complete-profile is the gate-satisfying write (name + business + phone). It
// must: reject non-trainers; write ONLY to the profile the caller owns (keyed by
// session.user.id, never an attacker-supplied company id); and enforce the
// required-field validation the (trainer)/layout gate depends on.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  profileFindUnique: vi.fn(),
  transaction: vi.fn(),
  userUpdate: vi.fn(),
  profileUpdate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.profileFindUnique, update: h.profileUpdate },
    user: { update: h.userUpdate },
    $transaction: h.transaction,
  },
}))

import { POST } from '@/app/api/trainer/complete-profile/route'

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/trainer/complete-profile', {
    method: 'POST',
    body: JSON.stringify(body),
  })

const valid = { name: 'Olivia Owner', businessName: 'Dog School', phone: '021123456' }

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  // $transaction just runs the array of prisma ops it's handed.
  h.transaction.mockResolvedValue([])
})

describe('POST complete-profile — auth + ownership + validation', () => {
  it('rejects a non-trainer session with 401 (no DB lookup)', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'c1' } })
    const res = await POST(req(valid))
    expect(res.status).toBe(401)
    expect(h.profileFindUnique).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request with 401', async () => {
    h.auth.mockResolvedValue(null)
    const res = await POST(req(valid))
    expect(res.status).toBe(401)
  })

  it('looks up the owned profile by the CALLER own userId — not by any body field', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1' } })
    h.profileFindUnique.mockResolvedValue({ id: 'profile-1' })

    // Attempt to smuggle another company's id in the body.
    await POST(req({ ...valid, id: 'OTHER-company', companyId: 'OTHER-company', userId: 'victim' }))

    expect(h.profileFindUnique).toHaveBeenCalledWith({
      where: { userId: 't1' },
      select: { id: true },
    })
    // The update is keyed to the profile resolved from the caller's own id.
    expect(h.transaction).toHaveBeenCalledTimes(1)
    expect(h.profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'profile-1' } }),
    )
    // And the user name update targets the caller, not the smuggled userId.
    expect(h.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' } }),
    )
  })

  it('returns 404 when the caller owns no business profile (invited staff)', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'staff1' } })
    h.profileFindUnique.mockResolvedValue(null)
    const res = await POST(req(valid))
    expect(res.status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('rejects missing required fields (name/business/phone) with 400', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1' } })
    for (const body of [
      { businessName: 'Dog School', phone: '021123456' }, // no name
      { name: 'Olivia', phone: '021123456' }, // no business
      { name: 'Olivia', businessName: 'Dog School' }, // no phone
      { name: 'O', businessName: 'Dog School', phone: '021123456' }, // name too short
      { name: 'Olivia', businessName: 'Dog School', phone: '123' }, // phone too short
    ]) {
      const res = await POST(req(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(h.profileFindUnique).not.toHaveBeenCalled()
  })

  it('persists name + business + phone (default showPhoneToClients false) on success', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1' } })
    h.profileFindUnique.mockResolvedValue({ id: 'profile-1' })

    const res = await POST(req(valid))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'profile-1' },
      data: {
        businessName: 'Dog School',
        phone: '021123456',
        showPhoneToClients: false, // schema default — phone private unless opted in
        publicEmail: null, // empty/omitted normalises to null
      },
    })
  })
})
