import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// A client who self-enrols and pays by card is fulfilled by the connect
// webhook: it enrols them and stamps invoicedAt. It never raised a receivable.
// The roster reads an actual Invoice row to decide what to show, so a seat the
// client had already paid for came up as "No invoice" with a Create invoice
// button — and the trainer had to open Stripe, confirm the payment by hand and
// allocate it against the invoice they'd just made. The pay-LATER path has
// always raised one; this brings the paid path to parity and settles it.
const webhook = readFileSync('src/app/api/webhooks/stripe/connect/route.ts', 'utf8')
const invoicing = readFileSync('src/lib/invoicing.ts', 'utf8')

/** The body of settleClassEnrolmentPayment, wherever it sits in the file. */
function settleFn(): string {
  const i = invoicing.indexOf('export async function settleClassEnrolmentPayment')
  expect(i).toBeGreaterThan(-1)
  return invoicing.slice(i, i + 2200)
}

describe('a paid class enrolment leaves a receivable behind', () => {
  it('is invoked by the webhook once the enrolment is made', () => {
    expect(webhook).toContain('await settleClassEnrolmentPayment(')
  })

  it('raises the invoice for the enrolment it just created', () => {
    const fn = settleFn()
    expect(fn).toContain("sourceType: 'CLASS_ENROLLMENT'")
    expect(fn).toContain('classEnrollmentId: args.enrollmentId')
  })

  it('settles that invoice against the payment that already cleared', () => {
    expect(settleFn()).toContain('await settleInvoiceFromPayment(invoiceId, args.paymentId, paidForThisLine)')
  })

  // They paid at the checkout — a "here's your invoice" email would be wrong.
  it('does not email the client an invoice they have already paid', () => {
    expect(settleFn()).toContain('notifyClient: false')
  })

  // One card payment can cover several enrolments (two dogs, four drop-in
  // dates), each with its own receivable. Crediting each with the payment total
  // would report the same money several times over.
  it('credits each invoice with its own line, not the whole payment', () => {
    expect(settleFn()).toContain('item.unitAmount * item.quantity')
  })

  // The client has paid and is enrolled. Neither may be undone by a bookkeeping
  // failure throwing the webhook into a retry.
  it('never lets the bookkeeping fail the fulfilment', () => {
    const fn = settleFn()
    expect(fn).toContain('try {')
    expect(fn).toContain('catch (err)')
  })
})

// settleInvoiceFromPayment gained an explicit amount for that split. The
// pay-page case — one payment, one invoice — must be unchanged by it.
const h = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  invoiceUpdate: vi.fn(),
  paymentFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findUnique: h.invoiceFindUnique, update: h.invoiceUpdate },
    payment: { findUnique: h.paymentFindUnique },
  },
}))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/push', () => ({ sendPush: vi.fn() }))
vi.mock('@/lib/xero-sync', () => ({ ensureClientXeroContact: vi.fn() }))
vi.mock('@/lib/xero', () => ({ createXeroInvoice: vi.fn(), createXeroPayment: vi.fn(), fetchXeroInvoiceState: vi.fn() }))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }))
vi.mock('next/server', async (orig) => ({ ...(await orig() as object), after: () => {} }))

import { settleInvoiceFromPayment } from '@/lib/invoicing'

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.invoiceUpdate.mockResolvedValue({})
  h.invoiceFindUnique.mockResolvedValue({
    id: 'inv_1', amountCents: 3000, amountPaidCents: 0, status: 'SENT', paidAt: null, paymentId: null,
    currency: 'gbp', description: 'Mantrailing',
    trainer: { userId: 'u_tr' },
    client: { user: { name: 'Sarah' } },
  })
  h.paymentFindUnique.mockResolvedValue({
    id: 'pay_1',
    paidAt: new Date('2026-07-29T00:00:00.000Z'),
    // A payment covering TWO £30 enrolments.
    items: [
      { unitAmount: 3000, quantity: 1, intent: {} },
      { unitAmount: 3000, quantity: 1, intent: {} },
    ],
  })
})

describe('settleInvoiceFromPayment — splitting one payment across enrolments', () => {
  it('credits only the amount given, marking that one invoice paid', async () => {
    await settleInvoiceFromPayment('inv_1', 'pay_1', 3000)

    expect(h.invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inv_1' },
      data: expect.objectContaining({ amountPaidCents: 3000, status: 'PAID' }),
    }))
  })

  it('still credits the whole payment when no amount is given (the pay page)', async () => {
    h.invoiceFindUnique.mockResolvedValue({
      id: 'inv_1', amountCents: 6000, amountPaidCents: 0, status: 'SENT', paidAt: null, paymentId: null,
      currency: 'gbp', description: 'Mantrailing',
      trainer: { userId: 'u_tr' },
      client: { user: { name: 'Sarah' } },
    })

    await settleInvoiceFromPayment('inv_1', 'pay_1')

    expect(h.invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amountPaidCents: 6000, status: 'PAID' }),
    }))
  })

  // Webhook retries and duplicate deliveries land here more than once.
  it('leaves an already-paid invoice alone', async () => {
    h.invoiceFindUnique.mockResolvedValue({
      id: 'inv_1', amountCents: 3000, amountPaidCents: 3000, status: 'PAID', paidAt: new Date(), paymentId: 'pay_1',
      currency: 'gbp', description: 'Mantrailing',
      trainer: { userId: 'u_tr' },
      client: { user: { name: 'Sarah' } },
    })

    await settleInvoiceFromPayment('inv_1', 'pay_1', 3000)

    expect(h.invoiceUpdate).not.toHaveBeenCalled()
  })
})

// The fulfilment moved out of the webhook route and into invoicing so it can be
// driven without a Stripe round-trip — scripts/simulate-class-payment.ts calls
// the very same function the webhook does. A simulation that reimplements the
// code it's simulating proves nothing.
const sim = readFileSync('scripts/simulate-class-payment.ts', 'utf8')

describe('a paid enrolment can be exercised without Stripe', () => {
  it('the webhook and the simulator call one shared function', () => {
    expect(invoicing).toContain('export async function settleClassEnrolmentPayment')
    expect(webhook).toContain('await settleClassEnrolmentPayment(')
    expect(sim).toContain('await settleClassEnrolmentPayment(')
    expect(sim).toContain("from '../src/lib/class-runs'")
  })

  // next/server's after() throws outside a request scope, and it's called AFTER
  // the invoice row is written — so a script saw the row created and then an
  // exception, which reads as "no invoice was raised" when one was.
  it('runs its side effects inline when there is no request to defer to', () => {
    expect(invoicing).toContain('function deferSideEffects')
    expect(invoicing).not.toContain('    after(() => {')
  })

  // It fabricates PAID rows. Pointed at production that would be a fiction
  // nobody could untangle afterwards.
  it('refuses to run against anything but a local database', () => {
    expect(sim).toContain('REFUSING TO RUN')
    expect(sim).toContain("url.includes('localhost')")
  })
})
