import { describe, it, expect, vi, beforeEach } from 'vitest'

// The platform billing webhook's duplicate defence.
//
// Mersea Mutts held two live subscriptions from 21 and 25 July and paid both.
// Nothing stopped the second being created, nothing noticed it existed, and
// cancelling it marked them CANCELLED mid-repair. These cover all three, and
// they matter more than most tests here because this code moves money on its
// own: it cancels a subscription and issues a refund with nobody watching.
//
// What is deliberately pinned:
//   * a duplicate is cancelled AND refunded, and never becomes the trainer's
//     stored subscription
//   * a FIRST subscription is untouched — the guard must not fire on signup
//   * a dead subscription beside a new one is not a duplicate
//   * deleting a subscription we do not hold does nothing
//   * deleting the one we DO hold, while another is live, repoints instead of
//     cancelling the trainer

const h = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  subsList: vi.fn(),
  subsCancel: vi.fn(),
  subsRetrieve: vi.fn(),
  invoicesList: vi.fn(),
  refundsCreate: vi.fn(),
  trainerFindFirst: vi.fn(),
  trainerFindUnique: vi.fn(),
  trainerUpdate: vi.fn(),
  sendEmail: vi.fn(),
  loadPriceIndex: vi.fn(),
  notifyConversion: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: {
      findFirst: h.trainerFindFirst,
      findUnique: h.trainerFindUnique,
      update: h.trainerUpdate,
    },
    trainerAddon: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), updateMany: vi.fn() },
  },
}))
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  stripeFor: () => ({
    webhooks: { constructEvent: h.constructEvent },
    subscriptions: { list: h.subsList, cancel: h.subsCancel, retrieve: h.subsRetrieve },
    invoices: { list: h.invoicesList },
    refunds: { create: h.refundsCreate },
  }),
}))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail }))
vi.mock('@/lib/conversion-alert', () => ({ notifyConversion: h.notifyConversion }))
vi.mock('@/lib/billing', () => ({ loadPriceIndex: h.loadPriceIndex }))
vi.mock('@/lib/env', () => ({
  env: { STRIPE_WEBHOOK_SECRET: 'whsec_live', STRIPE_WEBHOOK_SECRET_TEST: 'whsec_test' },
}))

import { POST } from '@/app/api/webhooks/stripe/route'

const CUSTOMER = 'cus_test'
const sub = (id: string, status: string) => ({
  id, status, customer: CUSTOMER,
  metadata: { trainerId: 'trainer_1' },
  items: { data: [{ id: 'si_1', price: { id: 'price_1' }, quantity: 1, current_period_end: 1_800_000_000 }] },
})

function post(type: string, object: unknown) {
  h.constructEvent.mockReturnValue({ id: 'evt_1', type, data: { object } })
  return POST(new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig' },
    body: '{}',
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.loadPriceIndex.mockResolvedValue(new Map())
  h.trainerFindFirst.mockResolvedValue({ id: 'trainer_1', businessName: 'Mersea Mutts' })
  h.trainerFindUnique.mockResolvedValue({
    id: 'trainer_1', stripeSubscriptionId: 'sub_first',
    subscriptionStatus: 'ACTIVE', stripeCustomerId: CUSTOMER,
  })
  h.trainerUpdate.mockResolvedValue({})
  h.invoicesList.mockResolvedValue({ data: [] })
  h.subsCancel.mockResolvedValue({})
})

describe('a second subscription is cancelled the moment it appears', () => {
  it('cancels and refunds a duplicate, and never adopts it', async () => {
    h.subsList.mockResolvedValue({ data: [sub('sub_first', 'active'), sub('sub_dupe', 'active')] })
    h.invoicesList.mockResolvedValue({
      data: [{ amount_paid: 3100, currency: 'gbp', charge: 'ch_1' }],
    })

    await post('customer.subscription.created', sub('sub_dupe', 'active'))

    expect(h.subsCancel, 'the NEW subscription is cancelled').toHaveBeenCalledWith('sub_dupe')
    expect(h.refundsCreate).toHaveBeenCalledWith({ charge: 'ch_1', reason: 'duplicate' })
    expect(h.sendEmail).toHaveBeenCalled()
    // The whole point: the duplicate must not become the trainer's subscription.
    const adopted = h.trainerUpdate.mock.calls.some(
      c => c[0]?.data?.stripeSubscriptionId === 'sub_dupe',
    )
    expect(adopted, 'the duplicate must never be stored on the trainer').toBe(false)
  })

  it('leaves a FIRST subscription alone', async () => {
    // Nothing else live — this is an ordinary signup and must not be touched.
    h.subsList.mockResolvedValue({ data: [sub('sub_only', 'active')] })

    await post('customer.subscription.created', sub('sub_only', 'active'))

    expect(h.subsCancel).not.toHaveBeenCalled()
    expect(h.refundsCreate).not.toHaveBeenCalled()
  })

  it('does not treat a dead subscription as a live duplicate', async () => {
    h.subsList.mockResolvedValue({ data: [sub('sub_old', 'canceled'), sub('sub_new', 'active')] })

    await post('customer.subscription.created', sub('sub_new', 'active'))

    expect(h.subsCancel).not.toHaveBeenCalled()
  })
})

describe('a cancellation cannot cancel a trainer who still has a subscription', () => {
  it('ignores the deletion of a subscription we do not hold', async () => {
    await post('customer.subscription.deleted', sub('sub_someone_else', 'canceled'))

    const cancelled = h.trainerUpdate.mock.calls.some(
      c => c[0]?.data?.subscriptionStatus === 'CANCELLED',
    )
    expect(cancelled, 'must not cancel the trainer').toBe(false)
  })

  it('repoints to the survivor rather than cancelling the trainer', async () => {
    // Exactly the Mersea Mutts repair: our subscription is cancelled to clear a
    // duplicate, while the one they actually use is still live.
    h.subsList.mockResolvedValue({ data: [sub('sub_first', 'canceled'), sub('sub_keep', 'active')] })

    await post('customer.subscription.deleted', sub('sub_first', 'canceled'))

    const call = h.trainerUpdate.mock.calls.at(-1)?.[0]
    expect(call?.data?.stripeSubscriptionId, 'moved to the survivor').toBe('sub_keep')
    expect(call?.data?.subscriptionStatus).not.toBe('CANCELLED')
  })
})
