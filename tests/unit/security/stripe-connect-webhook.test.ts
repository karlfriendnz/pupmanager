import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Connect webhook's signature gate and its new idempotency ledger.
//
// Neither Stripe webhook had ANY unit test before this change, which is
// uncomfortable for the endpoint that fulfils every payment. These cover the
// parts the recurring work depends on: an unsigned or wrongly-signed event never
// reaches a handler, a replayed event is dropped, and — the subtle one — a
// handler that FAILS releases its ledger claim so Stripe's retry can actually
// run instead of being swallowed as a duplicate.

const h = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  eventCreate: vi.fn(),
  eventDelete: vi.fn(),
  syncSubscription: vi.fn(),
  recordInvoicePaid: vi.fn(),
  recordInvoicePaymentFailed: vi.fn(),
  recordInvoiceActionRequired: vi.fn(),
  recordInvoiceUpcoming: vi.fn(),
  handleAccountDeauthorized: vi.fn(),
  completeCardUpdateForSubscription: vi.fn(),
  purchaseFindUnique: vi.fn(),
  trainerFindUnique: vi.fn(),
  setupIntentRetrieve: vi.fn(),
  env: {
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_live',
    STRIPE_CONNECT_WEBHOOK_SECRET_TEST: 'whsec_test',
  },
}))

