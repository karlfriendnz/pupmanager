import { it, expect, vi, beforeEach, describe } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A trainer booking a client in charged a DIFFERENT price from the client
// booking themselves.
//
// The client route (api/my/classes/[runId]/enroll) has always called
// quoteOfferingDiscount and scaled the charge down by whatever qualified —
// whole-week, multi-day, second-dog, early-bird. The trainer route
// (api/class-runs/[runId]/enrollments) never touched the discount engine at
// all: it raised the receivable straight off the package price. Same class,
// same client, same five days — two prices, and the trainer's own invoice was
// the wrong one.
//
// These tests pin the three things that fix has to keep true:
//   1. the trainer path applies the SAME discount the client path does,
//   2. a basket-shaped rule fires when the days are booked together,
//   3. an invoice the trainer has already decided on is never re-priced.
const h = vi.hoisted(() => ({
  enrFindMany: vi.fn(),
  enrFindFirst: vi.fn(),
  discountFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceCreate: vi.fn(),
  trainerFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    classEnrollment: { findMany: h.enrFindMany, findFirst: h.enrFindFirst },
    discount: { findMany: h.discountFindMany },
    trainingSession: { findMany: h.sessionFindMany },
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

import { quoteEnrollmentDiscounts } from '@/lib/discounts/booking-discount'
import { quoteOfferingDiscount } from '@/lib/discounts/quote'
import { createInvoiceForAssignment } from '@/lib/invoicing'

const TRAINER = 'tr_1'
const CLIENT = 'cl_1'
const DAY_RATE = 5000

/** A daycare-shaped offering: priced per session, no whole-course price. */
const DAYCARE_PKG = { priceCents: null, specialPriceCents: null, dropInPriceCents: DAY_RATE, allowDropIn: true }

/** One booked day, as the pricing + discount lookup reads it. */
function bookedDay(n: number, over: Record<string, unknown> = {}) {
  return {
    id: `enr_${n}`,
    dogId: 'dog_1',
    type: 'DROP_IN',
    quantity: 1,
    joinedAtIndex: null,
    ticketTier: null,
    dropInSession: {
      scheduledAt: new Date(`2026-08-0${n}T09:00:00.000Z`),
      packageSessionSlot: { priceCents: DAY_RATE, specialPriceCents: null },
    },
    classRun: { id: 'run_1', name: 'Daycare', packageId: 'pkg_1', package: DAYCARE_PKG },
    ...over,
  }
}

/**
 * "Book 5 days, get 20% off" — the shape of rule that only ever fires when the
 * WHOLE basket is evaluated at once. Quote the days one at a time and this
 * silently never applies, which is precisely how the trainer path overcharged.
 */
const FIVE_DAY_RULE = {
  id: 'disc_1',
  name: 'Full week',
  formText: null,
  isActive: true,
  validFrom: null,
  expiresAt: null,
  modifierType: 'PERCENT' as const,
  modifierValue: 20,
  applyTo: 'order_total',
  conditions: [{ key: 'booked_day_count_min', operator: '>=', value: 5 }],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.discountFindMany.mockResolvedValue([FIVE_DAY_RULE])
  h.sessionFindMany.mockResolvedValue([])
  h.invoiceFindFirst.mockResolvedValue(null)
  h.invoiceCreate.mockResolvedValue({ id: 'inv_1', payToken: 'tok' })
  h.trainerFindUnique.mockResolvedValue({
    autoSendInvoices: false, payoutCurrency: 'nzd', businessName: 'Pups',
    sandboxBilling: false, xeroConnection: null,
  })
})

const quoteDays = (n: number) => {
  const rows = Array.from({ length: n }, (_, i) => bookedDay(i + 1))
  h.enrFindMany.mockResolvedValue(rows)
  return quoteEnrollmentDiscounts({ trainerId: TRAINER, clientId: CLIENT, enrollmentIds: rows.map(r => r.id) })
}

describe('a basket-shaped discount fires when the days are booked together', () => {
  it('applies the whole-week rule to five days booked in one action', async () => {
    const q = await quoteDays(5)
    // 5 × $50 = $250, less 20%.
    expect(q.discountTotal).toBe(5000)
  })

  it('does not apply it to two days — the rule genuinely does not qualify', async () => {
    const q = await quoteDays(2)
    expect(q.discountTotal).toBe(0)
  })

  it('would never have fired if the days were quoted one at a time', async () => {
    // The regression guard for the whole design: quoting each booked day on its
    // own sees dayCount = 1 every time, so a 5-day rule can never qualify.
    const singles = await Promise.all([1, 2, 3, 4, 5].map(async (n) => {
      h.enrFindMany.mockResolvedValue([bookedDay(n)])
      const q = await quoteEnrollmentDiscounts({ trainerId: TRAINER, clientId: CLIENT, enrollmentIds: [`enr_${n}`] })
      return q.discountTotal
    }))
    expect(singles).toEqual([0, 0, 0, 0, 0])
  })

  it('splits the saving across the days so the shares add back up exactly', async () => {
    const q = await quoteDays(5)
    const shares = Object.values(q.perEnrollment)
    expect(shares).toHaveLength(5)
    expect(shares.reduce((s, a) => s + a, 0)).toBe(q.discountTotal)
    expect(shares.every(s => s >= 0)).toBe(true)
  })

  it('a rule that is switched off changes nothing', async () => {
    h.discountFindMany.mockResolvedValue([])
    const q = await quoteDays(5)
    expect(q.discountTotal).toBe(0)
    expect(q.perEnrollment).toEqual({})
  })
})

describe('the trainer path prices identically to the client path', () => {
  it('quotes the same total the client checkout quotes for the same basket', async () => {
    // What the CLIENT route feeds the engine for the same booking: one dog,
    // five sessions at the day rate, on those five dates.
    const dates = [1, 2, 3, 4, 5].map(n => new Date(`2026-08-0${n}T09:00:00.000Z`).toISOString())
    const clientSide = await quoteOfferingDiscount({
      trainerId: TRAINER,
      packageId: 'pkg_1',
      dogCount: 1,
      perDogAmounts: Array(5).fill(DAY_RATE),
      dates,
    })

    const trainerSide = await quoteDays(5)

    expect(trainerSide.discountTotal).toBe(clientSide.discountTotal)
    expect(trainerSide.discountTotal).toBeGreaterThan(0)
  })

  it('scales the group size the same way when several dogs go in together', async () => {
    // Two dogs, five days each. The engine builds one subject per dog, so the
    // saving doubles — the client route's dogCount does exactly this.
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => bookedDay(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => bookedDay(i + 1, { id: `enr_b${i + 1}`, dogId: 'dog_2' })),
    ]
    h.enrFindMany.mockResolvedValue(rows)
    const q = await quoteEnrollmentDiscounts({
      trainerId: TRAINER, clientId: CLIENT, enrollmentIds: rows.map(r => r.id),
    })
    expect(q.discountTotal).toBe(10_000)
  })
})

describe('the discount lands on the invoice', () => {
  const enrolmentRow = {
    type: 'DROP_IN',
    joinedAtIndex: 1,
    quantity: 1,
    ticketGroupId: null,
    ticketTier: null,
    dropInSession: { packageSessionSlot: { priceCents: DAY_RATE, specialPriceCents: null } },
    classRun: { id: 'run_1', name: 'Daycare', package: DAYCARE_PKG },
  }
  const created = () => h.invoiceCreate.mock.calls[0][0].data

  const raise = (discountCents?: number) => createInvoiceForAssignment({
    trainerId: TRAINER, clientId: CLIENT, sourceType: 'CLASS_ENROLLMENT',
    classEnrollmentId: 'enr_1', discountCents, notifyClient: false,
  })

  beforeEach(() => { h.enrFindFirst.mockResolvedValue(enrolmentRow) })

  it('bills the full price when nothing qualifies', async () => {
    await raise()
    expect(created().amountCents).toBe(DAY_RATE)
  })

  it('bills the discounted price when the booking earned one', async () => {
    await raise(1000)
    expect(created().amountCents).toBe(4000)
    expect(created().lines.create[0].amountCents).toBe(4000)
    expect(created().lines.create[0].unitAmountCents).toBe(4000)
  })

  it('never writes a negative line — the receivables editor rejects those', async () => {
    // A discount bigger than the price wipes the receivable out rather than
    // producing a line the trainer can no longer save.
    expect(await raise(999_999)).toBeNull()
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('says on the invoice that a discount was taken off', async () => {
    await raise(1000)
    expect(created().description).toContain('discount')
  })
})

describe('a price the trainer has already decided still wins', () => {
  it('never re-prices an invoice that already exists', async () => {
    // There is no custom-price field on a class enrolment; the trainer's
    // override is editing the receivable in Finances. createInvoiceForAssignment
    // is idempotent on (trainer, client, source), so a re-run — including one
    // now carrying a discount — hands back the invoice they edited untouched
    // rather than raising a second, discounted one over the top of it.
    h.enrFindFirst.mockResolvedValue({
      type: 'FULL', joinedAtIndex: null, quantity: 1, ticketGroupId: null, ticketTier: null,
      dropInSession: null,
      classRun: {
        id: 'run_1', name: 'Six-week course',
        package: { priceCents: 18000, specialPriceCents: null, dropInPriceCents: null, allowDropIn: false },
      },
    })
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv_trainer_edited' })

    const id = await createInvoiceForAssignment({
      trainerId: TRAINER, clientId: CLIENT, sourceType: 'CLASS_ENROLLMENT',
      classEnrollmentId: 'enr_1', discountCents: 9000, notifyClient: false,
    })

    expect(id).toBe('inv_trainer_edited')
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })
})

describe('the trainer enrolment route is wired to the quoter', () => {
  // Cheap source-level guard: the divergence was an ABSENT call, and nothing in
  // a unit test of the helpers would notice it going absent again.
  const route = readFileSync(
    join(process.cwd(), 'src/app/api/class-runs/[runId]/enrollments/route.ts'),
    'utf8',
  )

  it('quotes the whole basket once, before raising the receivables', () => {
    expect(route).toContain('quoteEnrollmentDiscounts({')
    expect(route.indexOf('quoteEnrollmentDiscounts({')).toBeLessThan(route.indexOf('createInvoiceForAssignment({'))
  })

  it('passes the saving through to the invoice', () => {
    expect(route).toContain('discountCents')
  })
})
