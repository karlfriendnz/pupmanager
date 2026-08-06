import { describe, it, expect, vi, beforeEach } from 'vitest'

// The read side of the trainer's membership-request surface: the tenant scope
// every query shares, the pending list, the per-package count for the Packages
// badge, and the wording rule that keeps the feature honest about payment.

const h = vi.hoisted(() => ({ findMany: vi.fn(), groupBy: vi.fn(), trainerFindUnique: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    membershipRequest: { findMany: h.findMany, groupBy: h.groupBy },
    trainerProfile: { findUnique: h.trainerFindUnique },
  },
}))

import {
  trainerRequestScope,
  loadPendingMembershipRequests,
  countPendingMembershipRequests,
} from '@/lib/membership-requests'
import { paymentCaveat, requestReasonLine } from '@/lib/membership-request-shape'

/** A trainer who can genuinely take a recurring card payment. */
const CAN_CHARGE = {
  acceptPaymentsEnabled: true,
  connectChargesEnabled: true,
  connectAccountId: 'acct_1',
  recurringPaymentsEnabled: true,
}

/** A sellable recurring row: current, priced plan on a RECURRING package. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', createdAt: new Date('2026-07-27T00:00:00Z'), reason: 'RECURRING', status: 'PENDING',
    client: { id: 'c1', user: { name: 'Sam', email: 's@e.com' } },
    membership: {
      id: 'm1', name: 'Juniors', priceCents: 40000, cadence: 'RECURRING', interval: 'MONTH',
      plans: [{ id: 'plan1' }],
    },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([])
  h.groupBy.mockResolvedValue([])
  h.trainerFindUnique.mockResolvedValue(CAN_CHARGE)
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
  it('asks for this trainer’s OPEN rows — pending and invited — oldest first', async () => {
    await loadPendingMembershipRequests('t-1')

    const arg = h.findMany.mock.calls[0][0]
    expect(arg.where).toEqual({
      // INVITED belongs here: nothing was granted and nobody has paid, so it is
      // still outstanding. Loading PENDING alone made an invitation VANISH from
      // the dashboard, which reads exactly like having dealt with it.
      status: { in: ['PENDING', 'INVITED'] },
      membership: { trainerId: 't-1' },
      client: { trainerId: 't-1' },
    })
    // Oldest first — the request that has waited longest is the coldest lead.
    expect(arg.orderBy).toEqual({ createdAt: 'asc' })
  })

  it('never counts an archived or unpriced plan as something to sell', async () => {
    await loadPendingMembershipRequests('t-1')
    // Both halves matter: an archived plan can't start a new subscription, and
    // the buy route refuses a zero price. Either would make "send them a
    // payment link" a link to a 409.
    expect(h.findMany.mock.calls[0][0].select.membership.select.plans.where)
      .toEqual({ archivedAt: null, priceCents: { gt: 0 } })
  })

  it('falls back to the client’s email when they have no name', async () => {
    h.findMany.mockResolvedValue([row({
      client: { id: 'c1', user: { name: null, email: 'sam@example.com' } },
    })])

    const [r] = await loadPendingMembershipRequests('t-1')
    expect(r.client.name).toBe('sam@example.com')
    expect(r.membership.interval).toBe('MONTH')
    // Serialisable — it crosses into a client component.
    expect(typeof r.createdAt).toBe('string')
  })

  it('drops a stale interval on a one-off package', async () => {
    h.findMany.mockResolvedValue([row({
      reason: 'NO_PRICE',
      membership: { id: 'm1', name: 'Mystery', priceCents: 0, cadence: 'ONE_OFF', interval: 'MONTH', plans: [] },
    })])

    const [r] = await loadPendingMembershipRequests('t-1')
    expect(r.membership.interval).toBeNull()
  })

  it('carries the row’s status through, so an invited one can say so', async () => {
    h.findMany.mockResolvedValue([row({ status: 'INVITED' })])
    expect((await loadPendingMembershipRequests('t-1'))[0].status).toBe('INVITED')
  })
})

// AGENTS.md #6 — gate on the fact, not a proxy for it. `canCharge` decides
// whether the trainer is even OFFERED the paid route, so getting it wrong sends
// a client to a checkout that refuses them.
describe('loadPendingMembershipRequests — canCharge', () => {
  it('offers the paid route when the trainer really can take the money', async () => {
    h.findMany.mockResolvedValue([row()])
    expect((await loadPendingMembershipRequests('t-1'))[0].canCharge).toBe(true)
  })

  it('reads the trainer’s capability once, not the allowlist flag alone', async () => {
    h.findMany.mockResolvedValue([row(), row({ id: 'r2' })])
    await loadPendingMembershipRequests('t-1')
    expect(h.trainerFindUnique).toHaveBeenCalledTimes(1)
    expect(h.trainerFindUnique.mock.calls[0][0].select).toMatchObject({
      acceptPaymentsEnabled: true,
      connectChargesEnabled: true,
      connectAccountId: true,
      recurringPaymentsEnabled: true,
    })
  })

  // Each flag on its own is enough to make the checkout fail, so each on its own
  // must withdraw the offer. The allowlisted-but-not-onboarded trainer is the
  // real case: recurringPaymentsEnabled true, no Stripe account.
  for (const missing of ['acceptPaymentsEnabled', 'connectChargesEnabled', 'connectAccountId', 'recurringPaymentsEnabled'] as const) {
    it(`refuses the paid route without ${missing}`, async () => {
      h.findMany.mockResolvedValue([row()])
      h.trainerFindUnique.mockResolvedValue({
        ...CAN_CHARGE,
        [missing]: missing === 'connectAccountId' ? null : false,
      })
      expect((await loadPendingMembershipRequests('t-1'))[0].canCharge).toBe(false)
    })
  }

  it('refuses the paid route for a ONE_OFF package', async () => {
    h.findMany.mockResolvedValue([row({
      membership: { id: 'm1', name: 'Mystery', priceCents: 0, cadence: 'ONE_OFF', interval: null, plans: [] },
    })])
    expect((await loadPendingMembershipRequests('t-1'))[0].canCharge).toBe(false)
  })

  it('refuses the paid route when the package has no current priced plan', async () => {
    h.findMany.mockResolvedValue([row({
      membership: { id: 'm1', name: 'Juniors', priceCents: 40000, cadence: 'RECURRING', interval: 'MONTH', plans: [] },
    })])
    expect((await loadPendingMembershipRequests('t-1'))[0].canCharge).toBe(false)
  })

  it('does not go looking for a trainer when there is nothing to show', async () => {
    await loadPendingMembershipRequests('t-1')
    expect(h.trainerFindUnique).not.toHaveBeenCalled()
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
    expect(paymentCaveat('RECURRING')).toMatch(/each period/i)
    expect(paymentCaveat('NO_PRICE')).toMatch(/no price/i)
  })

  it('no longer claims PupManager cannot bill an ongoing plan', () => {
    // It can, and the trainer's other choice on that screen is to make it do
    // so. Leaving this sentence in would talk a trainer out of the paid route
    // at the exact moment they were choosing between the two.
    expect(paymentCaveat('RECURRING')).not.toMatch(/can.?t bill|cannot bill|not able to bill/i)
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
