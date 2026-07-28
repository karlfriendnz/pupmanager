import { it, expect, vi, beforeEach, describe } from 'vitest'

// A CASUAL class carries its price per session: the trainer types it into the
// session row, and it lands on the package as `dropInPriceCents` (and on the
// slot). There is no whole-course price, so `priceCents` stays null — the
// pricing card is hidden on a casual class's edit form.
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
  sessionFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    classEnrollment: { findFirst: h.enrFindFirst, findMany: vi.fn().mockResolvedValue([]) },
    clientPackage: { findFirst: vi.fn() },
    product: { findFirst: vi.fn() },
    invoice: { findFirst: h.invoiceFindFirst, create: h.invoiceCreate },
    trainerProfile: { findUnique: h.trainerFindUnique },
    trainingSession: { findMany: h.sessionFindMany },
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
      id: 'run_1',
      name: 'Mantrailing Progression | Mersea Island',
      package: { priceCents: null, specialPriceCents: null, dropInPriceCents: 3000, allowDropIn: true },
    },
    ...over,
  }
}

/** The run's sessions, as the whole-run price reads them. */
function runSessions(n: number, slot: { priceCents: number | null; specialPriceCents: number | null } | null = null) {
  return Array.from({ length: n }, () => ({ packageSessionSlot: slot }))
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
  // Default: a single-session run, so a test that says nothing about the
  // schedule bills one session.
  h.sessionFindMany.mockResolvedValue(runSessions(1))
  h.enrFindFirst.mockResolvedValue(casualEnrolment())
})

describe('a casual class can be invoiced at all', () => {
  it('bills the per-session price when that is the only price there is', async () => {
    await raise()
    expect(created().amountCents).toBe(3000)
  })

  it('a course price still wins on an ordinary class', async () => {
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        id: 'run_1',
        name: 'Six-week course',
        package: { priceCents: 18000, specialPriceCents: 15000, dropInPriceCents: 3000, allowDropIn: false },
      },
    }))
    await raise()
    expect(created().amountCents).toBe(15000)
  })

  it('a genuinely free class still raises nothing', async () => {
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        id: 'run_1',
        name: 'Free taster',
        package: { priceCents: null, specialPriceCents: null, dropInPriceCents: null, allowDropIn: true },
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
  // The customer's actual class: twelve sessions at $150, no slot schedule at
  // all. e12c323 summed the package's SLOTS — of which there are none — so it
  // came back with one session's rate and invoiced $150 instead of $1,800.
  it('bills every session of a class with no slot schedule', async () => {
    h.sessionFindMany.mockResolvedValue(runSessions(12))
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        id: 'run_1',
        name: 'New Casual Class',
        package: { priceCents: null, specialPriceCents: null, dropInPriceCents: 15000, allowDropIn: true },
      },
    }))
    await raise()
    expect(created().amountCents).toBe(180000) // not 15000
  })

  // A slot is a recurring template, not a session: two weekly slots over six
  // weeks are twelve sessions, and the run costs all twelve.
  it('counts sessions, not the slots they came from', async () => {
    h.sessionFindMany.mockResolvedValue([
      ...runSessions(6, { priceCents: 3000, specialPriceCents: null }),
      ...runSessions(6, { priceCents: 4000, specialPriceCents: null }),
    ])
    await raise()
    expect(created().amountCents).toBe(42000) // not 7000
  })

  // A stale priceCents left over from before the class became a casual one is
  // invisible to the trainer — it must not be billed.
  it('ignores a stale course price on a per-session class', async () => {
    h.sessionFindMany.mockResolvedValue(runSessions(12))
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        id: 'run_1',
        name: 'New Casual Class',
        package: { priceCents: 15000, specialPriceCents: null, dropInPriceCents: 15000, allowDropIn: true },
      },
    }))
    await raise()
    expect(created().amountCents).toBe(180000)
  })

  it('honours a session priced differently from the rest', async () => {
    h.sessionFindMany.mockResolvedValue([
      ...runSessions(1, { priceCents: 3000, specialPriceCents: null }),
      ...runSessions(1, { priceCents: 4500, specialPriceCents: null }),
      ...runSessions(1, { priceCents: 3000, specialPriceCents: 2500 }),
    ])
    await raise()
    expect(created().amountCents).toBe(10_000)
  })

  it('falls back to the package per-session price for a session with none', async () => {
    h.sessionFindMany.mockResolvedValue([
      ...runSessions(1, { priceCents: 4000, specialPriceCents: null }),
      ...runSessions(1, null),
    ])
    await raise()
    expect(created().amountCents).toBe(7000) // 4000 + the package's 3000
  })

  it('a DROP_IN still pays for the one session they booked', async () => {
    // The whole point of the distinction — this must not start billing the run.
    h.sessionFindMany.mockResolvedValue(runSessions(6, { priceCents: 3000, specialPriceCents: null }))
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      type: 'DROP_IN',
      joinedAtIndex: 2,
      dropInSession: { packageSessionSlot: { priceCents: 3000, specialPriceCents: null } },
    }))
    await raise()
    expect(created().amountCents).toBe(3000)
  })

  it('a free casual class with priced-nothing sessions still raises no invoice', async () => {
    h.sessionFindMany.mockResolvedValue(runSessions(6, { priceCents: null, specialPriceCents: null }))
    h.enrFindFirst.mockResolvedValue(casualEnrolment({
      classRun: {
        id: 'run_1',
        name: 'Free taster series',
        package: { priceCents: null, specialPriceCents: null, dropInPriceCents: null, allowDropIn: true },
      },
    }))
    expect(await raise()).toBeNull()
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })
})
