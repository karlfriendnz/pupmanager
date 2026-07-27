import { it, expect, vi, beforeEach, describe } from 'vitest'

// A CASUAL class carries its price per session: the trainer types it into the
// session row, and it lands on the package as `dropInPriceCents` (and on the
// slot). There is no whole-course price, so `priceCents` stays null.
//
// Enrol someone as FULL on such a class and invoicing used to read
// `specialPriceCents ?? priceCents` — null — and refuse with "Nothing to
// invoice — this class has no price set", while the price sat on screen in the
// price box. A live customer could not bill a casual class at all.
//
// Verified in production at the time: the run had priceCents NULL,
// specialPriceCents NULL, dropInPriceCents 3000, slot price 3000, and one FULL
// enrolment.
const h = vi.hoisted(() => ({
  enrFindFirst: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceCreate: vi.fn(),
  trainerFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    classEnrollment: { findFirst: h.enrFindFirst, findMany: vi.fn().mockResolvedValue([]) },
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

/** A casual class as the pricing lookup sees it: price per session only. */
function casualEnrolment(over: Record<string, unknown> = {}) {
  return {
    type: 'FULL',
    joinedAtIndex: null,
    quantity: 1,
    ticketGroupId: null,
    ticketTier: null,
    dropInSession: null,
    classRun: {
      name: 'Mantrailing Progression | Mersea Island',
      package: { priceCents: null, specialPriceCents: null, dropInPriceCents: 3000, sessionSlots: [] },
    },
    ...over,
  }
}

const raise = () => createInvoiceForAssignment({
  trainerId: TRAINER, clientId: CLIENT, sourceType: 'CLASS_ENROLLMENT',
  classEnrollmentId: ENROLMENT, notifyClient: false,
})

const created = () => h.invoiceCreate.mock.calls[0][0].data

beforeEach(() => {
  vi.clearAllMocks()
  h.invoiceFindFirst.mockResolvedValue(null)
  h.invoiceCreate.mockResolvedValue({ id: 'inv_1', payToken: 'tok' })
  h.trainerFindUnique.mockResolvedValue({
    autoSendInvoices: false, payoutCurrency: 'gbp', businessName: 'Mersea Mutts',
    sandboxBilling: false, xeroConnection: null,
  })
})

describe('invoicing a casual class', () => {
  it('bills the per-session price when there is no whole-course price', async () => {
    h.enrFindFirst.mockResolvedValue(casualEnrolment())
    const id = await raise()
    expect(id, 'the invoice must be raised, not refused').toBe('inv_1')
    expect(created().amountCents).toBe(3000)
  })

  it('still prefers a real course price when the class has one', async () => {
    // A normal class with both set must not start billing the drop-in rate.
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        name: 'Six-week course',
        package: { priceCents: 18000, specialPriceCents: null, dropInPriceCents: 3000, sessionSlots: [] },
      },
    }))
    await raise()
    expect(created().amountCents).toBe(18000)
  })

  it('a special price still wins over both', async () => {
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        name: 'Six-week course',
        package: { priceCents: 18000, specialPriceCents: 15000, dropInPriceCents: 3000, sessionSlots: [] },
      },
    }))
    await raise()
    expect(created().amountCents).toBe(15000)
  })

  it('a genuinely free class still raises nothing', async () => {
    // The refusal is correct when there is truly no price anywhere — that
    // behaviour must survive the fallback.
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        name: 'Free taster',
        package: { priceCents: null, specialPriceCents: null, dropInPriceCents: null, sessionSlots: [] },
      },
    }))
    expect(await raise()).toBeNull()
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('bills per-session price × quantity', async () => {
    h.enrFindFirst.mockResolvedValue(casualEnrolment({ quantity: 3 }))
    await raise()
    expect(created().amountCents).toBe(9000)
  })
})

describe('a FULL seat on a casual class is the whole run, not one session', () => {
  // The direct cost of the fallback above. A full-run enrolment was billed the
  // PER-SESSION price once, so a six-week casual class invoiced for one session.
  // Same customer reported it: "enrolling a client onto a casual class with
  // full run selected only charges for one session".
  const slots = (...prices: (number | null)[]) =>
    prices.map(p => ({ priceCents: p, specialPriceCents: null }))

  it('sums every session in the run', async () => {
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        name: 'Six-week mantrailing',
        package: {
          priceCents: null, specialPriceCents: null, dropInPriceCents: 3000,
          sessionSlots: slots(3000, 3000, 3000, 3000, 3000, 3000),
        },
      },
    }))
    await raise()
    expect(created().amountCents).toBe(18000) // not 3000
  })

  it('honours a session priced differently from the rest', async () => {
    // A casual class sets a price per session row, so they need not agree.
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        name: 'Three sessions, one dearer',
        package: {
          priceCents: null, specialPriceCents: null, dropInPriceCents: 3000,
          sessionSlots: [
            { priceCents: 3000, specialPriceCents: null },
            { priceCents: 4500, specialPriceCents: null },
            { priceCents: 3000, specialPriceCents: 2500 },
          ],
        },
      },
    }))
    await raise()
    expect(created().amountCents).toBe(10_000) // 3000 + 4500 + 2500
  })

  it('falls back to the package per-session price for a slot with none', async () => {
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        name: 'Two sessions, one unpriced',
        package: {
          priceCents: null, specialPriceCents: null, dropInPriceCents: 3000,
          sessionSlots: slots(4000, null),
        },
      },
    }))
    await raise()
    expect(created().amountCents).toBe(7000) // 4000 + the package's 3000
  })

  it('a DROP_IN still pays for the one session they booked', async () => {
    // The whole point of the distinction — this must not start billing the run.
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      type: 'DROP_IN',
      joinedAtIndex: 2,
      dropInSession: { packageSessionSlot: { priceCents: 3000, specialPriceCents: null } },
      classRun: {
        name: 'Six-week mantrailing',
        package: {
          priceCents: null, specialPriceCents: null, dropInPriceCents: 3000,
          sessionSlots: slots(3000, 3000, 3000, 3000, 3000, 3000),
        },
      },
    }))
    await raise()
    expect(created().amountCents).toBe(3000)
  })

  it('a free casual class with priced-nothing slots still raises no invoice', async () => {
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        name: 'Free taster series',
        package: {
          priceCents: null, specialPriceCents: null, dropInPriceCents: null,
          sessionSlots: slots(null, null),
        },
      },
    }))
    expect(await raise()).toBeNull()
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('a real course price still beats the sum of sessions', async () => {
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        name: 'Priced course that also lists sessions',
        package: {
          priceCents: 15000, specialPriceCents: null, dropInPriceCents: 3000,
          sessionSlots: slots(3000, 3000, 3000, 3000, 3000, 3000),
        },
      },
    }))
    await raise()
    expect(created().amountCents).toBe(15000)
  })
})
