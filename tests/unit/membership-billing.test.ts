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
  suspendGrants: vi.fn(),
  restoreGrants: vi.fn(),
  purchaseFindMany: vi.fn(),
  trainerUpdate: vi.fn(),
  subCancel: vi.fn(),
  sendEmail: vi.fn(),
  regrantRenewalItems: vi.fn(),
  syncPaymentToXero: vi.fn(),
  notifyClient: vi.fn(),
  notifyTrainer: vi.fn(),
  requestUpdateMany: vi.fn(),
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
    membershipRequest: { updateMany: h.requestUpdateMany },
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
      membershipPurchase: {
        findUnique: h.purchaseFindUnique,
        findFirst: h.purchaseFindFirst,
        findMany: h.purchaseFindMany,
        update: h.purchaseUpdate,
      },
      membershipConsent: { findFirst: h.consentFindFirst, create: h.consentCreate },
      membershipInvoice: { upsert: h.invoiceUpsert, findFirst: h.invoiceFindUnique },
      trainerProfile: { findUnique: h.trainerFindUnique, update: h.trainerUpdate },
      clientProfile: { findUnique: h.clientFindUnique },
      membership: { findUnique: h.membershipFindUnique },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  }
})
vi.mock('@/lib/memberships', () => ({
  fulfilMembershipInTx: h.fulfilMembershipInTx,
  enrolMembershipClasses: h.enrolMembershipClasses,
  regrantRenewalItems: h.regrantRenewalItems,
}))
vi.mock('@/lib/xero-sync', () => ({ syncPaymentToXero: h.syncPaymentToXero }))
// Partial: the suspend/restore calls are spied on, but the RULE itself
// (membershipGrantsAccess) stays real — these tests assert the real policy.
vi.mock('@/lib/membership-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/membership-access')>()),
  suspendMembershipGrants: h.suspendGrants,
  restoreMembershipGrants: h.restoreGrants,
}))
vi.mock('@/lib/stripe', () => ({ stripeFor: vi.fn(() => ({ subscriptions: { cancel: h.subCancel } })) }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail }))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))

import {
  ensureConsent,
  syncSubscription,
  recordInvoicePaid,
  recordInvoicePaymentFailed,
  handleAccountDeauthorized,
  findLiveSubscription,
} from '@/lib/membership-billing'

