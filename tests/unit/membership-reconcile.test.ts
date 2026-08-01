import { describe, it, expect, vi, beforeEach } from 'vitest'

// The nightly Stripe↔DB reconciliation, and the card-expiry maths.
//
// The reconciliation exists for a failure that is silent by construction: a
// client cancels, is told they cancelled, and keeps being charged because the
// Stripe call failed and nothing errored. So the tests that matter are the ones
// about DISAGREEMENT — and about what happens when Stripe simply doesn't answer,
// which must never be mistaken for "everyone cancelled".

const h = vi.hoisted(() => ({
  trainerFindUnique: vi.fn(),
  purchaseFindMany: vi.fn(),
  purchaseUpdate: vi.fn(),
  subRetrieve: vi.fn(),
  isStripeConfigured: vi.fn(),
  suspendGrants: vi.fn(),
  restoreGrants: vi.fn(),
  purchaseUpdateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerFindUnique },
    membershipPurchase: { findMany: h.purchaseFindMany },
    $transaction: (fn: (t: unknown) => unknown) =>
      fn({ membershipPurchase: { update: h.purchaseUpdate, updateMany: h.purchaseUpdateMany } }),
  },
}))
vi.mock('@/lib/stripe', () => ({
  stripeFor: vi.fn(() => ({ subscriptions: { retrieve: h.subRetrieve } })),
  isStripeConfigured: h.isStripeConfigured,
}))
vi.mock('@/lib/membership-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/membership-access')>()),
  suspendMembershipGrants: h.suspendGrants,
  restoreMembershipGrants: h.restoreGrants,
}))

import { reconcileTrainerSubscriptions, sweepExpiredGrace } from '@/lib/membership-reconcile'
import { cardExpiresBefore } from '@/lib/membership-billing'

function stripeSub(over: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    items: { data: [{ current_period_start: 1_760_000_000, current_period_end: 1_762_592_000 }] },
    ...over,
  }
}

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.isStripeConfigured.mockReturnValue(true)
  h.trainerFindUnique.mockResolvedValue({ connectAccountId: 'acct_1', sandboxBilling: true })
  h.purchaseUpdate.mockResolvedValue({})
  h.suspendGrants.mockResolvedValue({ packages: 0, enrolments: 0 })
  h.restoreGrants.mockResolvedValue({ packages: 0, enrolments: 0 })
})

