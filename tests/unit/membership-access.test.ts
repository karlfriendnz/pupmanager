import { describe, it, expect, vi, beforeEach } from 'vitest'

// The one place "what does a lapsed membership lose access to" is decided.
//
// Worth testing exhaustively rather than by example: this rule is exactly the
// kind that gets half-remembered and copied inconsistently across call sites,
// and the failure mode — a client who can log in but whose booking silently
// refuses — is very hard to reproduce from a bug report.

const h = vi.hoisted(() => ({
  pkgUpdateMany: vi.fn(),
  enrolUpdateMany: vi.fn(),
}))

import {
  membershipGrantsAccess,
  accessPausedReason,
  suspendMembershipGrants,
  restoreMembershipGrants,
  LIVE_SUBSCRIPTION_STATUSES,
  NOT_SUSPENDED,
  SESSIONS_NOT_SUSPENDED,
} from '@/lib/membership-access'

const tx = {
  clientPackage: { updateMany: h.pkgUpdateMany },
  classEnrollment: { updateMany: h.enrolUpdateMany },
} as never

beforeEach(() => {
  h.pkgUpdateMany.mockReset().mockResolvedValue({ count: 2 })
  h.enrolUpdateMany.mockReset().mockResolvedValue({ count: 1 })
})

describe('membershipGrantsAccess', () => {
  it('grants access while paid and current', () => {
    expect(membershipGrantsAccess('ACTIVE')).toBe(true)
  })

  it('grants access to someone who cancelled but has paid to the period end', () => {
    // The cancel screen promises "you'll keep your plan until the 14th". This
    // is the code that has to keep that promise.
    expect(membershipGrantsAccess('CANCELLING')).toBe(true)
  })

  it('STOPS access on the first failed payment', () => {
    // Karl, 2026-07-27 — deliberately not the "keep access through the retry
    // window" recommendation that was in the plan.
    expect(membershipGrantsAccess('PAST_DUE')).toBe(false)
  })

  it('stops access for every ended or suspended state', () => {
    expect(membershipGrantsAccess('CANCELLED')).toBe(false)
    expect(membershipGrantsAccess('LAPSED')).toBe(false)
    expect(membershipGrantsAccess('PAUSED')).toBe(false)
    expect(membershipGrantsAccess('ORPHANED')).toBe(false)
  })

  it('denies access for an unrecognised status rather than defaulting open', () => {
    // A status added later must fail CLOSED until someone decides otherwise.
    expect(membershipGrantsAccess('SOMETHING_NEW' as never)).toBe(false)
  })

  it('agrees with LIVE_SUBSCRIPTION_STATUSES about what is still running', () => {
    // A live subscription is not the same as one granting access — PAST_DUE is
    // live (Stripe is still retrying) but grants nothing. Pinned so the two
    // ideas cannot quietly merge.
    expect(LIVE_SUBSCRIPTION_STATUSES).toEqual(['ACTIVE', 'PAST_DUE', 'CANCELLING', 'PAUSED'])
    expect(LIVE_SUBSCRIPTION_STATUSES.filter(membershipGrantsAccess)).toEqual(['ACTIVE', 'CANCELLING'])
  })
})

describe('accessPausedReason', () => {
  it('tells a past-due client what happened and what to do', () => {
    const reason = accessPausedReason('PAST_DUE')
    expect(reason).toContain('didn’t go through')
    expect(reason).toContain('paused')
    expect(reason).toContain('Update your card')
  })

  it('makes clear an orphaned plan was not the client’s doing, and that they are not being charged', () => {
    const reason = accessPausedReason('ORPHANED')
    expect(reason).toContain('trainer has stopped taking payments')
    expect(reason).toContain('haven’t been charged again')
  })

  it('says nothing when they do have access', () => {
    expect(accessPausedReason('ACTIVE')).toBeNull()
    expect(accessPausedReason('CANCELLING')).toBeNull()
  })
})

