import { describe, it, expect, vi, beforeEach } from 'vitest'

// The recurring membership lifecycle: what a subscription, a paid cycle and a
// failed cycle DO to our rows.
//
// §10 of the plan asks for one assertion above all others: every handler, called
// TWICE with the same event, must produce the same result. Stripe re-delivers,
// retries, and does not guarantee order, so "called twice" is the normal case
// rather than the edge case. Each handler below has that test.

const h = vi.hoisted(() => ({
  purchaseFindUnique: vi.fn(),
  purchaseFindFirst: vi.fn(),
  purchaseUpdate: vi.fn(),
  purchaseUpdateMany: vi.fn(),
  consentFindFirst: vi.fn(),
  consentCreate: vi.fn(),
  consentUpdateMany: vi.fn(),
  invoiceFindUnique: vi.fn(),
  invoiceCreate: vi.fn(),
  invoiceUpdate: vi.fn(),
  invoiceUpsert: vi.fn(),
  paymentCreate: vi.fn(),
  planFindUnique: vi.fn(),
  trainerFindUnique: vi.fn(),
  clientFindUnique: vi.fn(),
  membershipFindUnique: vi.fn(),
  fulfilMembershipInTx: vi.fn(),
  enrolMembershipClasses: vi.fn(),
  notifyClient: vi.fn(),
  notifyTrainer: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const tx = {
    membershipPurchase: {
      findUnique: h.purchaseFindUnique,
      update: h.purchaseUpdate,
      updateMany: h.purchaseUpdateMany,
    },
    membershipPlan: { findUnique: h.planFindUnique },
    membershipConsent: { updateMany: h.consentUpdateMany },
    membershipInvoice: {
      findUnique: h.invoiceFindUnique,
      create: h.invoiceCreate,
      update: h.invoiceUpdate,
      upsert: h.invoiceUpsert,
    },
    payment: { create: h.paymentCreate },
  }
  return {
    prisma: {
      membershipPurchase: { findUnique: h.purchaseFindUnique, findFirst: h.purchaseFindFirst },
      membershipConsent: { findFirst: h.consentFindFirst, create: h.consentCreate },
      trainerProfile: { findUnique: h.trainerFindUnique },
      clientProfile: { findUnique: h.clientFindUnique },
      membership: { findUnique: h.membershipFindUnique },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  }
})
vi.mock('@/lib/memberships', () => ({
  fulfilMembershipInTx: h.fulfilMembershipInTx,
  enrolMembershipClasses: h.enrolMembershipClasses,
}))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))

import {
  ensureConsent,
  syncSubscription,
  recordInvoicePaid,
  recordInvoicePaymentFailed,
} from '@/lib/membership-billing'

const SUB_META = { membershipId: 'm1', trainerId: 't1', clientId: 'c1', planId: 'plan1', consentId: 'con1' }

function subscription(over: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    customer: 'cus_1',
    application_fee_percent: 0.85,
    metadata: SUB_META,
    items: { data: [{ current_period_start: 1_760_000_000, current_period_end: 1_762_592_000 }] },
    ...over,
  } as never
}

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: 'in_1',
    currency: 'nzd',
    amount_due: 4000,
    amount_paid: 4000,
    attempt_count: 1,
    period_start: 1_760_000_000,
    period_end: 1_762_592_000,
    hosted_invoice_url: 'https://pay.stripe.com/x',
    payments: { data: [{ payment: { payment_intent: 'pi_1' } }] },
    ...over,
  } as never
}

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.fulfilMembershipInTx.mockResolvedValue({ classGrants: [] })
  h.trainerFindUnique.mockResolvedValue({ connectAccountId: 'acct_1', businessName: 'E2E Dog School', user: { id: 'tu1' } })
  h.clientFindUnique.mockResolvedValue({ user: { id: 'cu1', name: 'Sarah' }, dog: { name: 'Bailey' } })
  h.membershipFindUnique.mockResolvedValue({ name: 'Starter Bundle' })
  h.planFindUnique.mockResolvedValue({ minTermCount: 0, interval: 'MONTH' })
  h.notifyClient.mockResolvedValue(undefined)
  h.notifyTrainer.mockResolvedValue(undefined)
})