describe('reconcileTrainerSubscriptions', () => {
  it('leaves an agreeing subscription completely alone', async () => {
    h.purchaseFindMany.mockResolvedValue([{ id: 'p1', status: 'ACTIVE', stripeSubscriptionId: 'sub_1', cancelAtPeriodEnd: false }])
    h.subRetrieve.mockResolvedValue(stripeSub())

    const res = await reconcileTrainerSubscriptions('t1')

    expect(res).toMatchObject({ checked: 1, corrected: 0, unreachable: 0 })
    expect(h.purchaseUpdate).not.toHaveBeenCalled()
  })

  it('catches the dangerous case — we say cancelled, Stripe is still billing', async () => {
    // Our row said CANCELLING; Stripe never got the message and the
    // subscription is plain active. The client is being charged for something
    // we told them had stopped.
    h.purchaseFindMany.mockResolvedValue([{ id: 'p1', status: 'CANCELLING', stripeSubscriptionId: 'sub_1', cancelAtPeriodEnd: true }])
    h.subRetrieve.mockResolvedValue(stripeSub({ status: 'active', cancel_at_period_end: false }))

    const res = await reconcileTrainerSubscriptions('t1')

    expect(res.corrected).toBe(1)
    expect(res.details).toEqual([{ purchaseId: 'p1', was: 'CANCELLING', now: 'ACTIVE' }])
    expect(h.purchaseUpdate.mock.calls[0][0].data).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: false })
  })

  it('catches the mirror — Stripe cancelled it and we still show it live', async () => {
    h.purchaseFindMany.mockResolvedValue([{ id: 'p1', status: 'ACTIVE', stripeSubscriptionId: 'sub_1', cancelAtPeriodEnd: false }])
    h.subRetrieve.mockResolvedValue(stripeSub({ status: 'canceled' }))

    const res = await reconcileTrainerSubscriptions('t1')

    expect(res.corrected).toBe(1)
    expect(h.purchaseUpdate.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED' })
    expect(h.purchaseUpdate.mock.calls[0][0].data.cancelledAt).toBeInstanceOf(Date)
  })

  it('puts the GRANTS back in step, not just the status', async () => {
    // A status that drifted has almost certainly left the grants drifted too.
    // Fixing one without the other is how a half-revoked membership sticks.
    h.purchaseFindMany.mockResolvedValue([{ id: 'p1', status: 'ACTIVE', stripeSubscriptionId: 'sub_1', cancelAtPeriodEnd: false }])
    h.subRetrieve.mockResolvedValue(stripeSub({ status: 'past_due' }))

    await reconcileTrainerSubscriptions('t1')

    expect(h.suspendGrants).toHaveBeenCalledWith(expect.anything(), 'p1')
  })

  it('restores grants when Stripe says a drifted subscription is healthy', async () => {
    h.purchaseFindMany.mockResolvedValue([{ id: 'p1', status: 'PAST_DUE', stripeSubscriptionId: 'sub_1', cancelAtPeriodEnd: false }])
    h.subRetrieve.mockResolvedValue(stripeSub({ status: 'active' }))

    await reconcileTrainerSubscriptions('t1')

    expect(h.restoreGrants).toHaveBeenCalledWith(expect.anything(), 'p1')
    expect(h.suspendGrants).not.toHaveBeenCalled()
  })

  it('does NOT cancel anything when Stripe is unreachable', async () => {
    // The single most dangerous thing this job could do is mistake a Stripe
    // outage for everybody cancelling. It counts and logs instead.
    h.purchaseFindMany.mockResolvedValue([{ id: 'p1', status: 'ACTIVE', stripeSubscriptionId: 'sub_1', cancelAtPeriodEnd: false }])
    h.subRetrieve.mockRejectedValue(new Error('stripe unavailable'))

    const res = await reconcileTrainerSubscriptions('t1')

    expect(res).toMatchObject({ checked: 1, corrected: 0, unreachable: 1 })
    expect(h.purchaseUpdate).not.toHaveBeenCalled()
    expect(h.suspendGrants).not.toHaveBeenCalled()
  })

  it('notices a cancel_at_period_end that only exists on one side', async () => {
    h.purchaseFindMany.mockResolvedValue([{ id: 'p1', status: 'ACTIVE', stripeSubscriptionId: 'sub_1', cancelAtPeriodEnd: false }])
    h.subRetrieve.mockResolvedValue(stripeSub({ status: 'active', cancel_at_period_end: true }))

    const res = await reconcileTrainerSubscriptions('t1')

    expect(res.corrected).toBe(1)
    expect(h.purchaseUpdate.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLING', cancelAtPeriodEnd: true })
  })

  it('reads subscriptions from the trainer’s CONNECTED account', async () => {
    h.purchaseFindMany.mockResolvedValue([{ id: 'p1', status: 'ACTIVE', stripeSubscriptionId: 'sub_1', cancelAtPeriodEnd: false }])
    h.subRetrieve.mockResolvedValue(stripeSub())

    await reconcileTrainerSubscriptions('t1')

    expect(h.subRetrieve.mock.calls[0][2]).toEqual({ stripeAccount: 'acct_1' })
  })

  it('does nothing for a trainer with no connected account', async () => {
    h.trainerFindUnique.mockResolvedValue({ connectAccountId: null, sandboxBilling: false })
    const res = await reconcileTrainerSubscriptions('t1')
    expect(res.checked).toBe(0)
    expect(h.purchaseFindMany).not.toHaveBeenCalled()
  })

  it('only ever looks at subscriptions we believe are live', async () => {
    h.purchaseFindMany.mockResolvedValue([])
    await reconcileTrainerSubscriptions('t1')
    expect(h.purchaseFindMany.mock.calls[0][0].where).toMatchObject({
      trainerId: 't1',
      status: { in: ['ACTIVE', 'PAST_DUE', 'CANCELLING', 'PAUSED'] },
      stripeSubscriptionId: { not: null },
    })
  })
})

