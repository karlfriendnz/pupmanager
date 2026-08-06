import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// PATCH /api/membership-requests/[requestId] — the trainer accepting or
// declining a client's "Request this" for a package checkout can't take.
//
// Focus: the packages.manage guard, the cross-tenant guard (one trainer must
// never see OR action another's requests), the promise the feature makes about
// money (accepting grants the package with NO payment attached), and the
// double-accept guard so two open tabs can't grant twice.

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  requestFindFirst: vi.fn(),
  requestUpdate: vi.fn(),
  requestUpdateMany: vi.fn(),
  trainerFindUnique: vi.fn(),
  transaction: vi.fn(),
  fulfilMembershipInTx: vi.fn(),
  enrolMembershipClasses: vi.fn(),
  notifyClient: vi.fn(),
  safeEvaluate: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    membershipRequest: { findFirst: h.requestFindFirst, update: h.requestUpdate, updateMany: h.requestUpdateMany },
    trainerProfile: { findUnique: h.trainerFindUnique },
    $transaction: h.transaction,
  },
}))
vi.mock('@/lib/memberships', () => ({
  fulfilMembershipInTx: h.fulfilMembershipInTx,
  enrolMembershipClasses: h.enrolMembershipClasses,
}))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))

import { PATCH } from '@/app/api/membership-requests/[requestId]/route'

const PARAMS = { params: Promise.resolve({ requestId: 'req-1' }) }
const patch = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/membership-requests/req-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const PENDING = {
  id: 'req-1',
  status: 'PENDING',
  clientId: 'c-1',
  membershipId: 'm-1',
  client: { userId: 'u-1', dog: { name: 'Scout' } },
  membership: { name: 'Juniors' },
}

// The transaction mock just runs the callback with a stub tx client.
const tx = { membershipRequest: { updateMany: h.requestUpdateMany } }

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ companyId: 't-1', role: 'OWNER', permissions: {} })
  h.requestFindFirst.mockResolvedValue(PENDING)
  h.requestUpdateMany.mockResolvedValue({ count: 1 })
  h.trainerFindUnique.mockResolvedValue({ sandboxBilling: false, businessName: 'Happy Paws' })
  h.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx))
  h.fulfilMembershipInTx.mockResolvedValue({ classGrants: [] })
  h.safeEvaluate.mockResolvedValue(undefined)
  h.notifyClient.mockResolvedValue(undefined)
})

describe('PATCH /api/membership-requests/[requestId] — guards', () => {
  it('returns the guard response when packages.manage is denied', async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: 'Nope' }, { status: 403 }))
    const res = await PATCH(patch({ status: 'FULFILLED' }), PARAMS)

    expect(res.status).toBe(403)
    expect(h.requestFindFirst).not.toHaveBeenCalled()
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
  })

  it('404s another trainer’s request, and scopes the lookup on BOTH sides', async () => {
    // findFirst with the tenant scope returns nothing for a foreign row.
    h.requestFindFirst.mockResolvedValue(null)
    const res = await PATCH(patch({ status: 'FULFILLED' }), PARAMS)

    expect(res.status).toBe(404)
    expect(h.requestFindFirst.mock.calls[0][0].where).toEqual({
      id: 'req-1',
      membership: { trainerId: 't-1' },
      client: { trainerId: 't-1' },
    })
    // Nothing was granted and nobody was told.
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
    expect(h.requestUpdate).not.toHaveBeenCalled()
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('400s an unknown status rather than writing it', async () => {
    const res = await PATCH(patch({ status: 'PAID' }), PARAMS)
    expect(res.status).toBe(400)
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/membership-requests/[requestId] — accepting', () => {
  it('grants the package through the SAME path a paid checkout uses', async () => {
    const res = await PATCH(patch({ status: 'FULFILLED' }), PARAMS)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, status: 'FULFILLED' })
    expect(h.fulfilMembershipInTx).toHaveBeenCalledTimes(1)
    const [, args] = h.fulfilMembershipInTx.mock.calls[0]
    expect(args).toMatchObject({ membershipId: 'm-1', trainerId: 't-1', clientId: 'c-1' })
  })

  it('attaches NO payment — accepting must never imply money was taken', async () => {
    await PATCH(patch({ status: 'FULFILLED' }), PARAMS)
    expect(h.fulfilMembershipInTx.mock.calls[0][1].paymentId).toBeNull()
  })

  it('files the purchase in the trainer’s own billing mode', async () => {
    h.trainerFindUnique.mockResolvedValue({ sandboxBilling: true, businessName: 'Happy Paws' })
    await PATCH(patch({ status: 'FULFILLED' }), PARAMS)
    expect(h.fulfilMembershipInTx.mock.calls[0][1].sandbox).toBe(true)
  })

  it('claims the row inside the transaction, so two tabs can’t grant twice', async () => {
    h.requestUpdateMany.mockResolvedValue({ count: 0 }) // someone else got there first
    const res = await PATCH(patch({ status: 'FULFILLED' }), PARAMS)

    expect(res.status).toBe(200)
    expect(h.requestUpdateMany.mock.calls[0][0].where).toEqual({ id: 'req-1', status: 'PENDING' })
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
  })

  it('enrols class places after the commit', async () => {
    h.fulfilMembershipInTx.mockResolvedValue({ classGrants: [{ classRunId: 'run-1' }] })
    await PATCH(patch({ status: 'FULFILLED' }), PARAMS)
    expect(h.enrolMembershipClasses).toHaveBeenCalledWith([{ classRunId: 'run-1' }], 'c-1')
  })

  it('tells the client they were added to the plan — and says nothing about payment', async () => {
    await PATCH(patch({ status: 'FULFILLED' }), PARAMS)

    const args = h.notifyClient.mock.calls[0][0]
    expect(args).toMatchObject({ userId: 'u-1', trainerId: 't-1', type: 'CLIENT_ADDED_TO_PLAN' })
    expect(args.vars).toMatchObject({ trainerName: 'Happy Paws', dogName: 'Scout', planName: 'Juniors' })
    expect(JSON.stringify(args.vars)).not.toMatch(/paid|payment|charged/i)
  })

  it('is a no-op on a request that was already decided', async () => {
    h.requestFindFirst.mockResolvedValue({ ...PENDING, status: 'FULFILLED' })
    const res = await PATCH(patch({ status: 'FULFILLED' }), PARAMS)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ alreadyActioned: true, status: 'FULFILLED' })
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/membership-requests/[requestId] — declining', () => {
  it('closes the row without granting anything or telling the client', async () => {
    const res = await PATCH(patch({ status: 'DECLINED' }), PARAMS)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, status: 'DECLINED' })
    // updateMany with a status guard, not a bare update: a decline racing an
    // accept must settle on one answer rather than stamping DECLINED over a
    // grant that already happened.
    expect(h.requestUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'req-1', status: { in: ['PENDING', 'INVITED'] } },
      data: { status: 'DECLINED', fulfilledAt: null },
    })
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('404s another trainer’s request on decline too', async () => {
    h.requestFindFirst.mockResolvedValue(null)
    const res = await PATCH(patch({ status: 'DECLINED' }), PARAMS)

    expect(res.status).toBe(404)
    expect(h.requestUpdate).not.toHaveBeenCalled()
  })
})