vi.mock('@/lib/stripe', () => ({
  stripeFor: vi.fn(() => ({
    webhooks: { constructEvent: h.constructEvent },
    setupIntents: { retrieve: h.setupIntentRetrieve },
  })),
  isStripeConfigured: vi.fn(() => true),
}))
vi.mock('@/lib/env', () => ({ env: h.env }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    stripeWebhookEvent: { create: h.eventCreate, delete: h.eventDelete },
    payment: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    membershipPurchase: { findUnique: h.purchaseFindUnique },
    trainerProfile: { findUnique: h.trainerFindUnique, update: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/membership-billing', () => ({
  syncSubscription: h.syncSubscription,
  recordInvoicePaid: h.recordInvoicePaid,
  recordInvoicePaymentFailed: h.recordInvoicePaymentFailed,
  recordInvoiceActionRequired: h.recordInvoiceActionRequired,
  recordInvoiceUpcoming: h.recordInvoiceUpcoming,
  handleAccountDeauthorized: h.handleAccountDeauthorized,
  completeCardUpdateForSubscription: h.completeCardUpdateForSubscription,
}))
// Fulfilment collaborators — stubbed so the module graph loads without a DB.
vi.mock('@/lib/stock', () => ({ takeStock: vi.fn() }))
vi.mock('@/lib/connect', () => ({ readAccountFlags: vi.fn(() => ({})), stripeProcessingFeeFrom: vi.fn(() => 0) }))
vi.mock('@/lib/booking-page', () => ({ materializeBooking: vi.fn() }))
vi.mock('@/lib/booking-automations', () => ({ runOnBookingAutomations: vi.fn(), formatBookingTime: vi.fn(() => '') }))
vi.mock('@/lib/class-runs', () => ({ enrollInRun: vi.fn() }))
vi.mock('@/lib/memberships', () => ({ fulfilMembershipInTx: vi.fn(), enrolMembershipClasses: vi.fn() }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: vi.fn() }))
vi.mock('@/lib/client-notify', () => ({ notifyClient: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/xero-sync', () => ({ syncPaymentToXero: vi.fn() }))
vi.mock('@/lib/invoicing', () => ({ settleInvoiceFromPayment: vi.fn(), syncReceivablePaymentToXero: vi.fn() }))

import { POST } from '@/app/api/webhooks/stripe/connect/route'

function req(signed = true) {
  return new Request('https://app.pupmanager.com/api/webhooks/stripe/connect', {
    method: 'POST',
    headers: signed ? { 'stripe-signature': 't=1,v1=abc' } : {},
    body: JSON.stringify({ hello: 'world' }),
  })
}

const SUB_EVENT = {
  id: 'evt_1',
  type: 'customer.subscription.created',
  account: 'acct_1',
  data: { object: { id: 'sub_1' } },
}

beforeEach(() => {
  for (const fn of Object.values(h)) if (typeof fn === 'function') (fn as ReturnType<typeof vi.fn>).mockReset()
  h.eventCreate.mockResolvedValue({})
  h.eventDelete.mockResolvedValue({})
})

describe('signature verification', () => {
  it('400s without a stripe-signature header', async () => {
    const res = await POST(req(false))
    expect(res.status).toBe(400)
    expect(h.eventCreate).not.toHaveBeenCalled()
  })

  it('400s when the body verifies against NO configured secret', async () => {
    // A forged event must never reach a handler, let alone the ledger.
    h.constructEvent.mockImplementation(() => { throw new Error('bad signature') })
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(h.eventCreate).not.toHaveBeenCalled()
    expect(h.syncSubscription).not.toHaveBeenCalled()
  })

  it('records which Stripe MODE the verifying secret implies', async () => {
    // The live secret is tried first; whichever verifies tells us the mode, and
    // a test-mode event must never be treated as live money.
    h.constructEvent.mockReturnValueOnce(SUB_EVENT)
    await POST(req())
    expect(h.eventCreate.mock.calls[0][0].data).toMatchObject({ id: 'evt_1', sandbox: false, accountId: 'acct_1' })
    expect(h.syncSubscription.mock.calls[0][1]).toBe(false)
  })

  it('falls through to the TEST secret when the live one does not verify', async () => {
    h.constructEvent
      .mockImplementationOnce(() => { throw new Error('not live') })
      .mockReturnValueOnce(SUB_EVENT)
    await POST(req())
    expect(h.eventCreate.mock.calls[0][0].data.sandbox).toBe(true)
    expect(h.syncSubscription.mock.calls[0][1]).toBe(true)
  })
})

describe('the idempotency ledger', () => {
  it('writes the Stripe event id before running any handler', async () => {
    h.constructEvent.mockReturnValue(SUB_EVENT)
    await POST(req())
    expect(h.eventCreate.mock.invocationCallOrder[0])
      .toBeLessThan(h.syncSubscription.mock.invocationCallOrder[0])
  })

  it('drops a replayed event without re-running the handler', async () => {
    // The only thing that reliably stops replays. The PENDING→PAID transition
    // would not have stopped a redelivered invoice.paid writing a second Payment.
    h.constructEvent.mockReturnValue(SUB_EVENT)
    h.eventCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))

    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ duplicate: true })
    expect(h.syncSubscription).not.toHaveBeenCalled()
  })

  it('RELEASES the claim when the handler throws, so Stripe’s retry can run', async () => {
    // Without this, a dropped DB connection mid-handler would be recorded as
    // "processed" and the redelivery skipped — silently losing the event. A lost
    // invoice.paid means a client is charged and never granted.
    h.constructEvent.mockReturnValue(SUB_EVENT)
    h.syncSubscription.mockRejectedValue(new Error('transient'))

    const res = await POST(req())

    expect(res.status).toBe(500)
    expect(h.eventDelete).toHaveBeenCalledWith({ where: { id: 'evt_1' } })
  })

  it('does not process an event it could not record', async () => {
    h.constructEvent.mockReturnValue(SUB_EVENT)
    h.eventCreate.mockRejectedValue(new Error('db down'))
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(h.syncSubscription).not.toHaveBeenCalled()
  })

  it('covers the pre-existing one-off events too, not just recurring ones', async () => {
    h.constructEvent.mockReturnValue({
      id: 'evt_charge', type: 'charge.refunded', account: 'acct_1', data: { object: { id: 'ch_1' } },
    })
    await POST(req())
    expect(h.eventCreate.mock.calls[0][0].data).toMatchObject({ id: 'evt_charge', type: 'charge.refunded' })
  })
})