describe('ensureConsent', () => {
  it('reuses a recent unconsumed consent so a double-tap yields ONE subscription', async () => {
    // This reuse is what makes the outbound Stripe idempotency key stable. Two
    // taps → one consent id → one key → Stripe collapses them. Without it the
    // client is billed twice every month, forever, until somebody notices.
    h.consentFindFirst.mockResolvedValue({ id: 'con_existing' })
    const res = await ensureConsent({
      clientId: 'c1', membershipId: 'm1', planId: 'plan1', priceCents: 4000,
      currency: 'nzd', interval: 'MONTH', consentText: 'x', ipAddress: null, userAgent: null,
    })
    expect(res.id).toBe('con_existing')
    expect(h.consentCreate).not.toHaveBeenCalled()
  })

  it('only reuses a consent that has NOT already produced a subscription', async () => {
    h.consentFindFirst.mockResolvedValue(null)
    h.consentCreate.mockResolvedValue({ id: 'con_new' })
    await ensureConsent({
      clientId: 'c1', membershipId: 'm1', planId: 'plan1', priceCents: 4000,
      currency: 'nzd', interval: 'MONTH', consentText: 'x', ipAddress: '1.2.3.4', userAgent: 'UA',
    })
    expect(h.consentFindFirst.mock.calls[0][0].where.stripeSubscriptionId).toBeNull()
    expect(h.consentCreate).toHaveBeenCalled()
  })

  it('stores the verbatim text, the IP and the user agent', async () => {
    h.consentFindFirst.mockResolvedValue(null)
    h.consentCreate.mockResolvedValue({ id: 'con_new' })
    await ensureConsent({
      clientId: 'c1', membershipId: 'm1', planId: 'plan1', priceCents: 4000,
      currency: 'nzd', interval: 'MONTH', consentText: 'I agree X can charge me.',
      ipAddress: '1.2.3.4', userAgent: 'UA',
    })
    expect(h.consentCreate.mock.calls[0][0].data).toMatchObject({
      consentText: 'I agree X can charge me.', ipAddress: '1.2.3.4', userAgent: 'UA', priceCents: 4000,
    })
  })
})

describe('syncSubscription', () => {
  it('creates the purchase, grants the membership and links the consent', async () => {
    h.purchaseFindUnique.mockResolvedValue(null)
    await syncSubscription(subscription(), false)

    const args = h.fulfilMembershipInTx.mock.calls[0][1]
    expect(args).toMatchObject({ membershipId: 'm1', trainerId: 't1', clientId: 'c1', paymentId: null })
    expect(args.recurring).toMatchObject({
      planId: 'plan1', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1',
      status: 'ACTIVE', cancelAtPeriodEnd: false, applicationFeePercent: 0.85,
    })
    // The consent is tied to the thing it authorised.
    expect(h.consentUpdateMany.mock.calls[0][0].where).toEqual({ id: 'con1', stripeSubscriptionId: null })
  })

  it('is idempotent: a redelivered created event does NOT grant twice', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' })
    await syncSubscription(subscription(), false)
    await syncSubscription(subscription(), false)
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
    expect(h.enrolMembershipClasses).not.toHaveBeenCalled()
    // It still syncs the period/status — that part is safe to repeat.
    expect(h.purchaseUpdate).toHaveBeenCalledTimes(2)
  })

  it('computes the minimum term from the PERIOD START, not from now', async () => {
    // A late webhook must not push the commitment date out.
    h.purchaseFindUnique.mockResolvedValue(null)
    h.planFindUnique.mockResolvedValue({ minTermCount: 3, interval: 'MONTH' })
    await syncSubscription(subscription(), false)

    const start = new Date(1_760_000_000 * 1000)
    const expected = new Date(start.getTime())
    expected.setMonth(expected.getMonth() + 3)
    expect(h.fulfilMembershipInTx.mock.calls[0][1].recurring.committedUntil.toISOString())
      .toBe(expected.toISOString())
  })

  it('marks CANCELLING — not CANCELLED — while it is still running', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' })
    await syncSubscription(subscription({ cancel_at_period_end: true }), false)
    expect(h.purchaseUpdate.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLING', cancelAtPeriodEnd: true })
  })

  it('stamps cancelledAt only once the subscription is really cancelled', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', status: 'CANCELLING' })
    await syncSubscription(subscription({ status: 'canceled' }), false)
    const data = h.purchaseUpdate.mock.calls[0][0].data
    expect(data.status).toBe('CANCELLED')
    expect(data.cancelledAt).toBeInstanceOf(Date)
  })

  it('does nothing at all when the subscription carries no PupManager metadata', async () => {
    // Cannot attribute it to anyone — ack and stay out of the way rather than guess.
    await syncSubscription(subscription({ metadata: {} }), false)
    expect(h.fulfilMembershipInTx).not.toHaveBeenCalled()
    expect(h.purchaseUpdate).not.toHaveBeenCalled()
  })

  it('enrols class places only on the first sync', async () => {
    h.purchaseFindUnique.mockResolvedValue(null)
    h.fulfilMembershipInTx.mockResolvedValue({ classGrants: [{ classRunId: 'run1' }] })
    await syncSubscription(subscription(), false)
    expect(h.enrolMembershipClasses).toHaveBeenCalledWith([{ classRunId: 'run1' }], 'c1')
  })

  it('tells the client and the trainer when a plan starts', async () => {
    h.purchaseFindUnique.mockResolvedValue(null)
    await syncSubscription(subscription(), false)
    expect(h.notifyClient).toHaveBeenCalledTimes(1)
    expect(h.notifyTrainer).toHaveBeenCalledTimes(1)
    expect(h.notifyClient.mock.calls[0][0]).toMatchObject({ userId: 'cu1', type: 'CLIENT_ADDED_TO_PLAN' })
  })
})