describe('suspendMembershipGrants', () => {
  it('pauses the plan’s packages and class seats', async () => {
    const now = new Date('2026-07-27T00:00:00Z')
    const res = await suspendMembershipGrants(tx, 'p1', now)

    expect(res).toEqual({ packages: 2, enrolments: 1 })
    expect(h.pkgUpdateMany.mock.calls[0][0]).toEqual({
      where: { membershipPurchaseId: 'p1', suspendedAt: null },
      data: { suspendedAt: now },
    })
  })

  it('never touches a seat the client already gave up themselves', async () => {
    await suspendMembershipGrants(tx, 'p1')
    expect(h.enrolUpdateMany.mock.calls[0][0].where.withdrawnAt).toBeNull()
  })

  it('is idempotent — only ever touches grants that are not already paused', async () => {
    // A redelivered invoice.payment_failed lands here again.
    await suspendMembershipGrants(tx, 'p1')
    expect(h.pkgUpdateMany.mock.calls[0][0].where.suspendedAt).toBeNull()
    expect(h.enrolUpdateMany.mock.calls[0][0].where.suspendedAt).toBeNull()
  })

  it('pauses rather than withdraws, so the class place is still held', async () => {
    // Withdrawing promotes the next person off the waitlist, which cannot be
    // undone — a client whose card is replaced two days later must get their
    // OWN seat back, not find it sold.
    await suspendMembershipGrants(tx, 'p1')
    const data = h.enrolUpdateMany.mock.calls[0][0].data
    expect(data).toEqual({ suspendedAt: expect.any(Date) })
    expect(data.withdrawnAt).toBeUndefined()
    expect(data.status).toBeUndefined()
  })
})

describe('restoreMembershipGrants', () => {
  it('gives back everything this plan granted', async () => {
    const res = await restoreMembershipGrants(tx, 'p1')
    expect(res).toEqual({ packages: 2, enrolments: 1 })
    expect(h.pkgUpdateMany.mock.calls[0][0]).toEqual({
      where: { membershipPurchaseId: 'p1', suspendedAt: { not: null } },
      data: { suspendedAt: null },
    })
  })

  it('clears EVERY paused grant, not just the ones one failure caused', async () => {
    // Restoring selectively is how a half-restored membership happens: an
    // active plan with some things still switched off.
    await restoreMembershipGrants(tx, 'p1')
    for (const call of [h.pkgUpdateMany, h.enrolUpdateMany]) {
      expect(call.mock.calls[0][0].where).not.toHaveProperty('withdrawnAt')
      expect(call.mock.calls[0][0].data).toEqual({ suspendedAt: null })
    }
  })

  it('is the exact mirror of suspending', async () => {
    await suspendMembershipGrants(tx, 'p1')
    await restoreMembershipGrants(tx, 'p1')
    const suspended = h.pkgUpdateMany.mock.calls[0][0]
    const restored = h.pkgUpdateMany.mock.calls[1][0]
    expect(suspended.where.membershipPurchaseId).toBe(restored.where.membershipPurchaseId)
    expect(restored.data.suspendedAt).toBeNull()
  })
})

describe('query filters', () => {
  it('NOT_SUSPENDED matches only unpaused rows', () => {
    expect(NOT_SUSPENDED).toEqual({ suspendedAt: null })
  })

  it('SESSIONS_NOT_SUSPENDED keeps sessions that belong to no package', () => {
    // Most sessions have NO clientPackage — a one-off booking, or one the
    // trainer created. A bare relation filter would silently hide every one of
    // them from the client, which is far worse than the bug it fixes.
    expect(SESSIONS_NOT_SUSPENDED.OR).toContainEqual({ clientPackageId: null })
    expect(SESSIONS_NOT_SUSPENDED.OR).toContainEqual({ clientPackage: { suspendedAt: null } })
  })

  it('SESSIONS_NOT_SUSPENDED is mutable, as Prisma’s WhereInput requires', () => {
    // `as const` here makes the array readonly and Prisma rejects it — caught
    // at compile time once, worth pinning so it does not come back.
    expect(Array.isArray(SESSIONS_NOT_SUSPENDED.OR)).toBe(true)
    expect(() => SESSIONS_NOT_SUSPENDED.OR.slice()).not.toThrow()
  })
})