// The "one live subscription per client per membership" guard. It is what stops
// a double-tapped Subscribe — or a client following an invitation link twice —
// stacking a second recurring charge on the same plan. Mocked out in the buy
// route's own spec, so the query it actually runs is only checked here.
describe('findLiveSubscription', () => {
  it('treats ACTIVE, PAST_DUE and CANCELLING as live', async () => {
    h.purchaseFindFirst.mockResolvedValue(null)
    await findLiveSubscription('c1', 'm1')

    const where = h.purchaseFindFirst.mock.calls[0][0].where
    expect(where).toMatchObject({ clientId: 'c1', membershipId: 'm1' })
    // CANCELLING counts: they are still inside a period they have paid for, and
    // re-subscribing on top would double-bill them for the overlap.
    expect(where.status.in).toEqual(['ACTIVE', 'PAST_DUE', 'CANCELLING'])
    // A row with no Stripe subscription behind it cannot be charging anyone.
    expect(where.stripeSubscriptionId).toEqual({ not: null })
  })

  // AGENTS.md #7 — an idempotency check must IGNORE cancelled rows. The shop's
  // version of this found a CANCELLED invoice, decided the thing was already
  // paid for, and raised nothing, so the re-order was free. Here the failure is
  // the mirror image: counting a finished plan as live would permanently bar
  // someone from ever re-joining a package they used to be on.
  for (const dead of ['CANCELLED', 'PAUSED', 'ORPHANED', 'LAPSED']) {
    it(`does not let a ${dead} purchase block a fresh subscription`, async () => {
      h.purchaseFindFirst.mockResolvedValue(null)
      await findLiveSubscription('c1', 'm1')
      expect(h.purchaseFindFirst.mock.calls[0][0].where.status.in).not.toContain(dead)
    })
  }

  it('reports the live row when there genuinely is one', async () => {
    h.purchaseFindFirst.mockResolvedValue({ id: 'p1', status: 'ACTIVE', stripeSubscriptionId: 'sub_1' })
    expect(await findLiveSubscription('c1', 'm1')).toMatchObject({ id: 'p1' })
  })
})

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
  h.fulfilMembershipInTx.mockResolvedValue({ classGrants: [], membershipPurchaseId: 'p1' })
  h.suspendGrants.mockResolvedValue({ packages: 1, enrolments: 1 })
  h.restoreGrants.mockResolvedValue({ packages: 1, enrolments: 1 })
  h.trainerFindUnique.mockResolvedValue({ connectAccountId: 'acct_1', businessName: 'E2E Dog School', user: { id: 'tu1' } })
  h.clientFindUnique.mockResolvedValue({ user: { id: 'cu1', name: 'Sarah' }, dog: { name: 'Bailey' } })
  h.membershipFindUnique.mockResolvedValue({ name: 'Starter Bundle' })
  h.planFindUnique.mockResolvedValue({ minTermCount: 0, interval: 'MONTH' })
  h.notifyClient.mockResolvedValue(undefined)
  h.notifyTrainer.mockResolvedValue(undefined)
  h.subCancel.mockResolvedValue({})
  h.sendEmail.mockResolvedValue(undefined)
  h.purchaseFindMany.mockResolvedValue([])
  h.regrantRenewalItems.mockResolvedValue(0)
  h.syncPaymentToXero.mockResolvedValue({ ok: true })
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
    h.fulfilMembershipInTx.mockResolvedValue({ classGrants: [{ classRunId: 'run1' }], membershipPurchaseId: 'p1' })
    await syncSubscription(subscription(), false)
    // The purchase id travels with the seats so each can be PAUSED (never
    // withdrawn) if the plan stops being paid for.
    expect(h.enrolMembershipClasses).toHaveBeenCalledWith([{ classRunId: 'run1' }], 'c1', 'p1')
  })

  it('tells the client and the trainer when a plan starts', async () => {
    h.purchaseFindUnique.mockResolvedValue(null)
    await syncSubscription(subscription(), false)
    expect(h.notifyClient).toHaveBeenCalledTimes(1)
    expect(h.notifyTrainer).toHaveBeenCalledTimes(1)
    expect(h.notifyClient.mock.calls[0][0]).toMatchObject({ userId: 'cu1', type: 'CLIENT_ADDED_TO_PLAN' })
  })

  // When a trainer accepts a request by asking the client to PAY, the grant
  // happens here — on Stripe's confirmation — and nowhere else. These cover the
  // other half: the trainer's "waiting on them to pay" row has to close, or it
  // sits on the dashboard telling them to chase someone who already paid.
  it('closes the trainer’s invitation once the client has actually paid', async () => {
    h.purchaseFindUnique.mockResolvedValue(null)
    await syncSubscription(subscription(), false)

    expect(h.requestUpdateMany).toHaveBeenCalledTimes(1)
    expect(h.requestUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { clientId: 'c1', membershipId: 'm1', status: 'INVITED' },
      data: { status: 'FULFILLED' },
    })
  })

  it('leaves an untouched PENDING request for the trainer to answer', async () => {
    // Most subscriptions are self-serve. If someone buys a plan they had also
    // requested, the trainer still has a request to answer — silently marking
    // it FULFILLED would hide a decision they never made.
    h.purchaseFindUnique.mockResolvedValue(null)
    await syncSubscription(subscription(), false)
    expect(h.requestUpdateMany.mock.calls[0][0].where.status).toBe('INVITED')
  })

  it('does not re-close the invitation when the event is delivered twice', async () => {
    // The second delivery takes the "already exists" branch, so it never
    // reaches the request at all — and the status guard means it would match
    // nothing even if it did.
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE', accessPausedAt: null, accessGraceUntil: null })
    await syncSubscription(subscription(), false)
    expect(h.requestUpdateMany).not.toHaveBeenCalled()
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
    // Upsert rather than create: the row may already exist as OPEN from a
    // failed attempt this payment just rescued.
    expect(h.invoiceUpsert.mock.calls[0][0].create).toMatchObject({
      membershipPurchaseId: 'p1', stripeInvoiceId: 'in_1', amountPaid: 4000, status: 'PAID', paymentId: 'pay1',
    })
  })

  it('is idempotent: a redelivered invoice.paid creates NO second Payment', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' })
    // ALREADY PAID is the marker for "this one is finished" — the state the row
    // is actually left in once the first delivery commits. Row-exists alone is
    // NOT the marker: a row can also exist as OPEN from a failed attempt, which
    // is a payment still owed a Payment record.
    h.invoiceFindUnique.mockResolvedValue({ id: 'mi1', paymentId: 'pay1', status: 'PAID' })

    await recordInvoicePaid(invoice(), false, 'sub_1')
    await recordInvoicePaid(invoice(), false, 'sub_1')

    // This is the exact double-charge the event ledger and this guard exist to
    // stop — the PENDING→PAID transition alone would NOT have caught it.
    expect(h.paymentCreate).not.toHaveBeenCalled()
    expect(h.invoiceUpsert).not.toHaveBeenCalled()
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
    expect(h.invoiceUpsert).toHaveBeenCalled()
  })
})

