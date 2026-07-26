import { describe, it, expect, vi, beforeEach } from 'vitest'

// Which ticket type an event enrolment names decides what the client is
// invoiced. So the id can never be taken on trust: it must belong to THIS run's
// own offering, or a trainer (or a crafted request) could bill against another
// package's — or another trainer's — ticket. A ticket type can also cap itself
// ("Early bird ×20") independently of the event's overall capacity.
const h = vi.hoisted(() => ({
  runFindUnique: vi.fn(),
  tierFindFirst: vi.fn(),
  enrFindFirst: vi.fn(),
  enrCount: vi.fn(),
  enrGroupBy: vi.fn(),
  enrAggregate: vi.fn(),
  enrCreate: vi.fn(),
  enrUpdate: vi.fn(),
}))

vi.mock('@/generated/prisma', () => ({}))
vi.mock('@/lib/prisma', () => {
  const tx = {
    classRun: { findUnique: h.runFindUnique },
    packageTicketTier: { findFirst: h.tierFindFirst },
    classEnrollment: {
      findFirst: h.enrFindFirst,
      count: h.enrCount,
      groupBy: h.enrGroupBy,
      aggregate: h.enrAggregate,
      create: h.enrCreate,
      update: h.enrUpdate,
    },
  }
  return { prisma: { ...tx, $transaction: (fn: (c: typeof tx) => unknown) => fn(tx) } }
})

import { enrollInRun, ClassError } from '@/lib/class-runs'

const RUN = 'run_event'
const PACKAGE = 'pkg_event'
const CLIENT = 'cl_1'
const TIER = 'tier_vip'

const enrol = (over: { ticketTierId?: string | null; quantity?: number } = {}) =>
  enrollInRun({ classRunId: RUN, clientId: CLIENT, type: 'FULL', source: 'TRAINER', ...over })

beforeEach(() => {
  vi.clearAllMocks()
  h.runFindUnique.mockResolvedValue({
    id: RUN, status: 'SCHEDULED', capacity: null, packageId: PACKAGE,
    package: { allowDropIn: false, allowWaitlist: false, capacity: null },
  })
  // Only the tier that belongs to this run's package resolves.
  h.tierFindFirst.mockImplementation(async ({ where }: { where: { id: string; packageId: string } }) =>
    where.id === TIER && where.packageId === PACKAGE
      ? { id: TIER, name: 'VIP', capacity: null }
      : null)
  h.enrFindFirst.mockResolvedValue(null)
  h.enrCount.mockResolvedValue(0)
  h.enrGroupBy.mockResolvedValue([])
  h.enrAggregate.mockResolvedValue({ _sum: { quantity: 0 }, _max: { waitlistPosition: 0 } })
  h.enrCreate.mockImplementation(async ({ data }: { data: object }) => ({ id: 'enr_new', ...data }))
  h.enrUpdate.mockImplementation(async ({ data }: { data: object }) => ({ id: 'enr_reused', ...data }))
})

describe('enrollInRun — ticket type scoping', () => {
  it('records the ticket type and how many were bought', async () => {
    const r = await enrol({ ticketTierId: TIER, quantity: 2 })
    expect(r.status).toBe('ENROLLED')
    expect(h.enrCreate.mock.calls[0][0].data).toMatchObject({
      classRunId: RUN, clientId: CLIENT, ticketTierId: TIER, quantity: 2,
    })
  })

  // The guard that matters: the tier is looked up scoped to this run's package.
  it('scopes the ticket lookup to this run’s own offering', async () => {
    await enrol({ ticketTierId: TIER })
    expect(h.tierFindFirst.mock.calls[0][0].where).toMatchObject({ id: TIER, packageId: PACKAGE })
  })

  it('refuses a ticket type belonging to another offering', async () => {
    await expect(enrol({ ticketTierId: 'tier_someone_elses' })).rejects.toThrow(ClassError)
    await expect(enrol({ ticketTierId: 'tier_someone_elses' })).rejects.toThrow(/isn’t part of this event/i)
    expect(h.enrCreate).not.toHaveBeenCalled()
  })

  it('leaves the ticket null and the quantity at one when none is named', async () => {
    await enrol()
    expect(h.tierFindFirst).not.toHaveBeenCalled()
    expect(h.enrCreate.mock.calls[0][0].data).toMatchObject({ ticketTierId: null, quantity: 1 })
  })

  it('clamps a submitted quantity rather than trusting it', async () => {
    await enrol({ ticketTierId: TIER, quantity: 9999 })
    expect(h.enrCreate.mock.calls[0][0].data.quantity).toBe(20)
  })
})

describe('enrollInRun — a ticket type’s own capacity', () => {
  beforeEach(() => {
    h.tierFindFirst.mockResolvedValue({ id: TIER, name: 'Early bird', capacity: 20 })
  })

  it('sells up to the ticket type’s cap', async () => {
    h.enrAggregate.mockResolvedValue({ _sum: { quantity: 18 }, _max: { waitlistPosition: 0 } })
    await expect(enrol({ ticketTierId: TIER, quantity: 2 })).resolves.toMatchObject({ status: 'ENROLLED' })
  })

  it('refuses one ticket past the cap, naming how many are left', async () => {
    h.enrAggregate.mockResolvedValue({ _sum: { quantity: 18 }, _max: { waitlistPosition: 0 } })
    await expect(enrol({ ticketTierId: TIER, quantity: 3 })).rejects.toThrow(/Only 2 Early bird tickets left/i)
    expect(h.enrCreate).not.toHaveBeenCalled()
  })

  it('says sold out rather than "0 left"', async () => {
    h.enrAggregate.mockResolvedValue({ _sum: { quantity: 20 }, _max: { waitlistPosition: 0 } })
    await expect(enrol({ ticketTierId: TIER, quantity: 1 })).rejects.toThrow(/sold out/i)
  })

  it('counts sold places against this ticket type only', async () => {
    await enrol({ ticketTierId: TIER, quantity: 1 })
    const where = h.enrAggregate.mock.calls[0][0].where
    expect(where).toMatchObject({ classRunId: RUN, ticketTierId: TIER, status: 'ENROLLED' })
  })
})
