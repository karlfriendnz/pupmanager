import { describe, it, expect, vi, beforeEach } from 'vitest'

// Enrolling one client into an event holding SEVERAL ticket types at once —
// "3 general and 3 VIP" — in a single action.
//
// The shape is one enrolment row per ticket type, tied together by a shared
// ticketGroupId, because each type prices off its OWN tier and is capped by its
// OWN tier. The two things that must never happen: a ticket billed at the
// offering's flat price (the live bug fixed in d736544 — $45 taken for a $200
// ticket), and a basket that half-books after the trainer has been quoted a
// total.
const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  runFindUnique: vi.fn(),
  tierFindMany: vi.fn(),
  enrCount: vi.fn(),
  enrFindMany: vi.fn(),
  enrAggregate: vi.fn(),
  enrGroupBy: vi.fn(),
  enrCreate: vi.fn(),
  enrUpdate: vi.fn(),
}))

const tx = {
  classRun: { findUnique: h.runFindUnique },
  packageTicketTier: { findMany: h.tierFindMany },
  classEnrollment: {
    count: h.enrCount,
    findMany: h.enrFindMany,
    aggregate: h.enrAggregate,
    groupBy: h.enrGroupBy,
    create: h.enrCreate,
    update: h.enrUpdate,
  },
}

vi.mock('../../src/lib/prisma', () => ({
  prisma: { $transaction: h.transaction },
}))
vi.mock('@/generated/prisma', () => ({}))

import {
  normalizeTicketBasket,
  ticketBasketSeats,
  ticketBasketTotalCents,
  enrollInRunTickets,
  ClassError,
  MAX_TICKET_QUANTITY,
} from '../../src/lib/class-runs'

// ─── Pure: what a submitted basket actually means ────────────────────────────

describe('normalizeTicketBasket', () => {
  it('keeps the types that were actually bought', () => {
    expect(normalizeTicketBasket([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'vip', quantity: 3 },
    ])).toEqual([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'vip', quantity: 3 },
    ])
  })

  // A stepper the trainer never touched is not a purchase. Writing it as a row
  // would put an empty "Other × 0" line on the client's invoice.
  it('drops a quantity of zero rather than creating an empty enrolment', () => {
    expect(normalizeTicketBasket([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'other', quantity: 0 },
      { ticketTierId: 'vip', quantity: 3 },
    ])).toEqual([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'vip', quantity: 3 },
    ])
  })

  it('drops negatives, fractions below one, and nonsense', () => {
    expect(normalizeTicketBasket([
      { ticketTierId: 'a', quantity: -2 },
      { ticketTierId: 'b', quantity: 0.4 },
      { ticketTierId: 'c', quantity: NaN },
      { ticketTierId: '', quantity: 5 },
    ])).toEqual([])
  })

  it('adds up a type sent twice instead of writing two rows for it', () => {
    expect(normalizeTicketBasket([
      { ticketTierId: 'vip', quantity: 2 },
      { ticketTierId: 'vip', quantity: 3 },
    ])).toEqual([{ ticketTierId: 'vip', quantity: 5 }])
  })

  it('caps each line, same as the single-ticket path', () => {
    expect(normalizeTicketBasket([{ ticketTierId: 'vip', quantity: 10_000 }]))
      .toEqual([{ ticketTierId: 'vip', quantity: MAX_TICKET_QUANTITY }])
  })

  it('an empty or missing basket is empty, not one free ticket', () => {
    expect(normalizeTicketBasket([])).toEqual([])
    expect(normalizeTicketBasket(null)).toEqual([])
    expect(normalizeTicketBasket(undefined)).toEqual([])
  })
})

