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
  tierFindMany: vi.fn(),
  tierCreate: vi.fn(),
  tierUpdate: vi.fn(),
  tierDeleteMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
}))

vi.mock('@/generated/prisma', () => ({}))

import {
  replacePackageSlots, derivedDropInFields, runStartFromSlots,
  replaceTicketTiers, type SlotInput, type TicketTierInput,
} from '@/lib/package-slots'

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
  packageTicketTier: {
    findMany: h.tierFindMany,
    create: h.tierCreate,
    update: h.tierUpdate,
    deleteMany: h.tierDeleteMany,
  },
  // Removing a day-part takes its future, unbooked sessions with it — see the
  // "removing a day-part" block below for what that must and must not touch.
  trainingSession: { deleteMany: h.sessionDeleteMany },
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
  h.tierFindMany.mockResolvedValue([])
  h.tierCreate.mockImplementation(async ({ data }: { data: { packageId: string } }) => ({ id: 'new-tier', ...data }))
  h.tierUpdate.mockResolvedValue({})
  h.tierDeleteMany.mockResolvedValue({ count: 0 })
  h.sessionDeleteMany.mockResolvedValue({ count: 0 })
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

// Taking a day-part off the timetable. The FK is SetNull, so deleting the slot
// row alone left up to a year of dates behind it — still on the board, still
// bookable, and invisible to the top-up (which keys on a non-null slot id), so
// nothing could ever tidy them. Removing the afternoon left the afternoon
// selling. They go with the slot now — but only the ones nobody is in.
describe('replacePackageSlots — removing a day-part', () => {
  it('takes the removed part’s FUTURE, UNBOOKED sessions with it', async () => {
    h.slotFindMany.mockResolvedValue([{ id: 'slot-a' }, { id: 'slot-b' }])
    await replacePackageSlots(tx, 'pkg1', MINE, [slot({ id: 'slot-a' })])

    const where = h.sessionDeleteMany.mock.calls[0][0].where
    expect(where.packageSessionSlotId).toEqual({ in: ['slot-b'] })
    // Already happened = a record of what happened, not a plan. Left alone.
    expect(where.scheduledAt.gt).toBeInstanceOf(Date)
    // Somebody's arrangement. Deleting it would cascade the register and every
    // casual booking away from the people who most need telling — the rule
    // commit 59a02f8 set for cancelling one occurrence, applied to a whole slot.
    expect(where.dropInEnrollments).toEqual({ none: {} })
    expect(where.attendance).toEqual({ none: {} })
  })

  it('deletes the sessions BEFORE the slot row, while they can still be found', async () => {
    // Once the slot is gone the FK is null and its sessions are unreachable.
    h.slotFindMany.mockResolvedValue([{ id: 'slot-a' }])
    await replacePackageSlots(tx, 'pkg1', MINE, [])

    expect(h.sessionDeleteMany.mock.invocationCallOrder[0])
      .toBeLessThan(h.slotDeleteMany.mock.invocationCallOrder[0])
  })

  it('touches no session when the payload removes nothing', async () => {
    h.slotFindMany.mockResolvedValue([{ id: 'slot-a' }])
    await replacePackageSlots(tx, 'pkg1', MINE, [slot({ id: 'slot-a' })])
    expect(h.sessionDeleteMany).not.toHaveBeenCalled()
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

describe('runStartFromSlots (a drop-in has no start-date field of its own)', () => {
  it('takes the earliest "Starts from" across the slots', () => {
    const d = runStartFromSlots([
      slot({ startDate: '2026-09-10' }),
      slot({ startDate: '2026-08-04' }),
      slot({ startDate: '2026-10-01' }),
    ])
    expect(d?.toISOString()).toBe('2026-08-04T00:00:00.000Z')
  })

  it('ignores slots that name no date', () => {
    expect(runStartFromSlots([slot(), slot({ startDate: '2026-08-04' })])?.toISOString())
      .toBe('2026-08-04T00:00:00.000Z')
  })

  it('null when nothing names a date — the caller starts from today', () => {
    // Without this fallback a drop-in would save with no run at all, which is
    // exactly what made drop-in classes invisible to clients.
    expect(runStartFromSlots([slot(), slot()])).toBeNull()
    expect(runStartFromSlots([])).toBeNull()
  })
})

describe('replaceTicketTiers', () => {
  const tier = (over: Partial<TicketTierInput> = {}): TicketTierInput => ({ name: 'General', ...over })

  it('creates tiers in payload order', async () => {
    h.tierFindMany.mockResolvedValue([])
    await replaceTicketTiers(tx, 'pkg1', [tier({ name: 'Early bird', priceCents: 4000 }), tier({ priceCents: 6000 })])
    expect(h.tierCreate.mock.calls.map(c => [c[0].data.name, c[0].data.order]))
      .toEqual([['Early bird', 0], ['General', 1]])
  })

  it('updates a tier in place, keeping its id', async () => {
    // Id stability matters here too: an enrolment may reference the tier.
    h.tierFindMany.mockResolvedValue([{ id: 'tier-a' }])
    await replaceTicketTiers(tx, 'pkg1', [tier({ id: 'tier-a', priceCents: 5000 })])
    expect(h.tierUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tier-a' }, data: expect.objectContaining({ priceCents: 5000 }) }),
    )
    expect(h.tierCreate).not.toHaveBeenCalled()
  })

  it('drops blank rows — the editor always shows one empty tier', async () => {
    h.tierFindMany.mockResolvedValue([])
    await replaceTicketTiers(tx, 'pkg1', [tier({ name: '  ' }), tier({ name: 'General' })])
    expect(h.tierCreate).toHaveBeenCalledTimes(1)
    expect(h.tierCreate.mock.calls[0][0].data.name).toBe('General')
  })

  it('deletes tiers the payload dropped, scoped to this package', async () => {
    h.tierFindMany.mockResolvedValue([{ id: 'tier-a' }, { id: 'tier-b' }])
    await replaceTicketTiers(tx, 'pkg1', [tier({ id: 'tier-a' })])
    expect(h.tierDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['tier-b'] }, packageId: 'pkg1' } })
  })

  it('a free tier stores 0, an unpriced one stores null', async () => {
    h.tierFindMany.mockResolvedValue([])
    await replaceTicketTiers(tx, 'pkg1', [tier({ name: 'Free', priceCents: 0 }), tier({ name: 'TBC' })])
    expect(h.tierCreate.mock.calls[0][0].data.priceCents).toBe(0)
    expect(h.tierCreate.mock.calls[1][0].data.priceCents).toBeNull()
  })
})
