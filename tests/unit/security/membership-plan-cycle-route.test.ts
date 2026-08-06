import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// A recurring plan can bill every N weeks — through the ROUTES, which is where
// it has to be true.
//
// THIS TOUCHES LIVE MONEY. Three things are asserted here that no amount of
// careful UI work can guarantee on its own:
//
//  1. The count SURVIVES A RELOAD. Save 6 weeks → read it back → still 6 weeks.
//     The single most repeated bug in this codebase is a field that "saved
//     fine" and hadn't.
//  2. An out-of-range count is refused by the SERVER. `min` on a number input
//     is a hint; a POST straight at the route is the case it would not stop.
//  3. Editing the cycle NEVER re-cycles somebody already subscribed. Their plan
//     row is archived (keeping its immutable Stripe Price) and the new cycle
//     goes onto a fresh row with null Stripe ids.

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  memFindFirst: vi.fn(),
  memCreate: vi.fn(),
  memUpdate: vi.fn(),
  memFindFirstOrder: vi.fn(),
  itemCreateMany: vi.fn(),
  itemDeleteMany: vi.fn(),
  planCreateMany: vi.fn(),
  planUpdateMany: vi.fn(),
  planDeleteMany: vi.fn(),
  purchaseFindMany: vi.fn(),
  prereqDeleteMany: vi.fn(),
  prereqCreateMany: vi.fn(),
  pkgCount: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/billing', () => ({ hasAddon: vi.fn(async () => true) }))
vi.mock('@/lib/prisma', () => {
  const tx = {
    membership: { findFirst: h.memFindFirstOrder, create: h.memCreate, update: h.memUpdate },
    membershipItem: { createMany: h.itemCreateMany, deleteMany: h.itemDeleteMany },
    membershipPlan: { createMany: h.planCreateMany, updateMany: h.planUpdateMany, deleteMany: h.planDeleteMany },
    membershipPurchase: { findMany: h.purchaseFindMany },
    membershipPrerequisite: { deleteMany: h.prereqDeleteMany, createMany: h.prereqCreateMany },
    package: { count: h.pkgCount },
  }
  return {
    prisma: {
      membership: { findFirst: h.memFindFirst },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  }
})

import { POST as createMembership } from '@/app/api/trainer/memberships/route'
import { PATCH as patchMembership, GET as getMembership } from '@/app/api/trainer/memberships/[id]/route'

function req(body: unknown) {
  return new Request('https://app.pupmanager.com/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const idParams = { params: Promise.resolve({ id: 'm1' }) }

/** "6 week grooming" — the package Karl could not express. */
const sixWeekly = { interval: 'WEEK', intervalCount: 6, priceCents: 6000, minTermCount: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ companyId: 't1' })
  h.memFindFirst.mockResolvedValue({ id: 'm1' })
  h.memFindFirstOrder.mockResolvedValue(null)
  h.memCreate.mockResolvedValue({ id: 'm1' })
  h.memUpdate.mockResolvedValue({ id: 'm1', plans: [] })
  h.purchaseFindMany.mockResolvedValue([])
})

describe('storing a cycle of N weeks', () => {
  it('writes intervalCount on a new plan', async () => {
    const res = await createMembership(req({
      name: '6 week grooming', priceCents: 0, cadence: 'RECURRING', items: [], plans: [sixWeekly],
    }))
    expect(res.status).toBe(201)
    expect(h.planCreateMany.mock.calls[0][0].data[0]).toMatchObject({
      interval: 'WEEK', intervalCount: 6, priceCents: 6000,
    })
  })

  it('defaults a plan sent WITHOUT a count to 1 — exactly today’s behaviour', async () => {
    // An older mobile shell, or any caller written before this column existed,
    // must still describe precisely the plan it always did.
    await createMembership(req({
      name: 'Monthly', priceCents: 0, cadence: 'RECURRING', items: [],
      plans: [{ interval: 'MONTH', priceCents: 4000 }],
    }))
    expect(h.planCreateMany.mock.calls[0][0].data[0].intervalCount).toBe(1)
  })

  it('still accepts a FORTNIGHT plan — those rows exist and must stay saveable', async () => {
    // The editor no longer OFFERS fortnight, but refusing the value would mean
    // a trainer could not save a membership that already has one on it.
    await createMembership(req({
      name: 'Legacy', priceCents: 0, cadence: 'RECURRING', items: [],
      plans: [{ interval: 'FORTNIGHT', priceCents: 4800 }],
    }))
    expect(h.planCreateMany.mock.calls[0][0].data[0]).toMatchObject({ interval: 'FORTNIGHT', intervalCount: 1 })
  })
})