describe('ticketBasketSeats + ticketBasketTotalCents', () => {
  const basket = [
    { ticketTierId: 'general', quantity: 3 },
    { ticketTierId: 'vip', quantity: 3 },
  ]
  const tiers = [
    { id: 'general', priceCents: 20000 },
    { id: 'vip', priceCents: 12300 },
    { id: 'other', priceCents: 8900 },
  ]

  it('the whole party is what has to fit the room', () => {
    expect(ticketBasketSeats(basket)).toBe(6)
  })

  // 3 × $200 + 3 × $123 = $969. Priced off the offering's flat price it would be
  // whatever the package happened to carry — the reported bug.
  it('prices every line off its own ticket, never one flat price', () => {
    expect(ticketBasketTotalCents(basket, tiers)).toBe(96_900)
  })

  it('a free ticket type adds nothing', () => {
    expect(ticketBasketTotalCents([{ ticketTierId: 'vol', quantity: 4 }], [{ id: 'vol', priceCents: null }])).toBe(0)
  })
})

// ─── The transaction: all of it, or none of it ───────────────────────────────

const RUN = 'run_1'
const CLIENT = 'cl_1'

const TIERS = [
  { id: 'general', name: 'General entry', capacity: null as number | null, priceCents: 20000 },
  { id: 'vip', name: 'VIP', capacity: null as number | null, priceCents: 12300 },
  { id: 'other', name: 'Other', capacity: null as number | null, priceCents: 8900 },
]

/** Wire the happy path: an open event with unlimited capacity and no history. */
function setup(over: {
  capacity?: number | null
  packageCapacity?: number | null
  allowWaitlist?: boolean
  tiers?: typeof TIERS
  /** Places already sold, per ticket type. */
  sold?: Record<string, number>
  /** How many are already in the room overall. */
  headcount?: number
  /** What this client already holds on this run. */
  held?: { id: string; ticketTierId: string | null; status: string; quantity: number }[]
  status?: string
} = {}) {
  h.runFindUnique.mockResolvedValue({
    id: RUN,
    packageId: 'pkg_1',
    status: over.status ?? 'SCHEDULED',
    capacity: over.capacity ?? null,
    package: {
      capacity: over.packageCapacity ?? null,
      allowWaitlist: over.allowWaitlist ?? false,
      allowDropIn: false,
    },
  })
  h.tierFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    (over.tiers ?? TIERS).filter(t => where.id.in.includes(t.id)))
  h.enrCount.mockResolvedValue(0)
  h.enrFindMany.mockResolvedValue(over.held ?? [])
  h.enrGroupBy.mockResolvedValue([])
  h.enrAggregate.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if (where.status === 'WAITLISTED') return { _max: { waitlistPosition: 4 } }
    if (where.ticketTierId) return { _sum: { quantity: over.sold?.[where.ticketTierId as string] ?? 0 } }
    // busiestSessionHeadcount's FULL aggregate
    return { _sum: { quantity: over.headcount ?? 0 } }
  })
  let n = 0
  h.enrCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `enr_${++n}`, ...data }))
  h.enrUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data }))
}

const enrol = (tickets: { ticketTierId: string; quantity: number }[]) =>
  enrollInRunTickets({ classRunId: RUN, clientId: CLIENT, tickets })

const createdRows = () => h.enrCreate.mock.calls.map(c => c[0].data)

beforeEach(() => {
  vi.clearAllMocks()
  h.transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx))
})

