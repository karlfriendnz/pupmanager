import { describe, it, expect, vi, beforeEach } from 'vitest'

// getUnbilledPaidAddons is the set of add-ons that get put on a trainer's
// subscription the moment they subscribe. Everything it returns becomes a
// recurring charge, so what it LEAVES OUT matters as much as what it includes:
// a free add-on in there is a Stripe call with no price behind it, and an admin
// comp or a lapsed grant in there is charging for something we promised free or
// that the trainer can no longer use.
const h = vi.hoisted(() => ({ findMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { trainerAddon: { findMany: h.findMany } } }))

import { getUnbilledPaidAddons } from '@/lib/billing'

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getUnbilledPaidAddons', () => {
  it('only asks for rows that are on, not comped, and not already a Stripe line item', async () => {
    h.findMany.mockResolvedValue([])
    await getUnbilledPaidAddons('t1')

    expect(h.findMany.mock.calls[0][0].where).toEqual({
      trainerId: 't1',
      active: true,
      grantedByAdmin: false,
      stripeSubscriptionItemId: null,
    })
  })

  it('returns the paid add-ons the trainer switched on', async () => {
    h.findMany.mockResolvedValue([
      { itemId: 'marketing', expiresAt: null },
      { itemId: 'routeplanner', expiresAt: null },
    ])

    await expect(getUnbilledPaidAddons('t1')).resolves.toEqual(['marketing', 'routeplanner'])
  })

  it('drops FREE add-ons — there is no price to bill them at', async () => {
    h.findMany.mockResolvedValue([
      { itemId: 'timesheets', expiresAt: null },
      { itemId: 'xero', expiresAt: null },
      { itemId: 'marketing', expiresAt: null },
    ])

    await expect(getUnbilledPaidAddons('t1')).resolves.toEqual(['marketing'])
  })

  it('drops a lapsed grant — gating already treats it as off', async () => {
    h.findMany.mockResolvedValue([
      { itemId: 'marketing', expiresAt: new Date(Date.now() - DAY) },
      { itemId: 'routeplanner', expiresAt: new Date(Date.now() + DAY) },
    ])

    await expect(getUnbilledPaidAddons('t1')).resolves.toEqual(['routeplanner'])
  })

  it('ignores anything that is not in the add-on catalogue', async () => {
    h.findMany.mockResolvedValue([{ itemId: 'seat', expiresAt: null }])

    await expect(getUnbilledPaidAddons('t1')).resolves.toEqual([])
  })
})
