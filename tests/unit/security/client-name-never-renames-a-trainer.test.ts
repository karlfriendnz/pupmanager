import { describe, it, expect, vi, beforeEach } from 'vitest'

// A client's name lives on the shared User row — the same row that person signs
// in with. A person can be a client of one trainer AND run their own business on
// PupManager (ClientProfile is keyed by (userId, trainerId), so the User is
// shared on purpose), and a trainer can end up with a client profile against
// their OWN user when a booking is taken with their own email.
//
// PATCH /api/clients/[clientId] wrote `name` straight onto that row. Renaming
// such a client therefore renamed a real PupManager ACCOUNT: their Settings →
// "Your name", and with it the sender name on every email their business sends.
// One trainer's Business details silently became the name of a client they'd
// sent a payment link to, and their outbound mail went out signed with it.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  getClientAccess: vi.fn(),
  membershipFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  clientProfileUpdate: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/trainer-access', () => ({ getClientAccess: h.getClientAccess }))
vi.mock('@/lib/dogs', () => ({ extraClientDogs: vi.fn(async () => []) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerMembership: { findFirst: h.membershipFindFirst },
    user: { update: h.userUpdate, findUnique: h.userFindUnique },
    clientProfile: { update: h.clientProfileUpdate },
    dog: { update: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { PATCH } from '@/app/api/clients/[clientId]/route'

const CLIENT_PROFILE = 'cp_1'
const CLIENT_USER = 'u_client'
const TRAINER = 'tr_1'

function req(body: unknown): Request {
  return new Request(`https://app.pupmanager.com/api/clients/${CLIENT_PROFILE}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const params = Promise.resolve({ clientId: CLIENT_PROFILE })

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.guardPermission.mockResolvedValue({ userId: 'u_trainer', companyId: TRAINER })
  h.getClientAccess.mockResolvedValue({
    canEdit: true,
    trainerId: TRAINER,
    client: { id: CLIENT_PROFILE, userId: CLIENT_USER, trainerId: TRAINER },
  })
  h.userUpdate.mockResolvedValue({})
  h.clientProfileUpdate.mockResolvedValue({})
})

describe('PATCH /api/clients/[clientId] — a client edit must not rename an account', () => {
  it('refuses to write the name when that person holds a trainer account', async () => {
    h.membershipFindFirst.mockResolvedValue({ id: 'tm_1' })

    const res = await PATCH(req({ name: 'Sarah Jones' }), { params })

    expect(res.status).toBe(409)
    expect(h.userUpdate).not.toHaveBeenCalled()
    const body = await res.json()
    expect(String(body.error)).toMatch(/own PupManager account/i)
  })

  it('checks the membership of the CLIENT, not of the trainer doing the editing', async () => {
    h.membershipFindFirst.mockResolvedValue(null)
    await PATCH(req({ name: 'Sarah Jones' }), { params })
    expect(h.membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: CLIENT_USER } }),
    )
  })

  it('still renames an ordinary client who has no account of their own', async () => {
    h.membershipFindFirst.mockResolvedValue(null)

    const res = await PATCH(req({ name: 'Sarah Jones' }), { params })

    expect(res.status).toBe(200)
    expect(h.userUpdate).toHaveBeenCalledWith({
      where: { id: CLIENT_USER },
      data: { name: 'Sarah Jones' },
    })
  })

  it('leaves the other fields editable on a client who does hold an account', async () => {
    h.membershipFindFirst.mockResolvedValue({ id: 'tm_1' })

    // No name in the payload — nothing to protect, so the edit goes through.
    const res = await PATCH(req({ phone: '021 555 0100' }), { params })

    expect(res.status).toBe(200)
    expect(h.clientProfileUpdate).toHaveBeenCalled()
    expect(h.userUpdate).not.toHaveBeenCalled()
  })
})