describe('enrollInRunTickets — several ticket types in one action', () => {
  it('books 3 general and 3 VIP as a row each, at the right total', async () => {
    setup()
    const r = await enrol([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'vip', quantity: 3 },
    ])

    expect(r.status).toBe('ENROLLED')
    expect(r.totalCents).toBe(96_900) // 3 × $200 + 3 × $123
    expect(r.lines).toEqual([
      { enrollmentId: 'enr_1', ticketTierId: 'general', ticketName: 'General entry', quantity: 3, unitPriceCents: 20000 },
      { enrollmentId: 'enr_2', ticketTierId: 'vip', ticketName: 'VIP', quantity: 3, unitPriceCents: 12300 },
    ])

    const rows = createdRows()
    expect(rows).toHaveLength(2)
    expect(rows.map(row => [row.ticketTierId, row.quantity])).toEqual([['general', 3], ['vip', 3]])
    // One action, one group — that's what keeps it to ONE invoice with a line
    // per ticket type instead of an invoice each.
    expect(rows[0].ticketGroupId).toEqual(rows[1].ticketGroupId)
    expect(rows[0].ticketGroupId).toBe(r.groupId)
    expect(rows.every(row => row.type === 'FULL' && row.status === 'ENROLLED')).toBe(true)
  })

  it('ignores a type left at zero rather than writing an empty row', async () => {
    setup()
    await enrol([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'other', quantity: 0 },
      { ticketTierId: 'vip', quantity: 3 },
    ])
    expect(createdRows().map(r => r.ticketTierId)).toEqual(['general', 'vip'])
  })

  it('refuses an enrolment of nothing at all', async () => {
    setup()
    await expect(enrol([])).rejects.toMatchObject({ code: 'NO_TICKETS' })
    await expect(enrol([{ ticketTierId: 'vip', quantity: 0 }])).rejects.toMatchObject({ code: 'NO_TICKETS' })
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.enrCreate).not.toHaveBeenCalled()
  })

  // The whole point of doing this in one transaction: money has been quoted for
  // six tickets, so five booked tickets and an error is the worst outcome.
  it('refuses the WHOLE basket when one ticket type has not got room', async () => {
    setup({ tiers: [{ ...TIERS[0], capacity: 50 }, { ...TIERS[1], capacity: 4 }, TIERS[2]], sold: { vip: 2 } })
    await expect(enrol([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'vip', quantity: 3 },
    ])).rejects.toMatchObject({ code: 'TICKET_FULL' })
    // Not one row — not even the general tickets that would have fitted.
    expect(h.enrCreate).not.toHaveBeenCalled()
    expect(h.enrUpdate).not.toHaveBeenCalled()
  })

  it('names the ticket type and what is left when it refuses', async () => {
    setup({ tiers: [TIERS[0], { ...TIERS[1], capacity: 4 }, TIERS[2]], sold: { vip: 2 } })
    await expect(enrol([{ ticketTierId: 'vip', quantity: 3 }]))
      .rejects.toThrow('Only 2 VIP tickets left')

    vi.clearAllMocks()
    h.transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx))
    setup({ tiers: [TIERS[0], { ...TIERS[1], capacity: 4 }, TIERS[2]], sold: { vip: 4 } })
    await expect(enrol([{ ticketTierId: 'vip', quantity: 1 }]))
      .rejects.toThrow('VIP tickets are sold out')
  })

  // Each tier caps itself INDEPENDENTLY of the event's overall capacity: an
  // event with 100 places can still have only 4 early-bird tickets.
  it('checks each type against its own cap, not the event’s', async () => {
    setup({ capacity: 100, tiers: [TIERS[0], { ...TIERS[1], capacity: 20 }, TIERS[2]], sold: { vip: 19 } })
    await expect(enrol([{ ticketTierId: 'vip', quantity: 2 }])).rejects.toMatchObject({ code: 'TICKET_FULL' })
    await expect(enrol([{ ticketTierId: 'vip', quantity: 1 }])).resolves.toMatchObject({ status: 'ENROLLED' })
  })

  // …and the total across the types still has to fit the room, however roomy
  // each individual ticket type is.
  it('refuses when the types fit individually but the party does not fit the event', async () => {
    setup({ capacity: 10, headcount: 6 })
    await expect(enrol([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'vip', quantity: 3 },
    ])).rejects.toMatchObject({ code: 'FULL' })
    expect(h.enrCreate).not.toHaveBeenCalled()
  })

  it('fits the party into exactly the places left', async () => {
    setup({ capacity: 10, headcount: 4 })
    await expect(enrol([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'vip', quantity: 3 },
    ])).resolves.toMatchObject({ status: 'ENROLLED' })
  })

  it('waitlists the party as ONE party when the event has a waitlist', async () => {
    setup({ capacity: 10, headcount: 9, allowWaitlist: true })
    const r = await enrol([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'vip', quantity: 3 },
    ])
    expect(r.status).toBe('WAITLISTED')
    // One position for the group, not three people at three places in the queue.
    expect(createdRows().map(row => row.waitlistPosition)).toEqual([5, 5])
  })

  // A tier id alone must never be enough to bill against another event's — or
  // another trainer's — ticket. The lookup is scoped to this run's offering, so
  // a stranger id simply doesn't come back, and that's a refusal not a skip.
  it('rejects a ticket type from another event, taking the basket with it', async () => {
    setup()
    await expect(enrol([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'someone_elses_vip', quantity: 3 },
    ])).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
    expect(h.enrCreate).not.toHaveBeenCalled()
  })

  it('scopes the ticket lookup to this run’s own offering', async () => {
    setup()
    await enrol([{ ticketTierId: 'vip', quantity: 1 }])
    expect(h.tierFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ packageId: 'pkg_1' }),
    }))
  })

  it('will not sell into a cancelled or finished event', async () => {
    setup({ status: 'CANCELLED' })
    await expect(enrol([{ ticketTierId: 'vip', quantity: 1 }])).rejects.toMatchObject({ code: 'RUN_CLOSED' })
  })

  it('refuses a type they already hold rather than silently topping it up', async () => {
    setup({ held: [{ id: 'enr_old', ticketTierId: 'vip', status: 'ENROLLED', quantity: 2 }] })
    await expect(enrol([
      { ticketTierId: 'general', quantity: 3 },
      { ticketTierId: 'vip', quantity: 3 },
    ])).rejects.toMatchObject({ code: 'ALREADY_ENROLLED' })
    expect(h.enrCreate).not.toHaveBeenCalled()
  })

  // Holding General is not a reason to refuse them VIP — they're two purchases
  // at two prices, which is the whole point of ticket types.
  it('lets them add a type they do not already hold', async () => {
    setup({ held: [{ id: 'enr_old', ticketTierId: 'general', status: 'ENROLLED', quantity: 2 }] })
    const r = await enrol([{ ticketTierId: 'vip', quantity: 3 }])
    expect(r.status).toBe('ENROLLED')
    expect(createdRows().map(row => row.ticketTierId)).toEqual(['vip'])
  })

  it('reuses a withdrawn row for the same type instead of stacking a duplicate', async () => {
    setup({ held: [{ id: 'enr_old', ticketTierId: 'vip', status: 'WITHDRAWN', quantity: 1 }] })
    await enrol([{ ticketTierId: 'vip', quantity: 3 }])
    expect(h.enrCreate).not.toHaveBeenCalled()
    expect(h.enrUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'enr_old' },
      data: expect.objectContaining({ quantity: 3, status: 'ENROLLED', withdrawnAt: null }),
    }))
  })

  it('refuses tickets on top of a pre-ticket enrolment in the same event', async () => {
    setup({ held: [{ id: 'enr_old', ticketTierId: null, status: 'ENROLLED', quantity: 1 }] })
    await expect(enrol([{ ticketTierId: 'vip', quantity: 1 }])).rejects.toMatchObject({ code: 'ALREADY_ENROLLED' })
  })

  it('refuses tickets while they hold drop-in bookings on the same run', async () => {
    setup()
    h.enrCount.mockResolvedValue(2)
    await expect(enrol([{ ticketTierId: 'vip', quantity: 1 }])).rejects.toMatchObject({ code: 'ALREADY_ENROLLED' })
    expect(h.enrCreate).not.toHaveBeenCalled()
  })

  it('throws ClassError, so the route can map it to a 409 rather than a 500', async () => {
    setup({ status: 'COMPLETED' })
    await expect(enrol([{ ticketTierId: 'vip', quantity: 1 }])).rejects.toBeInstanceOf(ClassError)
  })
})