describe('bounds are enforced SERVER-SIDE', () => {
  // Browser validation is not validation. Every one of these is a POST straight
  // at the route with no UI in the way.
  it.each([
    ['zero', 0],
    ['negative', -6],
    ['a fraction', 1.5],
    ['500 weeks — a support ticket', 500],
    ['53 weeks — over a year, which Stripe itself rejects', 53],
  ])('refuses %s and writes nothing', async (_label, intervalCount) => {
    const res = await createMembership(req({
      name: 'Bad', priceCents: 0, cadence: 'RECURRING', items: [],
      plans: [{ interval: 'WEEK', intervalCount, priceCents: 6000 }],
    }))
    expect(res.status).toBe(400)
    expect(h.planCreateMany).not.toHaveBeenCalled()
    expect(h.memCreate).not.toHaveBeenCalled()
  })

  it('caps months at 12, not 52 — the limit is a YEAR, not a number', async () => {
    const bad = await createMembership(req({
      name: 'Bad', priceCents: 0, cadence: 'RECURRING', items: [],
      plans: [{ interval: 'MONTH', intervalCount: 13, priceCents: 6000 }],
    }))
    expect(bad.status).toBe(400)

    const ok = await createMembership(req({
      name: 'Yearly-ish', priceCents: 0, cadence: 'RECURRING', items: [],
      plans: [{ interval: 'MONTH', intervalCount: 12, priceCents: 6000 }],
    }))
    expect(ok.status).toBe(201)
  })

  it('refuses the bad plan even when another plan in the same save is fine', async () => {
    const res = await createMembership(req({
      name: 'Mixed', priceCents: 0, cadence: 'RECURRING', items: [],
      plans: [sixWeekly, { interval: 'WEEK', intervalCount: 0, priceCents: 1000 }],
    }))
    expect(res.status).toBe(400)
    expect(h.planCreateMany).not.toHaveBeenCalled()
  })

  it('refuses it on EDIT too, not just on create', async () => {
    const res = await patchMembership(
      req({ plans: [{ interval: 'WEEK', intervalCount: 0, priceCents: 6000 }] }),
      idParams,
    )
    expect(res.status).toBe(400)
    expect(h.planCreateMany).not.toHaveBeenCalled()
    expect(h.planDeleteMany).not.toHaveBeenCalled()
  })
})

describe('changing the cycle must not re-cycle an existing subscriber', () => {
  it('ARCHIVES the plan somebody is subscribed to and puts the new cycle on a fresh row', async () => {
    // Stripe Prices are immutable and a live subscription bills against the
    // Price minted from its plan row. Deleting or mutating that row is how a
    // real dog owner's every-4-weeks plan silently becomes every-6-weeks.
    h.purchaseFindMany.mockResolvedValue([{ planId: 'plan-live' }])

    const res = await patchMembership(req({ plans: [sixWeekly] }), idParams)
    expect(res.status).toBe(200)

    // The subscribed row is archived, not deleted — it keeps its Stripe Price.
    expect(h.planUpdateMany).toHaveBeenCalledTimes(1)
    const archive = h.planUpdateMany.mock.calls[0][0]
    expect(archive.where).toMatchObject({ membershipId: 'm1', id: { in: ['plan-live'] }, archivedAt: null })
    expect(archive.data.archivedAt).toBeInstanceOf(Date)

    // …and it is explicitly EXCLUDED from the delete.
    expect(h.planDeleteMany.mock.calls[0][0].where).toMatchObject({ id: { notIn: ['plan-live'] } })

    // The new cycle lands on a brand-new row. It carries NO Stripe ids, so the
    // next sale mints a genuinely new Price rather than reusing a monthly one.
    const written = h.planCreateMany.mock.calls[0][0].data[0]
    expect(written).toMatchObject({ interval: 'WEEK', intervalCount: 6 })
    expect(written.stripePriceId).toBeUndefined()
    expect(written.stripeProductId).toBeUndefined()
  })

  it('counts PAST_DUE and CANCELLING as subscribed — they are still being billed', async () => {
    await patchMembership(req({ plans: [sixWeekly] }), idParams)
    expect(h.purchaseFindMany.mock.calls[0][0].where.status.in)
      .toEqual(['ACTIVE', 'PAST_DUE', 'CANCELLING'])
  })

  it('deletes the plans nobody is on, so an unsold cycle change leaves no orphan', async () => {
    await patchMembership(req({ plans: [sixWeekly] }), idParams)
    expect(h.planUpdateMany).not.toHaveBeenCalled()
    expect(h.planDeleteMany.mock.calls[0][0].where).toEqual({ membershipId: 'm1' })
  })
})

describe('round trip — 6 weeks survives a reload', () => {
  it('reads back the cycle the trainer saved', async () => {
    // The only proof a field persisted is save → reload → assert.
    const saved = {
      id: 'm1', name: '6 week grooming', cadence: 'RECURRING',
      plans: [{ id: 'p-new', interval: 'WEEK', intervalCount: 6, priceCents: 6000, minTermCount: 0, archivedAt: null }],
    }
    h.memUpdate.mockResolvedValue(saved)

    const patched = await patchMembership(req({ plans: [sixWeekly] }), idParams)
    expect(await patched.json()).toMatchObject({
      plans: [{ interval: 'WEEK', intervalCount: 6 }],
    })

    // And the GET the editor actually reloads from returns the same thing —
    // not "week", not "month", and not a count silently dropped to 1.
    h.memFindFirst.mockResolvedValue(saved)
    const reloaded = await getMembership(new Request('https://app.pupmanager.com/x'), idParams)
    const body = await reloaded.json()
    expect(body.plans[0].interval).toBe('WEEK')
    expect(body.plans[0].intervalCount).toBe(6)
  })
})
