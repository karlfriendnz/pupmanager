import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── "Who turned this on, and when?" ─────────────────────────────────────────
//
// Karl: "can you please also add some logging so we can see who and when people
// turn this on and off - including if you do it".
//
// Before this, an add-on going off left no trace of who or why: the TrainerAddon
// row said `active=false, updatedAt=30 July` and nothing else, so a customer's
// own decision, an admin's action and a silent billing failure were
// indistinguishable. That is exactly why nobody could answer "why is Mersea
// Mutts' achievements off?" this morning.
//
// The trail is the existing append-only AuditLog: BILLING_CHANGED +
// targetType 'addon'. This suite pins what goes into it — including that a
// FAILED attempt is recorded, which is the evidence that was missing.
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  upsert: vi.fn(),
  findUnique: vi.fn(),
  billingItemUpsert: vi.fn(),
  billingItemFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  userFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  isStripeConfigured: vi.fn(),
  stripeFor: vi.fn(),
  resolvePriceId: vi.fn(),
  loadPriceIndex: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerAddon: { upsert: h.upsert },
    trainerProfile: { findUnique: h.findUnique },
    billingItem: { upsert: h.billingItemUpsert, findUnique: h.billingItemFindUnique },
    auditLog: { create: h.auditCreate, findMany: h.auditFindMany },
    user: { findMany: h.userFindMany },
  },
}))
vi.mock('@/lib/stripe', () => ({ stripeFor: h.stripeFor, isStripeConfigured: h.isStripeConfigured }))
vi.mock('@/lib/billing', () => ({ resolvePriceId: h.resolvePriceId, loadPriceIndex: h.loadPriceIndex }))

import { POST } from '@/app/api/addons/route'
import { listAddonChanges } from '@/lib/addon-change'

const DEAD_SUB = 'sub_1Twz2yP6hzHIfGfrxlYFHCdS'
const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/addons', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'Safari/iPhone' },
    body: JSON.stringify(body),
  })

/** The single audit row written by the last call. */
const entry = () => h.auditCreate.mock.calls[0][0].data

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  h.getTrainerContext.mockResolvedValue({ userId: 'u_jess', companyId: 'co_1', role: 'OWNER', permissions: null })
  h.upsert.mockResolvedValue({})
  h.billingItemUpsert.mockResolvedValue({})
  h.auditCreate.mockResolvedValue({})
  h.isStripeConfigured.mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('an add-on change is recorded — who, when, how, and what happened', () => {
  it('records a trainer switching a free add-on on', async () => {
    const res = await POST(req({ itemId: 'timesheets', active: true }))
    expect(res.status).toBe(200)

    expect(h.auditCreate).toHaveBeenCalledTimes(1)
    expect(entry()).toMatchObject({
      action: 'BILLING_CHANGED',
      companyId: 'co_1',
      // WHO: the person who tapped it, not the business — on a team account the
      // owner is often not the one who did this.
      actorUserId: 'u_jess',
      targetType: 'addon',
      targetId: 'timesheets',
    })
    expect(entry().meta).toMatchObject({ addon: 'timesheets', active: true, via: 'trainer', outcome: 'applied' })
  })

  it('records it going off, distinctly from it going on', async () => {
    await POST(req({ itemId: 'timesheets', active: false }))
    expect(entry().meta).toMatchObject({ active: false, outcome: 'applied' })
  })

  it('keeps the request fingerprint, so a disputed change has an IP behind it', async () => {
    await POST(req({ itemId: 'timesheets', active: true }))
    expect(entry()).toMatchObject({ ip: '203.0.113.9', userAgent: 'Safari/iPhone' })
  })

  it('records a FAILED attempt — the evidence nobody had today', async () => {
    h.findUnique.mockResolvedValue({ stripeSubscriptionId: DEAD_SUB, sandboxBilling: false, trialEndsAt: null })
    h.stripeFor.mockReturnValue({ subscriptions: { retrieve: h.retrieve, update: h.update } })
    h.retrieve.mockRejectedValue(
      Object.assign(new Error(`No such subscription: '${DEAD_SUB}'`), {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
      }),
    )

    const res = await POST(req({ itemId: 'achievements', active: true }))
    expect(res.status).toBe(409)

    expect(h.auditCreate).toHaveBeenCalledTimes(1)
    expect(entry().meta).toMatchObject({
      addon: 'achievements',
      active: true,
      via: 'trainer',
      outcome: 'failed',
      reason: 'subscription_missing',
    })
    // The Stripe sentence is kept, so the trail says WHY without a log dive.
    expect(String((entry().meta as { detail: string }).detail)).toContain('resource_missing')
  })

  it('records nothing for a typo — no real add-on was ever touched', async () => {
    await POST(req({ itemId: 'not-a-real-addon', active: true }))
    expect(h.auditCreate).not.toHaveBeenCalled()
  })

  it('a broken audit write can never break the change it is logging', async () => {
    h.auditCreate.mockRejectedValue(new Error('audit table is on fire'))
    const res = await POST(req({ itemId: 'timesheets', active: true }))
    expect(res.status).toBe(200)
    expect(h.upsert).toHaveBeenCalled()
  })
})

describe('listAddonChanges — reading the trail back', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    createdAt: new Date('2026-08-02T10:19:00Z'),
    actorUserId: 'u_jess',
    targetId: 'achievements',
    meta: { addon: 'achievements', active: true, via: 'trainer', outcome: 'applied' },
    ...over,
  })

  beforeEach(() => {
    h.userFindMany.mockResolvedValue([{ id: 'u_jess', name: 'Jess Carter', email: 'jess@example.com', role: 'TRAINER' }])
  })

  it('asks only for this business’s add-on rows, newest first', async () => {
    h.auditFindMany.mockResolvedValue([])
    await listAddonChanges('co_1')

    expect(h.auditFindMany.mock.calls[0][0]).toMatchObject({
      where: { companyId: 'co_1', action: 'BILLING_CHANGED', targetType: 'addon' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('names the person and the add-on', async () => {
    h.auditFindMany.mockResolvedValue([row()])
    const [e] = await listAddonChanges('co_1')
    expect(e).toMatchObject({ addonName: 'Client achievements', active: true, outcome: 'applied', actorLabel: 'Jess Carter' })
  })

  it('marks an admin acting on the business’s behalf as ours', async () => {
    h.auditFindMany.mockResolvedValue([row({ meta: { ...row().meta, via: 'admin' } })])
    const [e] = await listAddonChanges('co_1')
    expect(e.actorLabel).toBe('Jess Carter (PupManager)')
  })

  it('names the webhook when nobody did it — the silent case', async () => {
    h.userFindMany.mockResolvedValue([])
    h.auditFindMany.mockResolvedValue([
      row({ actorUserId: null, targetId: 'shop', meta: { addon: 'shop', active: false, via: 'system', outcome: 'applied', reason: 'webhook_sweep' } }),
    ])
    const [e] = await listAddonChanges('co_1')
    expect(e).toMatchObject({ actorLabel: 'Stripe webhook', active: false, reason: 'webhook_sweep', addonName: 'Client shop' })
  })

  it('still reads an entry for an add-on that has since left the catalog', async () => {
    h.auditFindMany.mockResolvedValue([row({ targetId: 'retired-thing', meta: { addon: 'retired-thing', active: false, via: 'trainer', outcome: 'applied' } })])
    const [e] = await listAddonChanges('co_1')
    expect(e.addonName).toBe('retired-thing')
  })
})