describe('recordInvoicePaymentFailed — access survives, for two weeks', () => {
  it('marks PAST_DUE, opens a window, and pauses NOTHING', async () => {
    // Karl, 2026-08-01, replacing the 2026-07-27 rule. Stripe is still
    // retrying; taking a client's classes away on the first miss punished them
    // for something that had not finished going wrong.
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1', accessGraceUntil: null })
    await recordInvoicePaymentFailed(invoice({ attempt_count: 1 }), false, 'sub_1')

    const data = h.purchaseUpdateMany.mock.calls[0][0].data
    expect(data.status).toBe('PAST_DUE')
    expect(data.accessGraceUntil).toBeInstanceOf(Date)
    // The grants stay exactly as they were.
    expect(h.suspendGrants).not.toHaveBeenCalled()
    expect(data.accessPausedAt).toBeUndefined()
  })

  it('does NOT push the deadline out on every retry', async () => {
    // The window runs from the first miss. Recomputing it per retry would move
    // it every time Stripe tried again and the two weeks would never end.
    const opened = new Date('2026-08-05T00:00:00Z')
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1', accessGraceUntil: opened })

    await recordInvoicePaymentFailed(invoice({ attempt_count: 2 }), false, 'sub_1')

    expect(h.purchaseUpdateMany.mock.calls[0][0].data.accessGraceUntil).toEqual(opened)
  })

  it('tells the client nothing has stopped yet, and by when to fix it', async () => {
    // The old copy said "your plan is paused". Saying that while they still
    // have everything sends them chasing a problem that hasn't happened.
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 'lt1', clientId: 'c1', membershipId: 'm1', accessGraceUntil: null })
    await recordInvoicePaymentFailed(invoice(), false, 'sub_1')

    const notice = h.notifyClient.mock.calls[0][0]
    expect(notice.vars.description).toContain('didn’t go through')
    expect(notice.vars.description).toContain('Nothing has stopped yet')
    expect(notice.vars.description).not.toContain('paused')
    expect(notice.ctaLabel).toBe('Update your card')
    // The trainer is told they KEEP access, not that it stopped.
    expect(h.notifyTrainer.mock.calls[0][2].detail).toContain('keep access')
  })

  it('takes the attempt count from STRIPE so a replay cannot inflate it', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1', accessGraceUntil: null })
    await recordInvoicePaymentFailed(invoice({ attempt_count: 3 }), false, 'sub_1')
    await recordInvoicePaymentFailed(invoice({ attempt_count: 3 }), false, 'sub_1')

    expect(h.purchaseUpdateMany.mock.calls[0][0].data.failedPaymentCount).toBe(3)
    expect(h.purchaseUpdateMany.mock.calls[1][0].data.failedPaymentCount).toBe(3)
  })

  it('upserts the invoice row so a redelivery does not duplicate it', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1', accessGraceUntil: null })
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

// ─── The recovery round trip ────────────────────────────────────────────────
// With access stopping on the FIRST failure, this path runs often: most
// failures are an expired card that gets replaced within days. A half-restored
// membership — status ACTIVE but grants still paused — is the bug that would
// hurt most here, because the client would see a working plan and a broken app.
describe('revoke → retry succeeds → restored', () => {
  const PURCHASE = { id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' }

  it('restores the grants and clears the pause when a retry pays', async () => {
    h.purchaseFindUnique.mockResolvedValue({ ...PURCHASE, status: 'PAST_DUE', accessPausedAt: new Date() })
    h.invoiceFindUnique.mockResolvedValue(null)
    h.paymentCreate.mockResolvedValue({ id: 'pay1' })

    await recordInvoicePaid(invoice(), false, 'sub_1')

    expect(h.restoreGrants).toHaveBeenCalledWith(expect.anything(), 'p1')
    const data = h.purchaseUpdateMany.mock.calls[0][0].data
    expect(data.status).toBe('ACTIVE')
    expect(data.accessPausedAt).toBeNull()
    expect(data.accessRestoredAt).toBeInstanceOf(Date)
    expect(data.failedPaymentCount).toBe(0)
  })

  it('tells the client everything is back on', async () => {
    // They were told it was paused; they have to be told it isn't any more, or
    // they assume it is still broken and email the trainer.
    h.purchaseFindUnique.mockResolvedValue({ ...PURCHASE, status: 'PAST_DUE', accessPausedAt: new Date() })
    h.invoiceFindUnique.mockResolvedValue(null)
    h.paymentCreate.mockResolvedValue({ id: 'pay1' })

    await recordInvoicePaid(invoice(), false, 'sub_1')

    expect(h.notifyClient).toHaveBeenCalledTimes(1)
    expect(h.notifyClient.mock.calls[0][0].vars.detail).toContain('back on')
  })

  it('stays quiet on an ordinary renewal that was never paused', async () => {
    // A monthly "your payment worked" message nobody asked for is noise.
    h.purchaseFindUnique.mockResolvedValue({ ...PURCHASE, status: 'ACTIVE', accessPausedAt: null })
    h.invoiceFindUnique.mockResolvedValue(null)
    h.paymentCreate.mockResolvedValue({ id: 'pay1' })

    await recordInvoicePaid(invoice(), false, 'sub_1')

    expect(h.notifyClient).not.toHaveBeenCalled()
    // But the grants are still restored unconditionally — clearing an
    // already-clear flag is free, and a half-restored plan is not.
    expect(h.restoreGrants).toHaveBeenCalled()
  })

  it('survives the full cycle: fail, fail again, then pay — losing nothing on the way', async () => {
    // The whole point of the two-week window: a client whose card fails twice
    // and is then replaced never notices anything stopped, because nothing did.
    const opened = new Date('2026-08-05T00:00:00Z')
    h.purchaseFindUnique.mockResolvedValue({ ...PURCHASE, status: 'ACTIVE', accessPausedAt: null, accessGraceUntil: null })
    await recordInvoicePaymentFailed(invoice({ attempt_count: 1 }), false, 'sub_1')
    h.purchaseFindUnique.mockResolvedValue({ ...PURCHASE, status: 'PAST_DUE', accessPausedAt: null, accessGraceUntil: opened })
    await recordInvoicePaymentFailed(invoice({ attempt_count: 2 }), false, 'sub_1')

    expect(h.suspendGrants).not.toHaveBeenCalled()
    // And the deadline did not move with the second attempt.
    expect(h.purchaseUpdateMany.mock.calls.at(-1)?.[0].data.accessGraceUntil).toEqual(opened)

    h.invoiceFindUnique.mockResolvedValue(null)
    h.paymentCreate.mockResolvedValue({ id: 'pay1' })
    await recordInvoicePaid(invoice({ id: 'in_2' }), false, 'sub_1')

    const paid = h.purchaseUpdateMany.mock.calls.at(-1)?.[0].data
    expect(paid.status).toBe('ACTIVE')
    // The episode is closed: the next failure opens a fresh fortnight.
    expect(paid.accessGraceUntil).toBeNull()
    expect(paid.failedPaymentCount).toBe(0)
  })
})

describe('syncSubscription keeps grants in step with status', () => {
  it('restores grants when Stripe moves a subscription back to active', async () => {
    // Stripe can clear past_due on its own after a retry we never saw an
    // invoice event for. If only the status moved, the client would have an
    // active plan and everything still switched off.
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', status: 'PAST_DUE' })
    await syncSubscription(subscription({ status: 'active' }), false)
    expect(h.restoreGrants).toHaveBeenCalledWith(expect.anything(), 'p1')
    expect(h.suspendGrants).not.toHaveBeenCalled()
  })

  it('suspends grants when Stripe reports past_due', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' })
    await syncSubscription(subscription({ status: 'past_due' }), false)
    expect(h.suspendGrants).toHaveBeenCalledWith(expect.anything(), 'p1')
    expect(h.restoreGrants).not.toHaveBeenCalled()
  })

  it('keeps a CANCELLING plan working — they paid for this period', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' })
    await syncSubscription(subscription({ status: 'active', cancel_at_period_end: true }), false)
    expect(h.restoreGrants).toHaveBeenCalled()
    expect(h.suspendGrants).not.toHaveBeenCalled()
  })

  it('suspends when a subscription is finally cancelled', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', status: 'CANCELLING' })
    await syncSubscription(subscription({ status: 'canceled' }), false)
    expect(h.suspendGrants).toHaveBeenCalled()
  })
})

