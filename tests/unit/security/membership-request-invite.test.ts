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

/**
 * A trainer who can genuinely take a recurring card payment.
 *
 * ALL FOUR flags, because the route gates on the real capability rather than
 * the recurringPaymentsEnabled allowlist alone — see canChargeRecurring.
 */
const CAN_CHARGE = {
  acceptPaymentsEnabled: true,
  connectChargesEnabled: true,
  connectAccountId: 'acct_1',
  recurringPaymentsEnabled: true,
}

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.guardPermission.mockResolvedValue({ companyId: 't1', userId: 'tu1', role: 'OWNER' })
  h.trainerRequestScope.mockReturnValue({ membership: { trainerId: 't1' } })
  h.requestFindFirst.mockResolvedValue(REQUEST)
  h.requestUpdateMany.mockResolvedValue({ count: 1 })
  h.trainerFindUnique.mockResolvedValue({ ...CAN_CHARGE, businessName: 'E2E Dog School', sandboxBilling: true })
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

  it('deep-links the client to the package, not to a list they must search', async () => {
    await PATCH(req({ status: 'INVITED' }), params())
    const notice = h.notifyClient.mock.calls[0][0]
    expect(notice.link).toBe('/my-memberships?plan=m1')
    expect(notice.vars.detail).toContain('subscribe')
  })

  it('sends them to OUR subscribe flow, never a Stripe URL minted for them', async () => {
    await PATCH(req({ status: 'INVITED' }), params())
    // The consent row is the client's recorded agreement to a repeating charge,
    // and only they can give it. A checkout session created on their behalf
    // would also be a live payment page sitting in an inbox as a bearer token.
    expect(h.notifyClient.mock.calls[0][0].link).not.toMatch(/stripe|checkout\.session|cs_/i)
  })

  // AGENTS.md #6. recurringPaymentsEnabled is the allowlist; it says nothing
  // about whether Stripe will accept a charge. Each flag below, missing on its
  // own, makes the buy route 409 — so each on its own must block the invite,
  // or the client taps through to a dead end neither party can fix.
  for (const missing of ['acceptPaymentsEnabled', 'connectChargesEnabled', 'connectAccountId', 'recurringPaymentsEnabled'] as const) {
    it(`refuses to invite when the trainer has no ${missing}`, async () => {
      h.trainerFindUnique.mockResolvedValue({
        ...CAN_CHARGE,
        businessName: 'X',
        [missing]: missing === 'connectAccountId' ? null : false,
      })
      const res = await PATCH(req({ status: 'INVITED' }), params())
      expect(res.status).toBe(409)
      expect(h.requestUpdateMany).not.toHaveBeenCalled()
      expect(h.notifyClient).not.toHaveBeenCalled()
      // Nothing was granted on the way out either.
      expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
    })
  }

  it('names Stripe when Stripe is the thing that’s missing', async () => {
    h.trainerFindUnique.mockResolvedValue({ ...CAN_CHARGE, businessName: 'X', connectAccountId: null })
    const body = await (await PATCH(req({ status: 'INVITED' }), params())).json()
    expect(body.error).toMatch(/stripe/i)
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

  it('only ever looks at a CURRENT, PRICED plan', async () => {
    await PATCH(req({ status: 'INVITED' }), params())
    // Archived plans keep billing existing subscribers but can never start a
    // new subscription, and the buy route refuses a zero price outright with
    // "This package has no price set" — either would be a link that fails.
    expect(h.membershipFindFirst.mock.calls[0][0].select.plans.where)
      .toEqual({ archivedAt: null, priceCents: { gt: 0 } })
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
    // Trainers who invoice separately must keep behaving exactly as before —
    // this is still a real choice, not a legacy path being phased out.
    await PATCH(req({ status: 'FULFILLED' }), params())
    expect(h.fulfilMembershipInTx).toHaveBeenCalled()
    // And it grants WITHOUT a payment, which is the honest record of what
    // happened: the trainer is collecting the money themselves.
    expect(h.fulfilMembershipInTx.mock.calls[0][1]).toMatchObject({ paymentId: null })
  })

  it('never grants on the paid route — the webhook does that when they pay', async () => {
    await PATCH(req({ status: 'INVITED' }), params())
    // The shape that gives plans away is granting now and charging later.
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
    expect(h.enrolMembershipClasses).not.toHaveBeenCalled()
  })
})

// Withdrawing is safe precisely BECAUSE inviting granted nothing: there is no
// purchase to unwind, no package to take back and no Stripe object that would
// charge later. AGENTS.md #4 — undoing must undo all of it — is satisfied here
// by there having been nothing to undo.
describe('withdrawing an invitation', () => {
  beforeEach(() => {
    h.requestFindFirst.mockResolvedValue({ ...REQUEST, status: 'INVITED' })
  })

  it('closes an INVITED row when the trainer declines it', async () => {
    const res = await PATCH(req({ status: 'DECLINED' }), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, status: 'DECLINED' })
    expect(h.requestUpdateMany.mock.calls[0][0].data).toMatchObject({ status: 'DECLINED' })
  })

  it('leaves nothing behind — nothing granted, nothing enrolled, nobody told', async () => {
    await PATCH(req({ status: 'DECLINED' }), params())
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
    expect(h.enrolMembershipClasses).not.toHaveBeenCalled()
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('will not re-accept an invitation as a free grant', async () => {
    // The trainer already chose "make them pay". Letting Accept through here
    // would hand over the very plan they asked to be paid for.
    const res = await PATCH(req({ status: 'FULFILLED' }), params())
    expect(await res.json()).toMatchObject({ alreadyActioned: true, status: 'INVITED' })
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
  })

  it('settles on one answer when two tabs decline at once', async () => {
    h.requestUpdateMany.mockResolvedValue({ count: 0 })
    expect(await (await PATCH(req({ status: 'DECLINED' }), params())).json())
      .toMatchObject({ alreadyActioned: true })
  })

  it('cannot re-open a request that was already declined', async () => {
    h.requestFindFirst.mockResolvedValue({ ...REQUEST, status: 'DECLINED' })
    const res = await PATCH(req({ status: 'INVITED' }), params())
    expect(await res.json()).toMatchObject({ alreadyActioned: true })
    expect(h.notifyClient).not.toHaveBeenCalled()
  })
})
