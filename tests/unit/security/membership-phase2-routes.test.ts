import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant + permission guards on the Phase 2 routes: the client's update-card
// flow and the trainer's cancel-a-client's-subscription action.
//
// Both move money or take it away, and both take an id from the URL, so the
// question that matters in each case is the same: can it be pointed at somebody
// else's subscription?

const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  guardPermission: vi.fn(),
  requireSameOrigin: vi.fn(),
  enforceRateLimit: vi.fn(),
  purchaseFindFirst: vi.fn(),
  purchaseUpdate: vi.fn(),
  trainerFindUnique: vi.fn(),
  clientFindUnique: vi.fn(),
  isConnectConfigured: vi.fn(),
  createCardUpdateSession: vi.fn(),
  cancelAtPeriodEnd: vi.fn(),
  cancelSubscriptionNow: vi.fn(),
  suspendGrants: vi.fn(),
  notifyClient: vi.fn(),
  env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com' },
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: h.requireSameOrigin }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit }))
vi.mock('@/lib/connect', () => ({ isConnectConfigured: h.isConnectConfigured }))
vi.mock('@/lib/connect-subscriptions', () => ({
  createCardUpdateSession: h.createCardUpdateSession,
  cancelAtPeriodEnd: h.cancelAtPeriodEnd,
  cancelSubscriptionNow: h.cancelSubscriptionNow,
}))
vi.mock('@/lib/membership-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/membership-access')>()),
  suspendMembershipGrants: h.suspendGrants,
}))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/env', () => ({ env: h.env }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    membershipPurchase: { findFirst: h.purchaseFindFirst, update: h.purchaseUpdate },
    trainerProfile: { findUnique: h.trainerFindUnique },
    clientProfile: { findUnique: h.clientFindUnique },
    $transaction: (fn: (t: unknown) => unknown) =>
      fn({ membershipPurchase: { update: h.purchaseUpdate } }),
  },
}))

import { POST as updateCard } from '@/app/api/my/memberships/purchases/[purchaseId]/update-card/route'
import { POST as trainerCancel } from '@/app/api/trainer/memberships/subscriptions/[purchaseId]/cancel/route'

function req(body: unknown = {}) {
  return new Request('https://app.pupmanager.com/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.pupmanager.com' },
    body: JSON.stringify(body),
  })
}
const params = (purchaseId = 'p1') => ({ params: Promise.resolve({ purchaseId }) })

const LIVE = {
  id: 'p1', trainerId: 't1', clientId: 'c1', status: 'PAST_DUE', sandbox: true,
  stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1',
  currentPeriodEnd: new Date('2026-08-14T00:00:00Z'), cancelAtPeriodEnd: false,
  membership: { name: 'Starter' },
}

beforeEach(() => {
  for (const fn of Object.values(h)) if (typeof fn === 'function') (fn as ReturnType<typeof vi.fn>).mockReset()
  h.requireSameOrigin.mockReturnValue(null)
  h.enforceRateLimit.mockResolvedValue(null)
  h.isConnectConfigured.mockReturnValue(true)
  h.getActiveClient.mockResolvedValue({ clientId: 'c1', userId: 'u1', isPreview: false })
  h.guardPermission.mockResolvedValue({ companyId: 't1', userId: 'tu1', role: 'OWNER' })
  h.purchaseFindFirst.mockResolvedValue(LIVE)
  h.trainerFindUnique.mockResolvedValue({ connectAccountId: 'acct_1', businessName: 'E2E Dog School', user: { id: 'tu1' } })
  h.clientFindUnique.mockResolvedValue({ user: { id: 'cu1', name: 'Sarah' }, dog: { name: 'Bailey' } })
  h.createCardUpdateSession.mockResolvedValue({ id: 'cs_1', url: 'https://stripe/setup' })
  h.cancelAtPeriodEnd.mockResolvedValue({})
  h.cancelSubscriptionNow.mockResolvedValue({})
  h.purchaseUpdate.mockResolvedValue({ currentPeriodEnd: LIVE.currentPeriodEnd })
  h.notifyClient.mockResolvedValue(undefined)
})

