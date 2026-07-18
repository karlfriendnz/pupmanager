import { describe, it, expect, vi, beforeEach } from 'vitest'

// Toggling an add-on goes through POST /api/addons. Free add-ons (Xero,
// Timesheets, To-do, and the core Client app / Notes / Classes) take a no-Stripe
// path that upserts a TrainerAddon row. This suite proves EVERY free add-on
// toggles on and off, and that the catalog stays internally consistent — a
// regression guard for the class of bug where a new add-on is added to
// pricing.ts but something downstream (e.g. its BillingItem) is missed.
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  upsert: vi.fn(),
  findUnique: vi.fn(),
  billingItemUpsert: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerAddon: { upsert: h.upsert },
    trainerProfile: { findUnique: h.findUnique },
    billingItem: { upsert: h.billingItemUpsert },
  },
}))
// The route imports these at module load; the free path never calls them.
vi.mock('@/lib/stripe', () => ({ stripeFor: vi.fn(), isStripeConfigured: () => false }))
vi.mock('@/lib/billing', () => ({ resolvePriceId: vi.fn(), loadPriceIndex: vi.fn() }))

import { POST } from '@/app/api/addons/route'
import { ADDONS, addonById } from '@/lib/pricing'

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/addons', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  h.getTrainerContext.mockReset()
  h.upsert.mockReset()
  h.findUnique.mockReset()
  h.billingItemUpsert.mockReset()
  // Owner has every permission, incl. billing.seats (real can() short-circuits).
  h.getTrainerContext.mockResolvedValue({ companyId: 'co_1', role: 'OWNER', permissions: null })
  h.upsert.mockResolvedValue({})
  h.billingItemUpsert.mockResolvedValue({})
})

const freeAddons = ADDONS.filter((a) => a.free && !a.comingSoon)

describe('POST /api/addons — every free add-on toggles', () => {
  it.each(freeAddons.map((a) => [a.id]))('enables "%s"', async (id) => {
    const res = await POST(req({ itemId: id, active: true }))
    expect(res.status, id).toBe(200)
    expect(h.upsert).toHaveBeenCalledTimes(1)
    expect(h.upsert.mock.calls[0][0].create).toMatchObject({ trainerId: 'co_1', itemId: id, active: true })
  })

  it.each(freeAddons.map((a) => [a.id]))('disables "%s"', async (id) => {
    const res = await POST(req({ itemId: id, active: false }))
    expect(res.status, id).toBe(200)
    expect(h.upsert.mock.calls[0][0].update).toMatchObject({ active: false })
  })

  it('the three core features are free add-ons that toggle here', () => {
    for (const id of ['clientapp', 'notes', 'classes']) {
      expect(freeAddons.map((a) => a.id)).toContain(id)
    }
  })

  // Regression guard for the exact prod bug found 2026-07-18: `pos` and
  // `instagram` 500'd because their BillingItem row (the TrainerAddon FK target)
  // was never seeded. The route now self-heals by upserting the row from the
  // catalog before touching TrainerAddon, so a missing row can never 500 again.
  it.each(freeAddons.map((a) => [a.id]))('self-heals the BillingItem for "%s" before enabling', async (id) => {
    const res = await POST(req({ itemId: id, active: true }))
    expect(res.status, id).toBe(200)
    expect(h.billingItemUpsert).toHaveBeenCalledTimes(1)
    expect(h.billingItemUpsert.mock.calls[0][0].where).toEqual({ id })
    expect(h.billingItemUpsert.mock.calls[0][0].create).toMatchObject({ id, kind: 'ADDON' })
  })

  it('a coming-soon add-on cannot be toggled', async () => {
    const res = await POST(req({ itemId: 'ai', active: true }))
    expect(res.status).toBe(404)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('rejects an unknown add-on id', async () => {
    const res = await POST(req({ itemId: 'not-a-real-addon', active: true }))
    expect(res.status).toBe(404)
  })
})

describe('add-on catalog integrity', () => {
  it('every add-on id is unique', () => {
    const ids = ADDONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('addonById resolves every add-on', () => {
    for (const a of ADDONS) expect(addonById(a.id)).toBe(a)
  })

  it('free add-ons cost 0 in every currency; paid ones cost > 0', () => {
    for (const a of ADDONS) {
      const prices = Object.values(a.price)
      if (a.free) expect(prices.every((p) => p === 0), `${a.id} free`).toBe(true)
      else if (!a.comingSoon) expect(prices.every((p) => p > 0), `${a.id} paid`).toBe(true)
    }
  })

  it('default-on add-ons are always free', () => {
    for (const a of ADDONS) if (a.defaultOn) expect(a.free, `${a.id}`).toBe(true)
  })
})