describe('recordInvoicePaid', () => {
  it('defers when the subscription event has not landed yet — no half-formed rows', async () => {
    // Stripe does not guarantee order. Creating a purchase from an invoice alone
    // would build one without the plan, term or period it needs.
    h.purchaseFindUnique.mockResolvedValue(null)
    await recordInvoicePaid(invoice(), false, 'sub_1')
    expect(h.invoiceCreate).not.toHaveBeenCalled()
    expect(h.paymentCreate).not.toHaveBeenCalled()
  })

  it('records the cycle and mirrors it into a PAID Payment row', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' })
    h.invoiceFindUnique.mockResolvedValue(null)
    h.paymentCreate.mockResolvedValue({ id: 'pay1' })

    await recordInvoicePaid(invoice(), false, 'sub_1')

    // A Payment per cycle is what keeps the EXISTING refund, dispute and Xero
    // machinery working on a recurring charge with no changes.
    expect(h.paymentCreate.mock.calls[0][0].data).toMatchObject({
      trainerId: 't1', clientId: 'c1', connectAccountId: 'acct_1',
      amountTotal: 4000, currency: 'nzd', status: 'PAID', stripePaymentIntentId: 'pi_1',
    })
    expect(h.invoiceCreate.mock.calls[0][0].data).toMatchObject({
      membershipPurchaseId: 'p1', stripeInvoiceId: 'in_1', amountPaid: 4000, status: 'PAID', paymentId: 'pay1',
    })
  })

  it('is idempotent: a redelivered invoice.paid creates NO second Payment', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' })
    h.invoiceFindUnique.mockResolvedValue({ id: 'mi1', paymentId: 'pay1' })

    await recordInvoicePaid(invoice(), false, 'sub_1')
    await recordInvoicePaid(invoice(), false, 'sub_1')

    // This is the exact double-charge the event ledger and this guard exist to
    // stop — the PENDING→PAID transition alone would NOT have caught it.
    expect(h.paymentCreate).not.toHaveBeenCalled()
    expect(h.invoiceCreate).not.toHaveBeenCalled()
    expect(h.invoiceUpdate).toHaveBeenCalledTimes(2)
  })

  it('clears dunning state but never resurrects a cancelling plan', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' })
    h.invoiceFindUnique.mockResolvedValue(null)
    h.paymentCreate.mockResolvedValue({ id: 'pay1' })

    await recordInvoicePaid(invoice(), false, 'sub_1')

    const call = h.purchaseUpdateMany.mock.calls[0][0]
    // Scoped to ACTIVE/PAST_DUE only: someone who cancelled mid-cycle still has
    // a final invoice, and flipping them to ACTIVE would tell them their
    // cancellation had been undone.
    expect(call.where.status).toEqual({ in: ['ACTIVE', 'PAST_DUE'] })
    expect(call.data).toMatchObject({ status: 'ACTIVE', failedPaymentCount: 0, lastPaymentFailedAt: null })
  })

  it('writes no Payment for a zero-amount invoice', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' })
    h.invoiceFindUnique.mockResolvedValue(null)
    await recordInvoicePaid(invoice({ amount_paid: 0 }), false, 'sub_1')
    expect(h.paymentCreate).not.toHaveBeenCalled()
    expect(h.invoiceCreate).toHaveBeenCalled()
  })
})

describe('recordInvoicePaymentFailed', () => {
  it('marks PAST_DUE and tells BOTH sides, without revoking anything', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' })
    await recordInvoicePaymentFailed(invoice({ attempt_count: 2 }), false, 'sub_1')

    const data = h.purchaseUpdateMany.mock.calls[0][0].data
    expect(data.status).toBe('PAST_DUE')
    expect(data.failedPaymentCount).toBe(2)
    // Access continues through the retry window — nothing here cancels or
    // un-enrols. Cutting a client off because a card bounced on a Tuesday is
    // the wrong call when they will usually pay within days.
    expect(data.cancelAtPeriodEnd).toBeUndefined()
    expect(h.notifyClient).toHaveBeenCalledTimes(1)
    expect(h.notifyTrainer).toHaveBeenCalledTimes(1)
  })

  it('takes the attempt count from STRIPE so a replay cannot inflate it', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' })
    await recordInvoicePaymentFailed(invoice({ attempt_count: 3 }), false, 'sub_1')
    await recordInvoicePaymentFailed(invoice({ attempt_count: 3 }), false, 'sub_1')

    expect(h.purchaseUpdateMany.mock.calls[0][0].data.failedPaymentCount).toBe(3)
    expect(h.purchaseUpdateMany.mock.calls[1][0].data.failedPaymentCount).toBe(3)
  })

  it('upserts the invoice row so a redelivery does not duplicate it', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' })
    await recordInvoicePaymentFailed(invoice(), false, 'sub_1')
    expect(h.invoiceUpsert.mock.calls[0][0].where).toEqual({ stripeInvoiceId: 'in_1' })
  })

  it('does nothing when the subscription is unknown', async () => {
    h.purchaseFindUnique.mockResolvedValue(null)
    await recordInvoicePaymentFailed(invoice(), false, 'sub_1')
    expect(h.purchaseUpdateMany).not.toHaveBeenCalled()
    expect(h.notifyClient).not.toHaveBeenCalled()
  })
})
