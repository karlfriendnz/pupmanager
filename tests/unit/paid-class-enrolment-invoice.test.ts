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

describe('connect webhook — a paid class enrolment leaves a receivable behind', () => {
  it('raises the invoice for the enrolment it just created', () => {
    expect(webhook).toContain('sourceType: \'CLASS_ENROLLMENT\'')
    expect(webhook).toContain('classEnrollmentId: args.enrollmentId')
  })

  it('settles that invoice against the payment that already cleared', () => {
    expect(webhook).toContain('await settleInvoiceFromPayment(invoiceId, args.paymentId, paidForThisLine)')
  })

  // They paid at the checkout — a "here's your invoice" email would be wrong.
  it('does not email the client an invoice they have already paid', () => {
    expect(webhook).toContain('notifyClient: false')
  })

  // One card payment can cover several enrolments (two dogs, four drop-in
  // dates), each with its own receivable. Crediting each with the payment total
  // would report the same money several times over.
  it('credits each invoice with its own line, not the whole payment', () => {
    expect(webhook).toContain('item.unitAmount * item.quantity')
  })

  // The client has paid and is enrolled. Neither may be undone by a bookkeeping
  // failure throwing the webhook into a retry.
  it('never lets the bookkeeping fail the fulfilment', () => {
    const idx = webhook.indexOf('async function settleEnrolmentInvoice')
    expect(idx).toBeGreaterThan(-1)
    const block = webhook.slice(idx, webhook.indexOf('async function fulfilClassEnrolments'))
    expect(block).toContain('try {')
    expect(block).toContain('catch (err)')
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
