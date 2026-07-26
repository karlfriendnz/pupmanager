import { it, expect, vi, beforeEach, describe } from 'vitest'

// What an event enrolment actually costs. It used to price off the offering's
// single flat price, so someone booked onto a $123 VIP ticket was invoiced the
// $45 the package happened to carry — and two tickets were still billed once.
// The chosen ticket's price × how many were bought is the bill, and the invoice
// LINE has to show that (2 × $123) rather than one mystery $246 item.
const h = vi.hoisted(() => ({
  enrFindFirst: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceCreate: vi.fn(),
  trainerFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    classEnrollment: { findFirst: h.enrFindFirst },
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
const ENROLMENT = 'enr_1'

/** A class enrolment as the pricing lookup sees it. */
function enrolment(over: Record<string, unknown> = {}) {
  return {
    type: 'FULL',
    joinedAtIndex: null,
    quantity: 1,
    ticketTier: null,
    dropInSession: null,
    classRun: {
      name: 'Puppy Social',
      // The offering's flat price — deliberately different from the tickets, as
      // it is on the event that got reported.
      package: { priceCents: 4500, specialPriceCents: null, dropInPriceCents: null },
    },
    ...over,
  }
}

const raise = () => createInvoiceForAssignment({
  trainerId: TRAINER, clientId: CLIENT, sourceType: 'CLASS_ENROLLMENT',
  classEnrollmentId: ENROLMENT, notifyClient: false,
})

/** The single line the created invoice carries. */
const createdLine = () => h.invoiceCreate.mock.calls[0][0].data.lines.create[0]
const created = () => h.invoiceCreate.mock.calls[0][0].data

beforeEach(() => {
  vi.clearAllMocks()
  h.invoiceFindFirst.mockResolvedValue(null)
  h.invoiceCreate.mockResolvedValue({ id: 'inv_1', payToken: 'tok' })
  h.trainerFindUnique.mockResolvedValue({
    autoSendInvoices: false, payoutCurrency: 'nzd', businessName: 'Pawsome',
    sandboxBilling: false, xeroConnection: null,
  })
})

describe('createInvoiceForAssignment — event ticket pricing', () => {
  it('bills the ticket price, not the offering’s flat price', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment({ ticketTier: { name: 'VIP', priceCents: 12300 } }))
    await raise()
    expect(created().amountCents).toBe(12300)
    expect(created().description).toBe('Puppy Social (VIP)')
  })

  it('multiplies by how many tickets were bought', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment({ quantity: 2, ticketTier: { name: 'VIP', priceCents: 12300 } }))
    await raise()
    expect(created().amountCents).toBe(24600)
    expect(created().description).toBe('Puppy Social (VIP × 2)')
  })

  // A single $246 line reads as a mystery. The client has to see 2 × $123.
  it('writes the line as quantity × unit price', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment({ quantity: 3, ticketTier: { name: 'General', priceCents: 20000 } }))
    await raise()
    expect(createdLine()).toMatchObject({
      description: 'Puppy Social (General × 3)',
      quantity: 3,
      unitAmountCents: 20000,
      amountCents: 60000,
    })
  })

  it('raises nothing for a free ticket type', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment({ quantity: 2, ticketTier: { name: 'Volunteer', priceCents: 0 } }))
    expect(await raise()).toBeNull()
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('falls back to the offering price when no ticket type was chosen', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment())
    await raise()
    expect(created().amountCents).toBe(4500)
    expect(created().description).toBe('Puppy Social')
    expect(createdLine()).toMatchObject({ quantity: 1, unitAmountCents: 4500 })
  })

  // Class behaviour must be exactly what it was — quantity is 1 everywhere else.
  it('leaves a drop-in priced per session as before', async () => {
    h.enrFindFirst.mockResolvedValue(enrolment({
      type: 'DROP_IN',
      joinedAtIndex: 3,
      dropInSession: { packageSessionSlot: { priceCents: 2500, specialPriceCents: null } },
    }))
    await raise()
    expect(created().amountCents).toBe(2500)
    expect(created().description).toBe('Puppy Social (drop-in · session 3)')
  })
})
