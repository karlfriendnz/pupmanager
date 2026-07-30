import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant + permission guards on client self-serve cancellation.
//
// The critical assertion in this file is the ORDER of operations: Stripe must
// agree to stop the subscription BEFORE we mark our row cancelled. If we flip
// the row first and the Stripe call fails, we have told a client they are
// cancelled while their card keeps being charged every month — the single worst
// outcome this feature has, and a legal problem rather than just a bug.

const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  requireSameOrigin: vi.fn(),
  enforceRateLimit: vi.fn(),
  purchaseFindFirst: vi.fn(),
  purchaseUpdate: vi.fn(),
  trainerFindUnique: vi.fn(),
  clientFindUnique: vi.fn(),
  cancelAtPeriodEnd: vi.fn(),
  notifyTrainer: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: h.requireSameOrigin }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit }))
vi.mock('@/lib/connect-subscriptions', () => ({ cancelAtPeriodEnd: h.cancelAtPeriodEnd }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    membershipPurchase: { findFirst: h.purchaseFindFirst, update: h.purchaseUpdate },
    trainerProfile: { findUnique: h.trainerFindUnique },
    clientProfile: { findUnique: h.clientFindUnique },
  },
}))

import { POST } from '@/app/api/my/memberships/purchases/[purchaseId]/cancel/route'

function req() {
  return new Request('https://app.pupmanager.com/api/my/memberships/purchases/p1/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.pupmanager.com' },
    body: '{}',
  })
}
const params = (purchaseId = 'p1') => ({ params: Promise.resolve({ purchaseId }) })

const PURCHASE = {
  id: 'p1', trainerId: 't1', clientId: 'c1', status: 'ACTIVE', sandbox: true,
  stripeSubscriptionId: 'sub_1', currentPeriodEnd: new Date('2026-08-14T00:00:00Z'),
  cancelAtPeriodEnd: false, membership: { name: 'Starter' },
}

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.requireSameOrigin.mockReturnValue(null)
  h.enforceRateLimit.mockResolvedValue(null)
  h.getActiveClient.mockResolvedValue({ clientId: 'c1', userId: 'u1', isPreview: false })
  h.purchaseFindFirst.mockResolvedValue(PURCHASE)
  h.trainerFindUnique.mockResolvedValue({ connectAccountId: 'acct_1', user: { id: 'tu1' } })
  h.clientFindUnique.mockResolvedValue({ user: { name: 'Sarah' }, dog: { name: 'Bailey' } })
  h.cancelAtPeriodEnd.mockResolvedValue({ id: 'sub_1' })
  h.purchaseUpdate.mockResolvedValue({ currentPeriodEnd: PURCHASE.currentPeriodEnd })
  h.notifyTrainer.mockResolvedValue(undefined)
})

describe('tenancy', () => {
  it('scopes the lookup to the caller’s own clientId', async () => {
    await POST(req(), params())
    // This where-clause IS the tenancy guard: another client's purchase id
    // simply resolves to nothing.
    expect(h.purchaseFindFirst.mock.calls[0][0].where).toEqual({ id: 'p1', clientId: 'c1' })
  })

  it('404s another client’s subscription and cancels nothing', async () => {
    h.purchaseFindFirst.mockResolvedValue(null)
    const res = await POST(req(), params('someone-elses-purchase'))
    expect(res.status).toBe(404)
    // 404 rather than 403 — a 403 would confirm the subscription exists.
    expect(h.cancelAtPeriodEnd).not.toHaveBeenCalled()
    expect(h.purchaseUpdate).not.toHaveBeenCalled()
  })

  it('401s with no client context', async () => {
    h.getActiveClient.mockResolvedValue(null)
    expect((await POST(req(), params())).status).toBe(401)
    expect(h.cancelAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('403s a trainer in preview mode — they must not cancel a real subscription', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'c1', userId: 'u1', isPreview: true })
    expect((await POST(req(), params())).status).toBe(403)
    expect(h.cancelAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('blocks a cross-site request before doing anything', async () => {
    const { NextResponse } = await import('next/server')
    h.requireSameOrigin.mockReturnValue(NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 }))
    expect((await POST(req(), params())).status).toBe(403)
    expect(h.purchaseFindFirst).not.toHaveBeenCalled()
  })

  it('rate-limits before touching Stripe', async () => {
    h.enforceRateLimit.mockResolvedValue(new Response('slow down', { status: 429 }))
    expect((await POST(req(), params())).status).toBe(429)
    expect(h.cancelAtPeriodEnd).not.toHaveBeenCalled()
  })
})

describe('Stripe is the source of truth', () => {
  it('calls Stripe BEFORE marking our row cancelled', async () => {
    await POST(req(), params())
    expect(h.cancelAtPeriodEnd.mock.invocationCallOrder[0])
      .toBeLessThan(h.purchaseUpdate.mock.invocationCallOrder[0])
  })

  it('leaves the row untouched when Stripe refuses', async () => {
    // Otherwise we tell a client they are cancelled while their card keeps
    // being charged. Never claim a cancellation Stripe did not agree to.
    h.cancelAtPeriodEnd.mockRejectedValue(new Error('stripe down'))
    const res = await POST(req(), params())
    expect(res.status).toBe(502)
    expect(h.purchaseUpdate).not.toHaveBeenCalled()
  })

  it('cancels on the trainer’s connected account, in the right Stripe mode', async () => {
    await POST(req(), params())
    expect(h.cancelAtPeriodEnd.mock.calls[0][0]).toEqual({
      connectAccountId: 'acct_1', sandbox: true, subscriptionId: 'sub_1',
    })
  })
})

describe('what cancelling means', () => {
  it('sets CANCELLING, not CANCELLED — they keep what they paid for', async () => {
    const res = await POST(req(), params())
    expect(res.status).toBe(200)
    expect(h.purchaseUpdate.mock.calls[0][0].data).toMatchObject({
      status: 'CANCELLING', cancelAtPeriodEnd: true, cancelReason: 'CLIENT_SELF_SERVE',
    })
    expect(await res.json()).toMatchObject({ ok: true, alreadyCancelling: false })
  })

  it('returns the date they are covered until, so the screen can state it', async () => {
    const body = await (await POST(req(), params())).json()
    expect(body.endsAt).toBe(PURCHASE.currentPeriodEnd.toISOString())
  })

  it('is idempotent — a second cancel does not call Stripe again', async () => {
    h.purchaseFindFirst.mockResolvedValue({ ...PURCHASE, cancelAtPeriodEnd: true, status: 'CANCELLING' })
    const res = await POST(req(), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ alreadyCancelling: true })
    expect(h.cancelAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('refuses a one-off purchase, which has no subscription to stop', async () => {
    h.purchaseFindFirst.mockResolvedValue({ ...PURCHASE, stripeSubscriptionId: null })
    expect((await POST(req(), params())).status).toBe(409)
    expect(h.cancelAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('tells the trainer — a plan must never vanish without a word', async () => {
    await POST(req(), params())
    expect(h.notifyTrainer).toHaveBeenCalledTimes(1)
    expect(h.notifyTrainer.mock.calls[0][2].detail).toContain('cancelled the ongoing plan')
  })
})