// ─── The trainer left ───────────────────────────────────────────────────────
// Karl's call (2026-07-27): cancel the subscriptions and tell the clients. The
// alternative — letting them run — leaves people being charged by a business
// PupManager no longer has any relationship with.
describe('handleAccountDeauthorized', () => {
  beforeEach(() => {
    h.trainerFindUnique.mockResolvedValue({
      id: 't1', businessName: 'E2E Dog School', user: { id: 'tu1', email: 't@example.com' },
    })
    h.purchaseFindMany.mockResolvedValue([
      { id: 'p1', clientId: 'c1', membershipId: 'm1', stripeSubscriptionId: 'sub_1' },
      { id: 'p2', clientId: 'c2', membershipId: 'm1', stripeSubscriptionId: 'sub_2' },
    ])
    h.trainerUpdate.mockResolvedValue({})
    h.purchaseUpdate.mockResolvedValue({})
  })

  it('marks every live plan ORPHANED and pauses what they granted', async () => {
    await handleAccountDeauthorized('acct_1', false)

    expect(h.purchaseUpdate).toHaveBeenCalledTimes(2)
    for (const call of h.purchaseUpdate.mock.calls) {
      expect(call[0].data).toMatchObject({ status: 'ORPHANED', cancelReason: 'TRAINER_DISCONNECTED' })
    }
    expect(h.suspendGrants).toHaveBeenCalledTimes(2)
  })

  it('stops the trainer being able to sell or charge anything else', async () => {
    await handleAccountDeauthorized('acct_1', false)
    expect(h.trainerUpdate.mock.calls[0][0].data).toMatchObject({
      connectChargesEnabled: false,
      acceptPaymentsEnabled: false,
      recurringPaymentsEnabled: false,
    })
    expect(h.trainerUpdate.mock.calls[0][0].data.connectDeauthorizedAt).toBeInstanceOf(Date)
  })

  it('tells every affected client, and says they won’t be charged again', async () => {
    await handleAccountDeauthorized('acct_1', false)
    expect(h.notifyClient).toHaveBeenCalledTimes(2)
    expect(h.notifyClient.mock.calls[0][0].vars.detail).toContain('won’t be charged again')
  })

  it('still marks our rows when Stripe refuses — the account is usually gone', async () => {
    // The subscriptions went with the account. Failing to cancel something that
    // no longer exists must not leave us showing clients a live plan.
    h.subCancel.mockRejectedValue(new Error('No such account'))
    await handleAccountDeauthorized('acct_1', false)
    expect(h.purchaseUpdate).toHaveBeenCalledTimes(2)
    expect(h.notifyClient).toHaveBeenCalledTimes(2)
  })

  it('emails the trainer — their income just stopped', async () => {
    await handleAccountDeauthorized('acct_1', false)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    // Reaches them whatever else they have muted.
    expect(h.sendEmail.mock.calls[0][0].alwaysSend).toBe(true)
  })

  it('does nothing for an account we do not recognise', async () => {
    h.trainerFindUnique.mockResolvedValue(null)
    await handleAccountDeauthorized('acct_unknown', false)
    expect(h.trainerUpdate).not.toHaveBeenCalled()
    expect(h.purchaseUpdate).not.toHaveBeenCalled()
  })

  it('sends no trainer email when there was nothing running', async () => {
    h.purchaseFindMany.mockResolvedValue([])
    await handleAccountDeauthorized('acct_1', false)
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.notifyClient).not.toHaveBeenCalled()
    // The account flags are still cleared — they have disconnected either way.
    expect(h.trainerUpdate).toHaveBeenCalled()
  })
})

