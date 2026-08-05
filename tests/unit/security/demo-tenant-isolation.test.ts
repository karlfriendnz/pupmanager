import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A demo sandbox must be a NORMAL tenant as far as every query is concerned.
 *
 * That is the whole isolation argument: the sandbox is a real TrainerProfile
 * with a real OWNER membership, so every existing `where: { trainerId }` scope
 * fences it in for free. There is no "demo mode" branch in the data layer for a
 * bug to slip past — and these tests prove it by pointing a demo session at a
 * real customer's records through an ordinary tenant-scoped route.
 *
 * The route under test is `/api/clients/[clientId]`, chosen because it is the
 * plainest example of the pattern the other ~150 tenant tables follow.
 */

const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  ownsATrainerAccount: vi.fn(),
  membershipFindFirst: vi.fn(),
  profileFindUnique: vi.fn(),
  clientFindFirst: vi.fn(),
  clientFindUnique: vi.fn(),
  clientUpdate: vi.fn(),
  shareFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  dogUpdate: vi.fn(),
  dogCreate: vi.fn(),
}))

// Mocked WHOLE, not spread over the real module: importing the real one pulls
// NextAuth into the unit runner. The route only uses these two, and the tenancy
// question this file asks is answered further down, in getClientAccess — which
// stays real, talking to the mocked prisma.
vi.mock('@/lib/membership', () => ({
  guardPermission: h.guardPermission,
  ownsATrainerAccount: h.ownsATrainerAccount,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerMembership: { findFirst: h.membershipFindFirst },
    trainerProfile: { findUnique: h.profileFindUnique },
    clientProfile: { findFirst: h.clientFindFirst, findUnique: h.clientFindUnique, update: h.clientUpdate },
    clientShare: { findFirst: h.shareFindFirst },
    user: { update: h.userUpdate, findUnique: h.userFindUnique },
    dog: { update: h.dogUpdate, create: h.dogCreate },
  },
}))

import { PATCH } from '@/app/api/clients/[clientId]/route'

const DEMO_TENANT = 't-demo-sandbox'
const REAL_TENANT = 't-paws-and-thrive'
const REAL_CLIENT = 'client-of-paws-and-thrive'

function req(body: unknown) {
  return new Request(`https://app.pupmanager.com/api/clients/${REAL_CLIENT}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const params = { params: Promise.resolve({ clientId: REAL_CLIENT }) }

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  // The visitor at the stand: signed into the sandbox, an OWNER of it.
  h.guardPermission.mockResolvedValue({ userId: 'u-demo', companyId: DEMO_TENANT, role: 'OWNER', permissions: {} })
  h.membershipFindFirst.mockResolvedValue({ id: 'm-demo', companyId: DEMO_TENANT, role: 'OWNER', permissions: {} })
  h.shareFindFirst.mockResolvedValue(null)
  h.ownsATrainerAccount.mockResolvedValue(false)
})

describe('a demo sandbox cannot reach another tenant\'s records', () => {
  it('is told "not found" when it asks for a real business\'s client', async () => {
    // The scope query is `{ id: clientId, trainerId: companyId }` — the real
    // client is not in the sandbox's company, so nothing comes back.
    h.clientFindFirst.mockResolvedValue(null)

    const res = await PATCH(req({ name: 'Renamed by a stranger' }), params)

    expect(res.status).toBe(404)
    expect(h.clientUpdate).not.toHaveBeenCalled()
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('scopes the lookup by the SESSION\'s tenant, never by anything in the request', async () => {
    h.clientFindFirst.mockResolvedValue(null)
    await PATCH(req({ name: 'x', trainerId: REAL_TENANT }), params)

    const where = h.clientFindFirst.mock.calls[0][0].where
    expect(where.trainerId).toBe(DEMO_TENANT)
    expect(where.trainerId).not.toBe(REAL_TENANT)
  })

  it('cannot borrow a share it does not have', async () => {
    h.clientFindFirst.mockResolvedValue(null)
    h.shareFindFirst.mockResolvedValue(null)

    const res = await PATCH(req({ status: 'INACTIVE' }), params)
    expect(res.status).toBe(404)
    expect(h.clientUpdate).not.toHaveBeenCalled()
  })

  it('CAN edit a client inside its own sandbox — isolation, not paralysis', async () => {
    // The other half of the proof. If a sandbox could not change its own data
    // it would be a slideshow, not the product.
    h.clientFindFirst.mockResolvedValue({
      id: 'demo-client-1', userId: 'u-demo-client', dogId: null,
      trainerId: DEMO_TENANT, assignedMembershipId: null,
    })
    h.clientUpdate.mockResolvedValue({})

    const res = await PATCH(req({ status: 'INACTIVE' }), {
      params: Promise.resolve({ clientId: 'demo-client-1' }),
    })

    expect(res.status).toBe(200)
    expect(h.clientUpdate).toHaveBeenCalled()
  })
})