describe('client update-card', () => {
  it('scopes the lookup to the caller’s own clientId', async () => {
    await updateCard(req(), params())
    expect(h.purchaseFindFirst.mock.calls[0][0].where).toEqual({ id: 'p1', clientId: 'c1' })
  })

  it('404s another client’s subscription and starts nothing', async () => {
    h.purchaseFindFirst.mockResolvedValue(null)
    const res = await updateCard(req(), params('someone-elses'))
    expect(res.status).toBe(404)
    expect(h.createCardUpdateSession).not.toHaveBeenCalled()
  })

  it('401s with no client context, 403s in trainer preview', async () => {
    h.getActiveClient.mockResolvedValue(null)
    expect((await updateCard(req(), params())).status).toBe(401)

    h.getActiveClient.mockResolvedValue({ clientId: 'c1', userId: 'u1', isPreview: true })
    expect((await updateCard(req(), params())).status).toBe(403)
    expect(h.createCardUpdateSession).not.toHaveBeenCalled()
  })

  it('blocks a cross-site request before doing anything', async () => {
    const { NextResponse } = await import('next/server')
    h.requireSameOrigin.mockReturnValue(NextResponse.json({ error: 'blocked' }, { status: 403 }))
    expect((await updateCard(req(), params())).status).toBe(403)
    expect(h.purchaseFindFirst).not.toHaveBeenCalled()
  })

  it('refuses on a plan that has ended — nothing left to charge', async () => {
    for (const status of ['CANCELLED', 'LAPSED', 'ORPHANED']) {
      h.purchaseFindFirst.mockResolvedValue({ ...LIVE, status })
      const res = await updateCard(req(), params())
      expect(res.status).toBe(409)
    }
    expect(h.createCardUpdateSession).not.toHaveBeenCalled()
  })

  it('refuses a one-off purchase, which has no card on file', async () => {
    h.purchaseFindFirst.mockResolvedValue({ ...LIVE, stripeSubscriptionId: null, stripeCustomerId: null })
    expect((await updateCard(req(), params())).status).toBe(409)
  })

  it('sets up the card on the trainer’s connected account, carrying the purchase id', async () => {
    const res = await updateCard(req(), params())
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ ok: true, url: 'https://stripe/setup' })

    const args = h.createCardUpdateSession.mock.calls[0][0]
    expect(args).toMatchObject({ connectAccountId: 'acct_1', sandbox: true, customerId: 'cus_1' })
    // The webhook resolves the purchase from this, then re-verifies the account
    // and Stripe mode before touching anything.
    expect(args.metadata).toEqual({ membershipPurchaseId: 'p1' })
  })
})

describe('trainer cancels a client’s subscription', () => {
  it('scopes the lookup to the caller’s own business', async () => {
    await trainerCancel(req(), params())
    expect(h.purchaseFindFirst.mock.calls[0][0].where).toEqual({ id: 'p1', trainerId: 't1' })
  })

  it('404s another trainer’s subscription and cancels nothing', async () => {
    h.purchaseFindFirst.mockResolvedValue(null)
    const res = await trainerCancel(req(), params('another-businesses'))
    expect(res.status).toBe(404)
    expect(h.cancelAtPeriodEnd).not.toHaveBeenCalled()
    expect(h.cancelSubscriptionNow).not.toHaveBeenCalled()
  })

  it('refuses a caller without packages.manage', async () => {
    const { NextResponse } = await import('next/server')
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await trainerCancel(req(), params())).status).toBe(403)
    expect(h.purchaseFindFirst).not.toHaveBeenCalled()
  })

  it('defaults to period-end — the client keeps what they paid for', async () => {
    const res = await trainerCancel(req({}), params())
    expect(res.status).toBe(200)
    expect(h.cancelAtPeriodEnd).toHaveBeenCalled()
    expect(h.cancelSubscriptionNow).not.toHaveBeenCalled()
    expect(h.purchaseUpdate.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLING', cancelAtPeriodEnd: true })
    // Their benefits are deliberately NOT paused — they keep them until the date.
    expect(h.suspendGrants).not.toHaveBeenCalled()
  })

  it('cancels immediately and pauses the benefits when asked to', async () => {
    const res = await trainerCancel(req({ mode: 'now' }), params())
    expect(res.status).toBe(200)
    expect(h.cancelSubscriptionNow).toHaveBeenCalled()
    expect(h.purchaseUpdate.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED' })
    expect(h.suspendGrants).toHaveBeenCalledWith(expect.anything(), 'p1')
  })

  it('calls Stripe BEFORE marking our row, and leaves it alone if Stripe refuses', async () => {
    h.cancelAtPeriodEnd.mockRejectedValue(new Error('stripe down'))
    const res = await trainerCancel(req(), params())
    expect(res.status).toBe(502)
    expect(h.purchaseUpdate).not.toHaveBeenCalled()
  })

  it('always tells the client — a plan must never vanish without a word', async () => {
    await trainerCancel(req(), params())
    expect(h.notifyClient).toHaveBeenCalledTimes(1)
    expect(h.notifyClient.mock.calls[0][0].vars.detail).toContain('won’t renew')
  })

  it('says the plan has STOPPED, not that it won’t renew, on an immediate cancel', async () => {
    await trainerCancel(req({ mode: 'now' }), params())
    expect(h.notifyClient.mock.calls[0][0].vars.detail).toContain('stopped')
  })

  it('is idempotent on an already-ended plan', async () => {
    h.purchaseFindFirst.mockResolvedValue({ ...LIVE, status: 'CANCELLED' })
    const res = await trainerCancel(req(), params())
    expect(await res.json()).toMatchObject({ alreadyEnded: true })
    expect(h.cancelAtPeriodEnd).not.toHaveBeenCalled()
  })
})