describe('recurring event routing', () => {
  it('routes every subscription lifecycle event through one syncing path', async () => {
    for (const type of ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']) {
      h.constructEvent.mockReturnValue({ ...SUB_EVENT, id: `evt_${type}`, type })
      await POST(req())
    }
    // Stripe does not guarantee order, so whichever lands first must be able to
    // create the row and the rest just update it.
    expect(h.syncSubscription).toHaveBeenCalledTimes(3)
  })

  it('resolves invoice.paid via invoice.parent, the pinned API version’s shape', async () => {
    h.constructEvent.mockReturnValue({
      id: 'evt_paid',
      type: 'invoice.paid',
      account: 'acct_1',
      data: { object: { id: 'in_1', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_9' } } } },
    })
    await POST(req())
    expect(h.recordInvoicePaid.mock.calls[0][2]).toBe('sub_9')
  })

  it('ignores an invoice that is not subscription-generated', async () => {
    h.constructEvent.mockReturnValue({
      id: 'evt_oneoff', type: 'invoice.paid', account: 'acct_1',
      data: { object: { id: 'in_2', parent: null } },
    })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(h.recordInvoicePaid).not.toHaveBeenCalled()
  })

  it('routes invoice.payment_failed to the dunning recorder', async () => {
    h.constructEvent.mockReturnValue({
      id: 'evt_failed', type: 'invoice.payment_failed', account: 'acct_1',
      data: { object: { id: 'in_3', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_3' } } } },
    })
    await POST(req())
    expect(h.recordInvoicePaymentFailed.mock.calls[0][2]).toBe('sub_3')
  })
})

// ─── Phase 2 events ─────────────────────────────────────────────────────────
describe('failure-surface event routing', () => {
  function subInvoice(id: string, type: string, sub = 'sub_9') {
    return {
      id, type, account: 'acct_1',
      data: { object: { id: 'in_x', parent: { type: 'subscription_details', subscription_details: { subscription: sub } } } },
    }
  }

  it('routes invoice.payment_action_required — the bank needs the client', async () => {
    h.constructEvent.mockReturnValue(subInvoice('evt_3ds', 'invoice.payment_action_required'))
    await POST(req())
    expect(h.recordInvoiceActionRequired.mock.calls[0][2]).toBe('sub_9')
  })

  it('routes invoice.upcoming for the pre-renewal card check', async () => {
    h.constructEvent.mockReturnValue(subInvoice('evt_up', 'invoice.upcoming'))
    await POST(req())
    expect(h.recordInvoiceUpcoming.mock.calls[0][1]).toBe('sub_9')
  })

  it('routes account.application.deauthorized with the account that left', async () => {
    h.constructEvent.mockReturnValue({
      id: 'evt_deauth', type: 'account.application.deauthorized', account: 'acct_gone', data: { object: {} },
    })
    await POST(req())
    expect(h.handleAccountDeauthorized).toHaveBeenCalledWith('acct_gone', false)
  })

  it('ignores a deauthorization with no account on it', async () => {
    h.constructEvent.mockReturnValue({
      id: 'evt_deauth2', type: 'account.application.deauthorized', account: null, data: { object: {} },
    })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(h.handleAccountDeauthorized).not.toHaveBeenCalled()
  })

  it('treats a setup-mode checkout as the card update, not a purchase', async () => {
    // Handled on checkout.session.completed deliberately, so the Dashboard
    // needs no extra event subscription for the card-update path to work.
    h.constructEvent.mockReturnValue({
      id: 'evt_setup', type: 'checkout.session.completed', account: 'acct_1',
      data: { object: { id: 'cs_1', mode: 'setup', setup_intent: 'seti_1', metadata: { membershipPurchaseId: 'p1' } } },
    })
    h.purchaseFindUnique.mockResolvedValue({ trainerId: 't1', sandbox: false })
    h.trainerFindUnique.mockResolvedValue({ connectAccountId: 'acct_1' })
    h.setupIntentRetrieve.mockResolvedValue({ payment_method: 'pm_new' })

    await POST(req())

    expect(h.completeCardUpdateForSubscription).toHaveBeenCalledWith({
      purchaseId: 'p1', paymentMethodId: 'pm_new', connectAccountId: 'acct_1', sandbox: false,
    })
  })

  it('refuses a card update whose Stripe MODE does not match ours', async () => {
    // A test-mode session must never re-point a live subscription's card.
    h.constructEvent.mockReturnValue({
      id: 'evt_setup2', type: 'checkout.session.completed', account: 'acct_1',
      data: { object: { id: 'cs_2', mode: 'setup', setup_intent: 'seti_2', metadata: { membershipPurchaseId: 'p1' } } },
    })
    h.purchaseFindUnique.mockResolvedValue({ trainerId: 't1', sandbox: true })

    await POST(req())

    expect(h.completeCardUpdateForSubscription).not.toHaveBeenCalled()
  })

  it('refuses a card update arriving on the wrong connected account', async () => {
    h.constructEvent.mockReturnValue({
      id: 'evt_setup3', type: 'checkout.session.completed', account: 'acct_someone_else',
      data: { object: { id: 'cs_3', mode: 'setup', setup_intent: 'seti_3', metadata: { membershipPurchaseId: 'p1' } } },
    })
    h.purchaseFindUnique.mockResolvedValue({ trainerId: 't1', sandbox: false })
    h.trainerFindUnique.mockResolvedValue({ connectAccountId: 'acct_1' })

    await POST(req())

    expect(h.completeCardUpdateForSubscription).not.toHaveBeenCalled()
  })
})
