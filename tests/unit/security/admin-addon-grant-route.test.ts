import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/admin/trainers/[id]/addons — admin comps an add-on for free with an
// optional expiry. Security + correctness: ADMIN-only, never touches Stripe,
// never clobbers a paid subscription line, and stamps grantedByAdmin so the
// webhook reconciliation sweep can't deactivate it.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  profileFindUnique: vi.fn(),
  addonFindUnique: vi.fn(),
  addonUpsert: vi.fn(),
  billingItemUpsert: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.profileFindUnique },
    trainerAddon: { findUnique: h.addonFindUnique, upsert: h.addonUpsert },
    billingItem: { upsert: h.billingItemUpsert },
  },
}))

import { POST } from '@/app/api/admin/trainers/[trainerId]/addons/route'

const params = (trainerId = 'user_1') => ({ params: Promise.resolve({ trainerId }) })
const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/admin/trainers/user_1/addons', {
    method: 'POST',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { role: 'ADMIN' } })
  h.profileFindUnique.mockResolvedValue({ id: 'tp_1' })
  h.addonFindUnique.mockResolvedValue(null)
  h.addonUpsert.mockResolvedValue({})
  h.billingItemUpsert.mockResolvedValue({})
})

describe('auth guard', () => {
  it('401s for a non-admin', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER' } })
    const res = await POST(req({ itemId: 'shop', active: true }), params())
    expect(res.status).toBe(401)
    expect(h.addonUpsert).not.toHaveBeenCalled()
  })

  it('401s when signed out', async () => {
    h.auth.mockResolvedValue(null)
    const res = await POST(req({ itemId: 'shop', active: true }), params())
    expect(res.status).toBe(401)
  })
})

describe('validation', () => {
  it('400s an unknown add-on', async () => {
    const res = await POST(req({ itemId: 'not-real', active: true }), params())
    expect(res.status).toBe(400)
    expect(h.addonUpsert).not.toHaveBeenCalled()
  })

  it('400s a coming-soon add-on', async () => {
    const res = await POST(req({ itemId: 'ai', active: true }), params())
    expect(res.status).toBe(400)
  })

  it('404s when the trainer profile is missing', async () => {
    h.profileFindUnique.mockResolvedValue(null)
    const res = await POST(req({ itemId: 'shop', active: true }), params())
    expect(res.status).toBe(404)
  })
})

describe('granting', () => {
  it('creates a comp: grantedByAdmin true, active true, expiry set — no Stripe', async () => {
    const expiresAt = new Date(Date.now() + 30 * 864e5).toISOString()
    const res = await POST(req({ itemId: 'shop', active: true, expiresAt }), params())
    expect(res.status).toBe(200)
    // Self-heals the BillingItem FK first.
    expect(h.billingItemUpsert).toHaveBeenCalledTimes(1)
    const call = h.addonUpsert.mock.calls[0][0]
    expect(call.where).toEqual({ trainerId_itemId: { trainerId: 'tp_1', itemId: 'shop' } })
    expect(call.create).toMatchObject({ trainerId: 'tp_1', itemId: 'shop', active: true, grantedByAdmin: true })
    expect(call.create.expiresAt).toBeInstanceOf(Date)
  })

  it('refuses to comp an add-on already on a paid subscription (409)', async () => {
    h.addonFindUnique.mockResolvedValue({ stripeSubscriptionItemId: 'si_123', grantedByAdmin: false, expiresAt: null })
    const res = await POST(req({ itemId: 'shop', active: true }), params())
    expect(res.status).toBe(409)
    expect(h.addonUpsert).not.toHaveBeenCalled()
  })

  it('re-arms the reminder when the expiry changes on update', async () => {
    h.addonFindUnique.mockResolvedValue({
      stripeSubscriptionItemId: null,
      grantedByAdmin: true,
      expiresAt: new Date('2026-08-01T00:00:00Z'),
    })
    const res = await POST(req({ itemId: 'shop', active: true, expiresAt: new Date('2026-09-01T00:00:00Z').toISOString() }), params())
    expect(res.status).toBe(200)
    expect(h.addonUpsert.mock.calls[0][0].update).toMatchObject({ expiryReminderSentAt: null })
  })

  it('revokes with active:false (row kept, no expiry)', async () => {
    const res = await POST(req({ itemId: 'shop', active: false }), params())
    expect(res.status).toBe(200)
    expect(h.addonUpsert.mock.calls[0][0].update).toMatchObject({ active: false, grantedByAdmin: true })
  })
})
