import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fulfilment: a paid membership grants exactly one ClientPackage per package
// quantity, one product order per product quantity, records the purchase, and
// returns its class places to enrol post-commit. Class + tenant guard covered.

const h = vi.hoisted(() => ({ materializeBooking: vi.fn(), enrollInRun: vi.fn() }))
vi.mock('@/lib/booking-page', () => ({ materializeBooking: h.materializeBooking }))
vi.mock('@/lib/class-runs', () => ({ enrollInRun: h.enrollInRun }))

import { fulfilMembershipInTx, enrolMembershipClasses } from '@/lib/memberships'

const PKG = { id: 'p1', name: 'Private 4-pack', sessionCount: 4, weeksBetween: 1, durationMins: 60, bufferMins: 0, sessionType: 'IN_PERSON' }
const MEMBERSHIP = {
  id: 'm1', name: 'Puppy Starter', trainerId: 't1',
  items: [
    { kind: 'PACKAGE', packageId: 'p1', classRunId: null, productId: null, quantity: 2, order: 0 },
    { kind: 'PRODUCT', packageId: null, classRunId: null, productId: 'prod1', quantity: 3, order: 1 },
    { kind: 'CLASS', packageId: null, classRunId: 'run1', productId: null, quantity: 1, order: 2 },
  ],
}

function makeTx(membership: unknown = MEMBERSHIP) {
  return {
    membership: { findUnique: vi.fn().mockResolvedValue(membership) },
    package: { findFirst: vi.fn().mockResolvedValue(PKG) },
    product: { findFirst: vi.fn().mockResolvedValue({ id: 'prod1' }) },
    productRequest: { create: vi.fn().mockResolvedValue({}) },
    membershipPurchase: { create: vi.fn().mockResolvedValue({}) },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('fulfilMembershipInTx', () => {
  it('grants each package × qty, each product × qty, records the purchase, defers classes', async () => {
    const tx = makeTx()
    const { classGrants } = await fulfilMembershipInTx(tx as never, { membershipId: 'm1', trainerId: 't1', clientId: 'c1', paymentId: 'pay1', sandbox: false })

    expect(h.materializeBooking).toHaveBeenCalledTimes(2) // package qty 2
    expect(tx.productRequest.create).toHaveBeenCalledTimes(3) // product qty 3
    expect(tx.membershipPurchase.create).toHaveBeenCalledTimes(1)
    expect(tx.membershipPurchase.create.mock.calls[0][0].data).toMatchObject({ membershipId: 'm1', trainerId: 't1', clientId: 'c1', paymentId: 'pay1', status: 'ACTIVE' })
    expect(classGrants).toEqual([{ classRunId: 'run1' }]) // one place, enrolled post-commit
  })

  it('grants nothing for a membership that is not the paying trainer’s', async () => {
    const tx = makeTx({ ...MEMBERSHIP, trainerId: 'someone-else' })
    const r = await fulfilMembershipInTx(tx as never, { membershipId: 'm1', trainerId: 't1', clientId: 'c1', paymentId: 'pay1', sandbox: false })

    expect(r.classGrants).toEqual([])
    expect(h.materializeBooking).not.toHaveBeenCalled()
    expect(tx.productRequest.create).not.toHaveBeenCalled()
    expect(tx.membershipPurchase.create).not.toHaveBeenCalled()
  })

  it('skips a package that has since been deleted (not owned)', async () => {
    const tx = makeTx()
    tx.package.findFirst.mockResolvedValue(null)
    await fulfilMembershipInTx(tx as never, { membershipId: 'm1', trainerId: 't1', clientId: 'c1', paymentId: 'pay1', sandbox: false })
    expect(h.materializeBooking).not.toHaveBeenCalled()
    // The rest of the bundle still fulfils.
    expect(tx.productRequest.create).toHaveBeenCalledTimes(3)
    expect(tx.membershipPurchase.create).toHaveBeenCalledTimes(1)
  })
})

describe('enrolMembershipClasses', () => {
  it('enrols the buyer into each class place', async () => {
    await enrolMembershipClasses([{ classRunId: 'run1' }, { classRunId: 'run2' }], 'c1')
    expect(h.enrollInRun).toHaveBeenCalledTimes(2)
    expect(h.enrollInRun.mock.calls[0][0]).toMatchObject({ classRunId: 'run1', clientId: 'c1', type: 'FULL', source: 'SELF_SERVE' })
  })

  it('a full/closed class does not throw the whole fulfilment', async () => {
    h.enrollInRun.mockRejectedValueOnce(new Error('FULL'))
    await expect(enrolMembershipClasses([{ classRunId: 'run1' }], 'c1')).resolves.toBeUndefined()
  })
})