describe('cardExpiresBefore', () => {
  it('treats a card as alive to the END of its stated month', () => {
    // A 07/2026 card works all through July and dies on 1 August.
    const card = { cardExpMonth: 7, cardExpYear: 2026 }
    expect(cardExpiresBefore(card, new Date('2026-07-31T23:00:00Z'))).toBe(false)
    expect(cardExpiresBefore(card, new Date('2026-08-01T00:00:00Z'))).toBe(true)
  })

  it('spots a card that dies before next month’s charge', () => {
    expect(cardExpiresBefore({ cardExpMonth: 7, cardExpYear: 2026 }, new Date('2026-09-14T00:00:00Z'))).toBe(true)
  })

  it('handles a December expiry rolling into the next year', () => {
    const card = { cardExpMonth: 12, cardExpYear: 2026 }
    expect(cardExpiresBefore(card, new Date('2026-12-20T00:00:00Z'))).toBe(false)
    expect(cardExpiresBefore(card, new Date('2027-01-02T00:00:00Z'))).toBe(true)
  })

  it('never warns when we have no card on file', () => {
    // Better silent than crying wolf about a card we know nothing about.
    expect(cardExpiresBefore({ cardExpMonth: null, cardExpYear: null }, new Date())).toBe(false)
    expect(cardExpiresBefore({ cardExpMonth: 7, cardExpYear: null }, new Date())).toBe(false)
  })
})


// The other half of the two-week rule. A failed payment no longer stops access
// on the spot, so SOMETHING has to stop it when the window really expires —
// Stripe sends no event on a deadline we invented, so this sweeps it nightly.
describe('sweepExpiredGrace', () => {
  beforeEach(() => {
    h.purchaseFindMany.mockReset()
    h.suspendGrants.mockReset().mockResolvedValue({ packages: 1, enrolments: 1 })
    h.purchaseUpdateMany.mockReset().mockResolvedValue({ count: 1 })
  })

  it('pauses a plan whose fortnight ran out without a payment', async () => {
    h.purchaseFindMany.mockResolvedValue([{ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' }])

    const res = await sweepExpiredGrace(new Date('2026-08-20T00:00:00Z'))

    expect(res.paused).toBe(1)
    expect(h.suspendGrants).toHaveBeenCalledWith(expect.anything(), 'p1', expect.any(Date))
    expect(h.purchaseUpdateMany.mock.calls[0][0].data.accessPausedAt).toBeInstanceOf(Date)
  })

  it('only ever looks at PAST_DUE rows whose window has actually elapsed', async () => {
    h.purchaseFindMany.mockResolvedValue([])
    const now = new Date('2026-08-20T00:00:00Z')

    await sweepExpiredGrace(now)

    // The query is the guard. Anything looser and it would pause people who
    // are still inside their fortnight, or who have already paid.
    expect(h.purchaseFindMany.mock.calls[0][0].where).toEqual({
      status: 'PAST_DUE',
      accessGraceUntil: { not: null, lte: now },
      accessPausedAt: null,
    })
  })

  it('re-checks inside the transaction, so a payment that lands mid-sweep wins', async () => {
    h.purchaseFindMany.mockResolvedValue([{ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' }])

    await sweepExpiredGrace(new Date('2026-08-20T00:00:00Z'))

    // Without this the sweep would pause someone whose card cleared in the
    // seconds between the read and the write.
    expect(h.purchaseUpdateMany.mock.calls[0][0].where).toMatchObject({
      id: 'p1', status: 'PAST_DUE', accessPausedAt: null,
    })
  })

  it('does nothing at all when nobody is out of time', async () => {
    h.purchaseFindMany.mockResolvedValue([])
    const res = await sweepExpiredGrace()
    expect(res.paused).toBe(0)
    expect(h.suspendGrants).not.toHaveBeenCalled()
  })

  it('carries on when one client fails, so one bad row cannot save everyone else', async () => {
    h.purchaseFindMany.mockResolvedValue([
      { id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' },
      { id: 'p2', trainerId: 't1', clientId: 'c2', membershipId: 'm1' },
    ])
    h.suspendGrants.mockRejectedValueOnce(new Error('db blew up'))

    const res = await sweepExpiredGrace(new Date('2026-08-20T00:00:00Z'))

    expect(res.paused).toBe(2)
    expect(h.suspendGrants).toHaveBeenCalledTimes(2)
  })
})
