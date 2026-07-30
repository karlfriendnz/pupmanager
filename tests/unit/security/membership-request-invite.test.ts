import { describe, it, expect, vi, beforeEach } from 'vitest'

// The third answer to a package request: ask the client to subscribe and pay for
// it themselves, rather than granting it for free.
//
// The guard that matters is that INVITED never becomes a dead end — inviting
// someone to pay for something checkout would refuse leaves the client tapping a
// button that 409s, and the trainer never finds out why.

const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  requestFindFirst: vi.fn(),
  requestUpdate: vi.fn(),
  requestUpdateMany: vi.fn(),
  trainerFindUnique: vi.fn(),
  membershipFindFirst: vi.fn(),
  notifyClient: vi.fn(),
  fulfilMembershipInTx: vi.fn(),
  enrolMembershipClasses: vi.fn(),
  safeEvaluate: vi.fn(),
  trainerRequestScope: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/membership-requests', () => ({ trainerRequestScope: h.trainerRequestScope }))
vi.mock('@/lib/memberships', () => ({
  fulfilMembershipInTx: h.fulfilMembershipInTx,
  enrolMembershipClasses: h.enrolMembershipClasses,
}))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    membershipRequest: {
      findFirst: h.requestFindFirst,
      update: h.requestUpdate,
      updateMany: h.requestUpdateMany,
    },
    trainerProfile: { findUnique: h.trainerFindUnique },
    membership: { findFirst: h.membershipFindFirst },
    $transaction: (fn: (t: unknown) => unknown) =>
      fn({ membershipRequest: { updateMany: h.requestUpdateMany } }),
  },
}))

import { PATCH } from '@/app/api/membership-requests/[requestId]/route'

function req(body: unknown) {
  return new Request('https://app.pupmanager.com/x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const params = (requestId = 'r1') => ({ params: Promise.resolve({ requestId }) })

const REQUEST = {
  id: 'r1', status: 'PENDING', clientId: 'c1', membershipId: 'm1',
  client: { userId: 'cu1', dog: { name: 'Bailey' } },
  membership: { name: 'Juniors' },
}

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.guardPermission.mockResolvedValue({ companyId: 't1', userId: 'tu1', role: 'OWNER' })
  h.trainerRequestScope.mockReturnValue({ membership: { trainerId: 't1' } })
  h.requestFindFirst.mockResolvedValue(REQUEST)
  h.requestUpdateMany.mockResolvedValue({ count: 1 })
  h.trainerFindUnique.mockResolvedValue({ businessName: 'E2E Dog School', recurringPaymentsEnabled: true, sandboxBilling: true })
  h.membershipFindFirst.mockResolvedValue({ cadence: 'RECURRING', plans: [{ id: 'plan1' }] })
  h.notifyClient.mockResolvedValue(undefined)
  h.fulfilMembershipInTx.mockResolvedValue({ classGrants: [], membershipPurchaseId: 'p1' })
  h.safeEvaluate.mockResolvedValue(undefined)
})

describe('inviting a client to subscribe', () => {
  it('marks the request INVITED and grants nothing', async () => {
    const res = await PATCH(req({ status: 'INVITED' }), params())

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, status: 'INVITED' })
    // Nothing was given away — the client pays for this themselves.
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
    expect(h.requestUpdateMany.mock.calls[0][0].data).toMatchObject({ status: 'INVITED' })
  })

  it('tells the client where to go and what it is', async () => {
    await PATCH(req({ status: 'INVITED' }), params())
    const notice = h.notifyClient.mock.calls[0][0]
    expect(notice.link).toBe('/my-memberships')
    expect(notice.vars.detail).toContain('subscribe')
  })

  it('refuses when the trainer isn’t switched on for recurring payments', async () => {
    // Otherwise the client taps through to a button the buy route 409s.
    h.trainerFindUnique.mockResolvedValue({ businessName: 'X', recurringPaymentsEnabled: false })
    const res = await PATCH(req({ status: 'INVITED' }), params())
    expect(res.status).toBe(409)
    expect(h.requestUpdateMany).not.toHaveBeenCalled()
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('refuses a ONE_OFF package — there is no subscription to start', async () => {
    h.membershipFindFirst.mockResolvedValue({ cadence: 'ONE_OFF', plans: [] })
    expect((await PATCH(req({ status: 'INVITED' }), params())).status).toBe(409)
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('refuses a recurring package with no priced option yet', async () => {
    h.membershipFindFirst.mockResolvedValue({ cadence: 'RECURRING', plans: [] })
    expect((await PATCH(req({ status: 'INVITED' }), params())).status).toBe(409)
  })

  it('only ever looks at a CURRENT plan, never an archived one', async () => {
    await PATCH(req({ status: 'INVITED' }), params())
    expect(h.membershipFindFirst.mock.calls[0][0].select.plans.where).toEqual({ archivedAt: null })
  })

  it('is scoped to the trainer’s own business', async () => {
    await PATCH(req({ status: 'INVITED' }), params())
    // The membership lookup is tenant-scoped, so another trainer's package can
    // never be the subject of an invite.
    expect(h.membershipFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'm1', trainerId: 't1' })
  })

  it('404s another trainer’s request', async () => {
    h.requestFindFirst.mockResolvedValue(null)
    expect((await PATCH(req({ status: 'INVITED' }), params())).status).toBe(404)
  })

  it('refuses a caller without packages.manage', async () => {
    const { NextResponse } = await import('next/server')
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await PATCH(req({ status: 'INVITED' }), params())).status).toBe(403)
    expect(h.requestFindFirst).not.toHaveBeenCalled()
  })

  it('does not invite twice when two tabs are open', async () => {
    h.requestUpdateMany.mockResolvedValue({ count: 0 })
    const res = await PATCH(req({ status: 'INVITED' }), params())
    expect(await res.json()).toMatchObject({ alreadyActioned: true })
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('rejects a status outside the three real answers', async () => {
    expect((await PATCH(req({ status: 'SOMETHING' }), params())).status).toBe(400)
  })

  it('leaves the existing grant-for-free path alone', async () => {
    await PATCH(req({ status: 'FULFILLED' }), params())
    expect(h.fulfilMembershipInTx).toHaveBeenCalled()
  })
})
