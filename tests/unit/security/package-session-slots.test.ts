import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenancy on a drop-in class's schedule slots.
//
// A slot points at a Location and at TrainerMembership ids (who runs it). Both
// come straight off a form payload, so without a scope check a trainer could
// post another company's location id — putting a rival's venue on their class —
// or assign a stranger's staff member to their sessions. replacePackageSlots is
// the single writer for slots (both POST /api/packages and PATCH
// /api/packages/[id] go through it), so the guard belongs here and is asserted
// here. Same posture as setRunTrainers: cross-tenant references are dropped,
// not rejected, so one stale id can't fail an otherwise-valid save.

const h = vi.hoisted(() => ({
  locationFindMany: vi.fn(),
  membershipFindMany: vi.fn(),
  slotFindMany: vi.fn(),
  slotCreate: vi.fn(),
  slotUpdate: vi.fn(),
  slotDeleteMany: vi.fn(),
}))

vi.mock('@/generated/prisma', () => ({}))

import { replacePackageSlots, derivedDropInFields, type SlotInput } from '@/lib/package-slots'

const MINE = 'trainer-mine'
const THEIRS = 'trainer-theirs'

// A stand-in transaction client. Location/membership lookups honour the
// trainerId/companyId filter exactly like Prisma would.
const tx = {
  location: { findMany: h.locationFindMany },
  trainerMembership: { findMany: h.membershipFindMany },
  packageSessionSlot: {
    findMany: h.slotFindMany,
    create: h.slotCreate,
    update: h.slotUpdate,
    deleteMany: h.slotDeleteMany,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const slot = (over: Partial<SlotInput> = {}): SlotInput => ({
  day: 2,
  startTime: '15:00',
  endTime: '17:00',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.slotFindMany.mockResolvedValue([])
  h.slotCreate.mockImplementation(async ({ data }: { data: { packageId: string } }) => ({ id: 'new-slot', ...data }))
  h.slotUpdate.mockResolvedValue({})
  h.slotDeleteMany.mockResolvedValue({ count: 0 })
  // Only MINE's location exists under this trainer.
  h.locationFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] }; trainerId: string } }) =>
    where.trainerId === MINE ? where.id.in.filter((id) => id === 'loc-mine').map((id) => ({ id })) : [],
  )
  h.membershipFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] }; companyId: string } }) =>
    where.companyId === MINE ? where.id.in.filter((id) => id === 'member-mine').map((id) => ({ id })) : [],
  )
})

describe('replacePackageSlots — cross-tenant references', () => {
  it('drops a location belonging to another company', async () => {
    await replacePackageSlots(tx, 'pkg1', MINE, [slot({ locationId: 'loc-theirs' })])

    expect(h.locationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ trainerId: MINE }) }),
    )
    expect(h.slotCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ locationId: null }) }),
    )
  })

  it('keeps a location the trainer really owns', async () => {
    await replacePackageSlots(tx, 'pkg1', MINE, [slot({ locationId: 'loc-mine' })])
    expect(h.slotCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ locationId: 'loc-mine' }) }),
    )
  })

  it('drops staff who are not in this company, keeping the rest', async () => {
    await replacePackageSlots(tx, 'pkg1', MINE, [
      slot({ assignedMembershipIds: ['member-mine', 'member-theirs'] }),
    ])
    expect(h.membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: MINE }) }),
    )
    expect(h.slotCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedMembershipIds: ['member-mine'] }) }),
    )
  })

  it('scopes lookups to the SAVING trainer, so another company sees nothing', async () => {
    await replacePackageSlots(tx, 'pkg1', THEIRS, [
      slot({ locationId: 'loc-mine', assignedMembershipIds: ['member-mine'] }),
    ])
    expect(h.slotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ locationId: null, assignedMembershipIds: [] }),
      }),
    )
  })
})

describe('replacePackageSlots — reconcile', () => {
  it('updates a slot that already belongs to this package, keeping its id', async () => {
    // Id stability matters: sessions already in the diary point at the slot for
    // their price, so a re-save must not orphan them.
    h.slotFindMany.mockResolvedValue([{ id: 'slot-a' }])
    await replacePackageSlots(tx, 'pkg1', MINE, [slot({ id: 'slot-a', priceCents: 2500 })])

    expect(h.slotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'slot-a' }, data: expect.objectContaining({ priceCents: 2500 }) }),
    )
    expect(h.slotCreate).not.toHaveBeenCalled()
    expect(h.slotDeleteMany).not.toHaveBeenCalled()
  })

  it('treats an id from another package as a NEW slot, never an update', async () => {
    h.slotFindMany.mockResolvedValue([{ id: 'slot-a' }])
    await replacePackageSlots(tx, 'pkg1', MINE, [slot({ id: 'slot-from-elsewhere' })])

    expect(h.slotUpdate).not.toHaveBeenCalled()
    expect(h.slotCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ packageId: 'pkg1' }) }),
    )
  })

  it('deletes slots the payload dropped — scoped to this package', async () => {
    h.slotFindMany.mockResolvedValue([{ id: 'slot-a' }, { id: 'slot-b' }])
    await replacePackageSlots(tx, 'pkg1', MINE, [slot({ id: 'slot-a' })])

    expect(h.slotDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['slot-b'] }, packageId: 'pkg1' } })
  })

  it('an empty payload clears the schedule', async () => {
    h.slotFindMany.mockResolvedValue([{ id: 'slot-a' }])
    await replacePackageSlots(tx, 'pkg1', MINE, [])
    expect(h.slotDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['slot-a'] }, packageId: 'pkg1' } })
  })

  it('numbers the slots in payload order', async () => {
    await replacePackageSlots(tx, 'pkg1', MINE, [slot({ day: 2 }), slot({ day: 6 })])
    const orders = h.slotCreate.mock.calls.map((c) => c[0].data.order)
    expect(orders).toEqual([0, 1])
  })

  it('skips the ownership queries entirely when nothing references them', async () => {
    await replacePackageSlots(tx, 'pkg1', MINE, [slot()])
    expect(h.locationFindMany).not.toHaveBeenCalled()
    expect(h.membershipFindMany).not.toHaveBeenCalled()
  })
})

describe('derivedDropInFields (the server, not the form, sets the headline price)', () => {
  it('quotes the CHEAPEST slot, so "from $X" is never a lie', () => {
    expect(
      derivedDropInFields([
        slot({ priceCents: 3000 }),
        slot({ priceCents: 2000 }),
        slot({ priceCents: 4000 }),
      ]).dropInPriceCents,
    ).toBe(2000)
  })

  it('a slot on special is compared at its special price', () => {
    expect(
      derivedDropInFields([slot({ priceCents: 3000, specialPriceCents: 1500 }), slot({ priceCents: 2000 })])
        .dropInPriceCents,
    ).toBe(1500)
  })

  it('unpriced slots do not count as free', () => {
    expect(derivedDropInFields([slot(), slot({ priceCents: 2500 })]).dropInPriceCents).toBe(2500)
  })

  it('a genuinely free session is 0, not null', () => {
    expect(derivedDropInFields([slot({ priceCents: 0 })]).dropInPriceCents).toBe(0)
  })

  it('null when nothing is priced', () => {
    expect(derivedDropInFields([slot(), slot()]).dropInPriceCents).toBeNull()
  })

  it('always turns drop-ins on — having a schedule IS being a drop-in class', () => {
    expect(derivedDropInFields([]).allowDropIn).toBe(true)
    expect(derivedDropInFields([slot()]).allowDropIn).toBe(true)
  })
})
