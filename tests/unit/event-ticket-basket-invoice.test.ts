import { it, expect, vi, beforeEach, describe } from 'vitest'

// What a basket of event tickets looks like on the client's invoice.
//
// "3 general and 3 VIP" is two enrolment rows sharing a ticketGroupId. That must
// read as ONE invoice with a LINE PER TICKET TYPE — 3 × $200 and 3 × $123 —
// because two separate invoices for one purchase is not what anyone expects to
// receive, and a single lumped $969 line is a mystery. Every line prices off its
// own tier: charging the offering's flat price for a ticket is the live bug
// fixed in d736544.
const h = vi.hoisted(() => ({
  enrFindFirst: vi.fn(),
  enrFindMany: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceCreate: vi.fn(),
  trainerFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    classEnrollment: { findFirst: h.enrFindFirst, findMany: h.enrFindMany },
    clientPackage: { findFirst: vi.fn() },
    product: { findFirst: vi.fn() },
    invoice: { findFirst: h.invoiceFindFirst, create: h.invoiceCreate },
    trainerProfile: { findUnique: h.trainerFindUnique },
  },
}))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/push', () => ({ sendPush: vi.fn() }))
vi.mock('@/lib/xero-sync', () => ({ ensureClientXeroContact: vi.fn() }))
vi.mock('@/lib/xero', () => ({ createXeroInvoice: vi.fn(), createXeroPayment: vi.fn(), fetchXeroInvoiceState: vi.fn() }))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }))
vi.mock('next/server', async (orig) => ({ ...(await orig() as object), after: () => {} }))

import { createInvoiceForAssignment } from '@/lib/invoicing'

const TRAINER = 'tr_1'
const CLIENT = 'cl_1'
const GROUP = 'grp_1'

/** The two rows a "3 general + 3 VIP" enrolment writes. */
const GROUP_ROWS = [
  {
    id: 'enr_general',
    quantity: 3,
    ticketTier: { name: 'General entry', priceCents: 20000, xeroAccountCode: '200' },
  },
  {
    id: 'enr_vip',
    quantity: 3,
    ticketTier: { name: 'VIP', priceCents: 12300, xeroAccountCode: '201' },
  },
]

function enrolment(over: Record<string, unknown> = {}) {
  return {
    type: 'FULL',
    joinedAtIndex: null,
    quantity: 3,
    ticketGroupId: GROUP,
    ticketTier: { name: 'General entry', priceCents: 20000 },
    dropInSession: null,
    classRun: {
      name: 'Summer Fun Day',
      // The offering's flat price — deliberately nothing like the tickets, as it
      // is on the event that got reported.
      package: { priceCents: 4500, specialPriceCents: null, dropInPriceCents: null },
    },
    ...over,
  }
}

const raise = (enrollmentId: string) => createInvoiceForAssignment({
  trainerId: TRAINER, clientId: CLIENT, sourceType: 'CLASS_ENROLLMENT',
  classEnrollmentId: enrollmentId, notifyClient: false,
})

const created = () => h.invoiceCreate.mock.calls[0][0].data
const lines = () => created().lines.create

beforeEach(() => {
  vi.clearAllMocks()
  h.invoiceFindFirst.mockResolvedValue(null)
  h.invoiceCreate.mockResolvedValue({ id: 'inv_1', payToken: 'tok' })
  h.enrFindMany.mockResolvedValue(GROUP_ROWS)
  h.trainerFindUnique.mockResolvedValue({
    autoSendInvoices: false, payoutCurrency: 'nzd', businessName: 'Pawsome',
    sandboxBilling: false, xeroConnection: null,
  })
})

describe('createInvoiceForAssignment — a basket of ticket types', () => {
  it('writes one line per ticket type, each at its own price', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment())
    await raise('enr_general')

    expect(lines()).toEqual([
      {
        description: 'Summer Fun Day (General entry × 3)',
        quantity: 3,
        unitAmountCents: 20000,
        amountCents: 60000,
        xeroAccountCode: '200',
        sortOrder: 0,
      },
      {
        description: 'Summer Fun Day (VIP × 3)',
        quantity: 3,
        unitAmountCents: 12300,
        amountCents: 36900,
        xeroAccountCode: '201',
        sortOrder: 1,
      },
    ])
  })

  it('totals the basket, not one ticket and not the offering price', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment())
    await raise('enr_general')
    expect(created().amountCents).toBe(96_900) // 3 × $200 + 3 × $123
    expect(created().description).toBe('Summer Fun Day (6 tickets)')
  })

  // Whichever row of the basket asks for the invoice, it's the same invoice —
  // it hangs off the first row of the group.
  it('hangs the invoice off the first row of the group, whichever asked', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment())
    await raise('enr_vip')
    expect(created().sourceId).toBe('enr_general')
  })

  // The route raises the invoice per booked row. The second call must find the
  // first call's invoice — otherwise one purchase bills twice.
  it('does not raise a second invoice for the other rows of the basket', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment())
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv_1' })

    expect(await raise('enr_vip')).toBe('inv_1')
    expect(h.invoiceCreate).not.toHaveBeenCalled()
    // Idempotency is checked across EVERY row of the group, not just this one.
    expect(h.invoiceFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sourceId: { in: ['enr_general', 'enr_vip'] } }),
    }))
  })

  it('a free ticket type in the basket adds a zero line, not a wrong one', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment())
    h.enrFindMany.mockResolvedValue([
      GROUP_ROWS[0],
      { id: 'enr_vol', quantity: 2, ticketTier: { name: 'Volunteer', priceCents: null, xeroAccountCode: null } },
    ])
    await raise('enr_general')
    expect(created().amountCents).toBe(60000)
    expect(lines()[1]).toMatchObject({ description: 'Summer Fun Day (Volunteer × 2)', unitAmountCents: 0, amountCents: 0 })
  })

  // A group of one is just a single ticket — it must behave exactly as it did
  // before baskets existed.
  it('leaves a single ticket type on the old single-line path', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment({ quantity: 2, ticketTier: { name: 'VIP', priceCents: 12300 } }))
    h.enrFindMany.mockResolvedValue([GROUP_ROWS[1]])
    await raise('enr_vip')
    expect(created().amountCents).toBe(24600)
    expect(created().description).toBe('Summer Fun Day (VIP × 2)')
    expect(lines()).toHaveLength(1)
  })

  it('never looks for a group when the enrolment has none', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment({ ticketGroupId: null, quantity: 1, ticketTier: { name: 'VIP', priceCents: 12300 } }))
    await raise('enr_vip')
    expect(h.enrFindMany).not.toHaveBeenCalled()
    expect(created().amountCents).toBe(12300)
    expect(lines()).toHaveLength(1)
  })
})