// ─── Renewal grants ─────────────────────────────────────────────────────────
describe('regrantOnRenewal is a RENEWAL behaviour', () => {
  const PURCHASE = { id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1', status: 'ACTIVE', accessPausedAt: null }

  beforeEach(() => {
    h.purchaseFindUnique.mockResolvedValue(PURCHASE)
    h.invoiceFindUnique.mockResolvedValue(null)
    h.paymentCreate.mockResolvedValue({ id: 'pay1' })
    h.regrantRenewalItems.mockResolvedValue(1)
  })

  it('re-grants the bundle’s consumables on a renewal cycle', async () => {
    await recordInvoicePaid(invoice({ billing_reason: 'subscription_cycle' }), false, 'sub_1')
    expect(h.regrantRenewalItems).toHaveBeenCalledWith(expect.anything(), {
      membershipId: 'm1', trainerId: 't1', clientId: 'c1',
    })
  })

  it('does NOT re-grant on the first invoice of a new subscription', async () => {
    // Those items were already granted when the subscription was set up.
    // Granting again here would double every new subscriber's opening order.
    await recordInvoicePaid(invoice({ billing_reason: 'subscription_create' }), false, 'sub_1')
    expect(h.regrantRenewalItems).not.toHaveBeenCalled()
  })

  it('re-grants when a FAILED cycle is later paid — the row is OPEN, not PAID', async () => {
    // The dunning recovery. Proven against a test clock: this used to hit the
    // "row already exists" short-circuit and stop, so the rescued payment got
    // no Payment row at all and the cycle's items were never granted. Stripe
    // had the money; PupManager had no record of it.
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1' })
    h.invoiceFindUnique.mockResolvedValue({ id: 'mi1', paymentId: null, status: 'OPEN' })
    h.paymentCreate.mockResolvedValue({ id: 'pay9' })

    await recordInvoicePaid(invoice({ billing_reason: 'subscription_cycle' }), false, 'sub_1')

    expect(h.paymentCreate).toHaveBeenCalledTimes(1)
    expect(h.invoiceUpsert.mock.calls[0][0].update).toMatchObject({ status: 'PAID', paymentId: 'pay9' })
    expect(h.regrantRenewalItems).toHaveBeenCalledTimes(1)
    // And the dunning state has to come off, or access stays flagged as paused
    // for someone who has paid.
    expect(h.purchaseUpdateMany.mock.calls[0][0].data).toMatchObject({
      status: 'ACTIVE', failedPaymentCount: 0, accessPausedAt: null,
    })
  })

  it('does not re-grant on a mid-cycle update or a manual invoice', async () => {
    for (const reason of ['subscription_update', 'manual', 'subscription_threshold']) {
      h.invoiceFindUnique.mockResolvedValue(null)
      await recordInvoicePaid(invoice({ id: `in_${reason}`, billing_reason: reason }), false, 'sub_1')
    }
    expect(h.regrantRenewalItems).not.toHaveBeenCalled()
  })

  it('re-grants exactly once per cycle — a redelivery grants nothing', async () => {
    await recordInvoicePaid(invoice({ billing_reason: 'subscription_cycle' }), false, 'sub_1')
    // Second delivery of the SAME invoice. A row already marked PAID is the
    // short-circuit; that is the state the first delivery left behind.
    h.invoiceFindUnique.mockResolvedValue({ id: 'mi1', paymentId: 'pay1', status: 'PAID' })
    await recordInvoicePaid(invoice({ billing_reason: 'subscription_cycle' }), false, 'sub_1')

    expect(h.regrantRenewalItems).toHaveBeenCalledTimes(1)
  })
})

// ─── Xero ───────────────────────────────────────────────────────────────────
describe('recurring cycles reach Xero', () => {
  it('syncs the cycle’s Payment row after the transaction commits', async () => {
    // Works unchanged because each cycle produces a real Payment — which is the
    // main reason to create one at all.
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1', status: 'ACTIVE', accessPausedAt: null })
    h.invoiceFindUnique.mockResolvedValue(null)
    h.paymentCreate.mockResolvedValue({ id: 'pay_new' })

    await recordInvoicePaid(invoice(), false, 'sub_1')

    expect(h.syncPaymentToXero).toHaveBeenCalledWith('pay_new')
  })

  it('does not try to sync a cycle that produced no Payment', async () => {
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1', status: 'ACTIVE', accessPausedAt: null })
    h.invoiceFindUnique.mockResolvedValue(null)
    await recordInvoicePaid(invoice({ amount_paid: 0 }), false, 'sub_1')
    expect(h.syncPaymentToXero).not.toHaveBeenCalled()
  })

  it('never lets a Xero failure fail the webhook', async () => {
    // A Xero hiccup must not 500 this handler and start a Stripe retry loop
    // over a payment that already succeeded.
    h.purchaseFindUnique.mockResolvedValue({ id: 'p1', trainerId: 't1', clientId: 'c1', membershipId: 'm1', status: 'ACTIVE', accessPausedAt: null })
    h.invoiceFindUnique.mockResolvedValue(null)
    h.paymentCreate.mockResolvedValue({ id: 'pay_new' })
    h.syncPaymentToXero.mockRejectedValue(new Error('xero down'))

    await expect(recordInvoicePaid(invoice(), false, 'sub_1')).resolves.toBeUndefined()
  })
})
