import { describe, it, expect, vi, beforeEach } from 'vitest'

// regrantOnRenewal: the flag that has sat unread on MembershipItem since the
// model was written. It answers the obvious question about a bundle containing
// a bag of treats — one bag ever, or one every month?

const h = vi.hoisted(() => ({
  membershipFindUnique: vi.fn(),
  productFindFirst: vi.fn(),
  productRequestCreate: vi.fn(),
  takeStock: vi.fn(),
  materializeBooking: vi.fn(),
  enrollInRun: vi.fn(),
}))

vi.mock('@/lib/stock', () => ({ takeStock: h.takeStock }))
vi.mock('@/lib/booking-page', () => ({ materializeBooking: h.materializeBooking }))
vi.mock('@/lib/class-runs', () => ({ enrollInRun: h.enrollInRun }))
vi.mock('@/lib/prisma', () => ({ prisma: { classEnrollment: { update: vi.fn() } } }))

import { regrantRenewalItems } from '@/lib/memberships'

const tx = {
  membership: { findUnique: h.membershipFindUnique },
  product: { findFirst: h.productFindFirst },
  productRequest: { create: h.productRequestCreate },
} as never

function membership(items: unknown[]) {
  return { id: 'm1', name: 'Treat Club', trainerId: 't1', items }
}

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.productFindFirst.mockResolvedValue({ id: 'prod1' })
  h.productRequestCreate.mockResolvedValue({})
  h.takeStock.mockResolvedValue(undefined)
})

describe('regrantRenewalItems', () => {
  it('grants a flagged product again, once per quantity', async () => {
    h.membershipFindUnique.mockResolvedValue(membership([
      { kind: 'PRODUCT', productId: 'prod1', quantity: 2, regrantOnRenewal: true },
    ]))

    const granted = await regrantRenewalItems(tx, { membershipId: 'm1', trainerId: 't1', clientId: 'c1' })

    expect(granted).toBe(2)
    expect(h.productRequestCreate).toHaveBeenCalledTimes(2)
    expect(h.productRequestCreate.mock.calls[0][0].data).toMatchObject({
      clientId: 'c1', productId: 'prod1', status: 'FULFILLED',
    })
    // The note distinguishes a renewal grant from the original purchase, so a
    // trainer looking at a client's orders can tell what happened.
    expect(h.productRequestCreate.mock.calls[0][0].data.note).toContain('renewal')
  })

  it('only asks for items actually flagged for renewal', async () => {
    h.membershipFindUnique.mockResolvedValue(membership([]))
    await regrantRenewalItems(tx, { membershipId: 'm1', trainerId: 't1', clientId: 'c1' })
    expect(h.membershipFindUnique.mock.calls[0][0].include.items.where).toEqual({ regrantOnRenewal: true })
  })

  it('never re-grants a PACKAGE or a CLASS, even if flagged', async () => {
    // Re-granting a course place every month would quietly re-enrol somebody
    // into something they are already in, and pile up assignments nobody asked
    // for. A consumable is the only thing where "again this month" is what the
    // words mean.
    h.membershipFindUnique.mockResolvedValue(membership([
      { kind: 'PACKAGE', packageId: 'pkg1', quantity: 1, regrantOnRenewal: true },
      { kind: 'CLASS', classRunId: 'run1', quantity: 1, regrantOnRenewal: true },
    ]))

    const granted = await regrantRenewalItems(tx, { membershipId: 'm1', trainerId: 't1', clientId: 'c1' })

    expect(granted).toBe(0)
    expect(h.materializeBooking).not.toHaveBeenCalled()
    expect(h.enrollInRun).not.toHaveBeenCalled()
    expect(h.productRequestCreate).not.toHaveBeenCalled()
  })

  it('keeps the shelf count honest but still owes them the item', async () => {
    h.membershipFindUnique.mockResolvedValue(membership([
      { kind: 'PRODUCT', productId: 'prod1', quantity: 1, regrantOnRenewal: true },
    ]))
    await regrantRenewalItems(tx, { membershipId: 'm1', trainerId: 't1', clientId: 'c1' })
    expect(h.takeStock).toHaveBeenCalledTimes(1)
    expect(h.productRequestCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses to touch another trainer’s membership', async () => {
    h.membershipFindUnique.mockResolvedValue({ ...membership([]), trainerId: 'someone-else' })
    const granted = await regrantRenewalItems(tx, { membershipId: 'm1', trainerId: 't1', clientId: 'c1' })
    expect(granted).toBe(0)
    expect(h.productRequestCreate).not.toHaveBeenCalled()
  })

  it('skips a product that has since been deleted', async () => {
    h.membershipFindUnique.mockResolvedValue(membership([
      { kind: 'PRODUCT', productId: 'gone', quantity: 1, regrantOnRenewal: true },
    ]))
    h.productFindFirst.mockResolvedValue(null)
    const granted = await regrantRenewalItems(tx, { membershipId: 'm1', trainerId: 't1', clientId: 'c1' })
    expect(granted).toBe(0)
  })

  it('does nothing for a membership that has vanished', async () => {
    h.membershipFindUnique.mockResolvedValue(null)
    expect(await regrantRenewalItems(tx, { membershipId: 'm1', trainerId: 't1', clientId: 'c1' })).toBe(0)
  })
})
