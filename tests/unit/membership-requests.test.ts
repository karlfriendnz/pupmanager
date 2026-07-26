import { describe, it, expect, vi, beforeEach } from 'vitest'

// The read side of the trainer's membership-request surface: the tenant scope
// every query shares, the pending list, the per-package count for the Packages
// badge, and the wording rule that keeps the feature honest about payment.

const h = vi.hoisted(() => ({ findMany: vi.fn(), groupBy: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { membershipRequest: { findMany: h.findMany, groupBy: h.groupBy } },
}))

import {
  trainerRequestScope,
  loadPendingMembershipRequests,
  countPendingMembershipRequests,
} from '@/lib/membership-requests'
import { paymentCaveat, requestReasonLine } from '@/lib/membership-request-shape'

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([])
  h.groupBy.mockResolvedValue([])
})

describe('trainerRequestScope', () => {
  it('scopes on the package AND the client, so neither side alone can leak', () => {
    expect(trainerRequestScope('t-1')).toEqual({
      membership: { trainerId: 't-1' },
      client: { trainerId: 't-1' },
    })
  })
})

describe('loadPendingMembershipRequests', () => {
  it('asks only for this trainer’s PENDING rows, oldest first', async () => {
    await loadPendingMembershipRequests('t-1')

    const arg = h.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({
      status: 'PENDING',
      membership: { trainerId: 't-1' },
      client: { trainerId: 't-1' },
    })
    // Oldest first — the request that has waited longest is the coldest lead.
    expect(arg.orderBy).toEqual({ createdAt: 'asc' })
  })

  it('falls back to the client’s email when they have no name', async () => {
    h.findMany.mockResolvedValue([{
      id: 'r1', createdAt: new Date('2026-07-27T00:00:00Z'), reason: 'RECURRING',
      client: { id: 'c1', user: { name: null, email: 'sam@example.com' } },
      membership: { id: 'm1', name: 'Juniors', priceCents: 40000, cadence: 'RECURRING', interval: 'MONTH' },
    }])

    const [row] = await loadPendingMembershipRequests('t-1')
    expect(row.client.name).toBe('sam@example.com')
    expect(row.membership.interval).toBe('MONTH')
    // Serialisable — it crosses into a client component.
    expect(typeof row.createdAt).toBe('string')
  })

  it('drops a stale interval on a one-off package', async () => {
    h.findMany.mockResolvedValue([{
      id: 'r1', createdAt: new Date(), reason: 'NO_PRICE',
      client: { id: 'c1', user: { name: 'Sam', email: 's@e.com' } },
      membership: { id: 'm1', name: 'Mystery', priceCents: 0, cadence: 'ONE_OFF', interval: 'MONTH' },
    }])

    const [row] = await loadPendingMembershipRequests('t-1')
    expect(row.membership.interval).toBeNull()
  })
})

describe('countPendingMembershipRequests', () => {
  it('counts PENDING rows per package within the trainer’s scope', async () => {
    h.groupBy.mockResolvedValue([{ membershipId: 'm1', _count: { _all: 3 } }])

    const counts = await countPendingMembershipRequests('t-1')

    expect(h.groupBy.mock.calls[0][0].where).toEqual({
      status: 'PENDING',
      membership: { trainerId: 't-1' },
      client: { trainerId: 't-1' },
    })
    expect(counts.get('m1')).toBe(3)
    expect(counts.get('m2')).toBeUndefined()
  })
})

describe('paymentCaveat', () => {
  it('says plainly that nothing was charged, for both reasons', () => {
    for (const reason of ['RECURRING', 'NO_PRICE'] as const) {
      const text = paymentCaveat(reason)
      expect(text).toMatch(/No payment is taken/)
      // The whole point: it must never read as though money moved.
      expect(text).not.toMatch(/\bpaid\b|\bcharged\b|subscription is active/i)
      // And it must say what the trainer still has to do.
      expect(text).toMatch(/invoice/i)
    }
  })

  it('explains the ongoing-plan case differently from the unpriced one', () => {
    expect(paymentCaveat('RECURRING')).toMatch(/ongoing plan/i)
    expect(paymentCaveat('NO_PRICE')).toMatch(/no price/i)
  })
})

describe('requestReasonLine', () => {
  it('quotes an ongoing plan per period', () => {
    const line = requestReasonLine(
      { id: 'm1', name: 'Juniors', priceCents: 40000, cadence: 'RECURRING', interval: 'MONTH' },
      '$400.00',
    )
    expect(line).toBe('Ongoing plan · $400.00 / month · needs setting up')
  })

  it('never quotes a price for an unpriced package', () => {
    const line = requestReasonLine(
      { id: 'm1', name: 'Mystery', priceCents: 0, cadence: 'ONE_OFF', interval: null },
      '$0.00',
    )
    expect(line).toBe('No price set on this package yet')
    expect(line).not.toContain('$')
  })
})
