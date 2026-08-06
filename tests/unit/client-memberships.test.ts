import { describe, it, expect, vi, beforeEach } from 'vitest'

// The shared client-facing membership loader, used by BOTH the /my-memberships
// storefront and the Offerings flow. Pins the tenant/publish filter and the
// per-item label/image/description resolution (override wins over the
// offering's own; a class run's blurb comes from its package).

const h = vi.hoisted(() => ({
  membership: { findMany: vi.fn() },
  membershipRequest: { findMany: vi.fn() },
  membershipPurchase: { findMany: vi.fn() },
  trainerProfile: { findUnique: vi.fn() },
  // Eligibility — who may join, as opposed to whether it can be paid for.
  membershipPrerequisite: { findMany: vi.fn() },
  clientAchievement: { findMany: vi.fn() },
  achievement: { findMany: vi.fn() },
  package: { findMany: vi.fn() },
  classRun: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
}))
// The loader is add-on gated; these tests are about what it loads, so it's on.
vi.mock('@/lib/billing', () => ({ hasAddon: vi.fn(async () => true) }))
vi.mock('@/lib/prisma', () => ({ prisma: h }))

import { loadPublishedMemberships } from '@/lib/client-memberships'

const CARD = {
  imageUrl: 'm.jpg', bgColor: '#fff', headerColor: '#000', textColor: '#333', featuredColor: '#7c3aed',
  buttonBgColor: '#0d9488', buttonTextColor: '#ffffff', buttonText: 'Join',
}

/**
 * A trainer who can genuinely take a recurring card payment.
 *
 * All four flags, because the storefront gates on the real capability rather
 * than the recurringPaymentsEnabled allowlist alone — see canChargeRecurring.
 */
const CAN_CHARGE = {
  acceptPaymentsEnabled: true,
  connectChargesEnabled: true,
  connectAccountId: 'acct_1',
  recurringPaymentsEnabled: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.package.findMany.mockResolvedValue([])
  h.classRun.findMany.mockResolvedValue([])
  h.product.findMany.mockResolvedValue([])
  h.membershipRequest.findMany.mockResolvedValue([])
  h.membershipPurchase.findMany.mockResolvedValue([])
  // Ungated by default: these tests are about what the loader loads, and
  // eligibility has its own suite in membership-eligibility.test.ts.
  h.membershipPrerequisite.findMany.mockResolvedValue([])
  h.clientAchievement.findMany.mockResolvedValue([])
  h.achievement.findMany.mockResolvedValue([])
  // Recurring is OFF by default for every trainer — that column is the rollout
  // allowlist now that the env var is gone.
  h.trainerProfile.findUnique.mockResolvedValue({
    ...CAN_CHARGE, recurringPaymentsEnabled: false, businessName: 'E2E Dog School', payoutCurrency: 'nzd',
  })
})

describe('loadPublishedMemberships', () => {
  it('asks only for this trainer\'s published memberships', async () => {
    h.membership.findMany.mockResolvedValue([])
    const out = await loadPublishedMemberships('t1')

    expect(out).toEqual([])
    // No cadence filter: a recurring plan is loaded too (flagged unbuyable
    // below) rather than vanishing from both client screens with no explanation.
    expect(h.membership.findMany.mock.calls[0][0].where).toEqual({ trainerId: 't1', published: true })
    // Nothing to resolve — no follow-up offering queries.
    expect(h.package.findMany).not.toHaveBeenCalled()
    expect(h.classRun.findMany).not.toHaveBeenCalled()
    expect(h.product.findMany).not.toHaveBeenCalled()
  })

  it('resolves each item from its offering, with per-item overrides winning', async () => {
    h.membership.findMany.mockResolvedValue([{
      id: 'm1', name: 'Puppy Starter', description: '<p>Everything</p>', priceCents: 12000, ...CARD,
      items: [
        // No overrides — falls back to the package's own name/description.
        { packageId: 'p1', classRunId: null, productId: null, quantity: 2, imageUrl: null, description: null },
        // Class run: image is its own, blurb comes from its package.
        { packageId: null, classRunId: 'r1', productId: null, quantity: 1, imageUrl: null, description: null },
        // Overrides win over the product's own image + description.
        { packageId: null, classRunId: null, productId: 'x1', quantity: 1, imageUrl: 'over.jpg', description: 'Override blurb' },
      ],
    }])
    h.package.findMany.mockResolvedValue([{ id: 'p1', name: '4-pack', description: 'Four sessions' }])
    h.classRun.findMany.mockResolvedValue([{ id: 'r1', name: 'Puppy 101', imageUrl: 'run.jpg', package: { description: 'From the package' } }])
    h.product.findMany.mockResolvedValue([{ id: 'x1', name: 'Lead', imageUrl: 'lead.jpg', description: 'Own blurb' }])

    const [m] = await loadPublishedMemberships('t1')

    expect(m).toMatchObject({ id: 'm1', name: 'Puppy Starter', priceCents: 12000, ...CARD })
    expect(m.items).toEqual([
      { label: '4-pack', quantity: 2, imageUrl: null, description: 'Four sessions' },
      { label: 'Puppy 101', quantity: 1, imageUrl: 'run.jpg', description: 'From the package' },
      { label: 'Lead', quantity: 1, imageUrl: 'over.jpg', description: 'Override blurb' },
    ])
  })

  // `buyable` mirrors exactly what POST /api/my/memberships/[id]/buy will take:
  // a priced one-off, or a priced recurring plan on a trainer switched on for
  // recurring payments. Anything else is refused there, so the card must never
  // offer a button the API rejects.
  it('marks a one-off with a price buyable', async () => {
    h.membership.findMany.mockResolvedValue([{
      id: 'm1', name: 'Bundle', description: null, priceCents: 12000, cadence: 'ONE_OFF', interval: null,
      ...CARD, items: [], plans: [],
    }])
    const [m] = await loadPublishedMemberships('t1')
    expect(m.buyable).toBe(true)
    expect(m.cadence).toBe('ONE_OFF')
    // No "/ month" suffix should ever be derivable for a one-off.
    expect(m.interval).toBeNull()
    expect(m.plans).toEqual([])
  })

  it('returns a recurring plan, flagged unbuyable, with its interval and options', async () => {
    h.membership.findMany.mockResolvedValue([{
      id: 'm2', name: 'Juniors', description: null, priceCents: 40000, cadence: 'RECURRING', interval: 'MONTH',
      ...CARD, items: [],
      plans: [{ id: 'pl1', interval: 'WEEK', priceCents: 10000 }, { id: 'pl2', interval: 'MONTH', priceCents: 40000 }],
    }])
    const [m] = await loadPublishedMemberships('t1')
    expect(m).toMatchObject({ id: 'm2', cadence: 'RECURRING', interval: 'MONTH', buyable: false })
    // Each option now also carries a display label and (when buyable) its own
    // consent wording — null here, because this trainer isn't switched on.
    expect(m.plans).toEqual([
      { id: 'pl1', interval: 'WEEK', priceCents: 10000, priceLabel: '$100.00 / week', consent: null },
      { id: 'pl2', interval: 'MONTH', priceCents: 40000, priceLabel: '$400.00 / month', consent: null },
    ])
  })

  it('marks an unpriced one-off unbuyable', async () => {
    h.membership.findMany.mockResolvedValue([{
      id: 'm3', name: 'Free?', description: null, priceCents: 0, cadence: 'ONE_OFF', interval: null,
      ...CARD, items: [], plans: [],
    }])
    const [m] = await loadPublishedMemberships('t1')
    expect(m.buyable).toBe(false)
  })

  // The card's "Requested" state is read from the DB, not held in component
  // state — otherwise a reload forgets it and the client taps again (and again).
  it('marks a package the client has already asked for as requested', async () => {
    h.membership.findMany.mockResolvedValue([
      { id: 'm1', name: 'Juniors', description: null, priceCents: 40000, cadence: 'RECURRING', interval: 'MONTH', ...CARD, items: [], plans: [] },
      { id: 'm2', name: 'Other', description: null, priceCents: 0, cadence: 'ONE_OFF', interval: null, ...CARD, items: [], plans: [] },
    ])
    h.membershipRequest.findMany.mockResolvedValue([{ membershipId: 'm1' }])

    const out = await loadPublishedMemberships('t1', 'c1')

    expect(out.map(m => [m.id, m.requested, m.blockedReason])).toEqual([
      ['m1', true, 'RECURRING'],
      ['m2', false, 'NO_PRICE'],
    ])
    expect(h.membershipRequest.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'c1', status: 'PENDING' })
  })

  it('skips the request lookup entirely when no client is in context', async () => {
    h.membership.findMany.mockResolvedValue([
      { id: 'm1', name: 'Juniors', description: null, priceCents: 40000, cadence: 'RECURRING', interval: 'MONTH', ...CARD, items: [], plans: [] },
    ])
    const [m] = await loadPublishedMemberships('t1')
    expect(m.requested).toBe(false)
    expect(h.membershipRequest.findMany).not.toHaveBeenCalled()
  })

  // ─── Recurring (Phase 1) ──────────────────────────────────────────────────

  const RECURRING = {
    id: 'm9', name: 'Juniors', description: null, priceCents: 40000,
    cadence: 'RECURRING' as const, interval: 'MONTH' as const, ...CARD, items: [],
    plans: [{ id: 'pl1', interval: 'MONTH', priceCents: 40000, minTermCount: 0, earlyTermFeeCents: null }],
  }

  it('makes a recurring plan buyable once the trainer is switched on', async () => {
    h.trainerProfile.findUnique.mockResolvedValue({
      ...CAN_CHARGE, businessName: 'E2E Dog School', payoutCurrency: 'nzd',
    })
    h.membership.findMany.mockResolvedValue([RECURRING])

    const [m] = await loadPublishedMemberships('t1', 'c1')

    expect(m).toMatchObject({ buyable: true, blockedReason: null, needsConsent: true, subscribed: false })
  })

  it('falls back to "Request this" while the trainer is NOT switched on', async () => {
    // recurringPaymentsEnabled is the rollout allowlist — off means the old
    // ask-the-trainer path, not a broken button.
    h.membership.findMany.mockResolvedValue([RECURRING])
    const [m] = await loadPublishedMemberships('t1', 'c1')
    expect(m).toMatchObject({ buyable: false, blockedReason: 'RECURRING', needsConsent: false })
    expect(m.consent).toBeNull()
  })

  // AGENTS.md #6 — gate on the fact, not a proxy for it.
  //
  // This used to read recurringPaymentsEnabled ALONE. That column says a
  // trainer is PERMITTED to sell subscriptions; it says nothing about whether
  // Stripe will accept a charge. An allowlisted trainer who never finished
  // Connect onboarding (or whose account got restricted mid-verification) had a
  // live Subscribe button on every card, and every client who tapped it got the
  // buy route's "Payments aren't switched on yet" 409 — which neither of them
  // could do anything about, and which the trainer never heard about at all.
  for (const missing of ['acceptPaymentsEnabled', 'connectChargesEnabled', 'connectAccountId'] as const) {
    it(`offers "Request this", not Subscribe, when the trainer has no ${missing}`, async () => {
      h.trainerProfile.findUnique.mockResolvedValue({
        ...CAN_CHARGE,
        [missing]: missing === 'connectAccountId' ? null : false,
        businessName: 'E2E Dog School', payoutCurrency: 'nzd',
      })
      h.membership.findMany.mockResolvedValue([RECURRING])

      const [m] = await loadPublishedMemberships('t1', 'c1')
      expect(m).toMatchObject({ buyable: false, blockedReason: 'RECURRING' })
      // No agreement is offered for something that cannot be bought.
      expect(m.consent).toBeNull()
    })
  }

  it('asks for the whole capability, not just the allowlist column', async () => {
    h.membership.findMany.mockResolvedValue([RECURRING])
    await loadPublishedMemberships('t1', 'c1')
    expect(h.trainerProfile.findUnique.mock.calls[0][0].select).toMatchObject({
      acceptPaymentsEnabled: true,
      connectChargesEnabled: true,
      connectAccountId: true,
      recurringPaymentsEnabled: true,
    })
  })

  it('builds the consent copy server-side from the plan', async () => {
    h.trainerProfile.findUnique.mockResolvedValue({
      ...CAN_CHARGE, businessName: 'Mersea Mutts', payoutCurrency: 'gbp',
    })
    h.membership.findMany.mockResolvedValue([{
      ...RECURRING,
      plans: [{ id: 'pl1', interval: 'MONTH', priceCents: 40000, minTermCount: 3, earlyTermFeeCents: 5000 }],
    }])

    const [m] = await loadPublishedMemberships('t1', 'c1')

    // The trainer is named as the party charging, in their own currency.
    expect(m.consent?.text).toBe('I agree Mersea Mutts can charge my card £400.00 every month until I cancel.')
    expect(m.consent?.termLabel).toBe("You're committing to 3 months.")
    expect(m.consent?.earlyTermFeeLabel).toContain('£50.00')
  })

  it('stops selling a plan the client is already subscribed to', async () => {
    // Otherwise a second tap stacks a second monthly charge on the same plan.
    h.trainerProfile.findUnique.mockResolvedValue({
      ...CAN_CHARGE, businessName: 'X', payoutCurrency: 'nzd',
    })
    h.membership.findMany.mockResolvedValue([RECURRING])
    h.membershipPurchase.findMany.mockResolvedValue([{ membershipId: 'm9' }])

    const [m] = await loadPublishedMemberships('t1', 'c1')

    expect(m).toMatchObject({ subscribed: true, buyable: false, blockedReason: null })
    // Not "blocked" — the card says "You're on this plan", not an excuse.
    expect(m.consent).toBeNull()
    expect(h.membershipPurchase.findMany.mock.calls[0][0].where).toMatchObject({
      clientId: 'c1',
      status: { in: ['ACTIVE', 'PAST_DUE', 'CANCELLING'] },
    })
  })

  it('gives EVERY billing option its own consent wording', async () => {
    // A weekly and a monthly plan are two different agreements. One set of
    // words for both would store a consent that didn't match the screen.
    h.trainerProfile.findUnique.mockResolvedValue({
      ...CAN_CHARGE, businessName: 'E2E Dog School', payoutCurrency: 'nzd',
    })
    h.membership.findMany.mockResolvedValue([{
      ...RECURRING,
      plans: [
        { id: 'weekly', interval: 'WEEK', priceCents: 1000, minTermCount: 0, earlyTermFeeCents: null },
        { id: 'monthly', interval: 'MONTH', priceCents: 3500, minTermCount: 6, earlyTermFeeCents: 2000 },
      ],
    }])

    const [m] = await loadPublishedMemberships('t1', 'c1')

    expect(m.plans.map(p => p.priceLabel)).toEqual(['$10.00 / week', '$35.00 / month'])
    expect(m.plans[0].consent?.text).toContain('$10.00 every week')
    expect(m.plans[1].consent?.text).toContain('$35.00 every month')
    // Terms and fees follow the option, not the membership.
    expect(m.plans[0].consent?.termLabel).toBe('Cancel any time.')
    expect(m.plans[1].consent?.termLabel).toBe("You're committing to 6 months.")
    expect(m.plans[1].consent?.earlyTermFeeLabel).toContain('$20.00')
    // The card headline still describes the FIRST option — the one the buy
    // route falls back to when no planId is sent.
    expect(m.consent?.text).toBe(m.plans[0].consent?.text)
  })

  it('prices an every-6-weeks option as "/ 6 weeks" on the storefront, not "/ week"', async () => {
    // The client's card and the sentence they tick come from the same function,
    // so this is the storefront half of the same guarantee the consent copy
    // makes: what is on screen is what is charged.
    h.trainerProfile.findUnique.mockResolvedValue({
      ...CAN_CHARGE, businessName: 'Mersea Mutts', payoutCurrency: 'nzd',
    })
    h.membership.findMany.mockResolvedValue([{
      ...RECURRING,
      plans: [
        { id: 'sixweek', interval: 'WEEK', intervalCount: 6, priceCents: 6000, minTermCount: 0, earlyTermFeeCents: null },
        { id: 'monthly', interval: 'MONTH', intervalCount: 1, priceCents: 3500, minTermCount: 0, earlyTermFeeCents: null },
      ],
    }])

    const [m] = await loadPublishedMemberships('t1', 'c1')

    expect(m.plans.map(p => p.priceLabel)).toEqual(['$60.00 / 6 weeks', '$35.00 / month'])
    expect(m.plans[0].intervalCount).toBe(6)
    expect(m.plans[0].consent?.text).toContain('$60.00 every 6 weeks')
    // The single-cycle option is untouched — never "/ 1 month".
    expect(m.plans[1].consent?.text).toContain('$35.00 every month')
  })

  it('reads a plan with no stored count as one cycle — a row this deploy hasn’t reached', async () => {
    h.trainerProfile.findUnique.mockResolvedValue({
      ...CAN_CHARGE, businessName: 'X', payoutCurrency: 'nzd',
    })
    h.membership.findMany.mockResolvedValue([{
      ...RECURRING,
      plans: [{ id: 'legacy', interval: 'FORTNIGHT', priceCents: 4800, minTermCount: 0, earlyTermFeeCents: null }],
    }])

    const [m] = await loadPublishedMemberships('t1', 'c1')
    expect(m.plans[0].priceLabel).toBe('$48.00 / fortnight')
  })

  it('leaves plan consent null when the plan cannot be bought', async () => {
    h.membership.findMany.mockResolvedValue([RECURRING])
    const [m] = await loadPublishedMemberships('t1', 'c1')
    expect(m.plans[0].consent).toBeNull()
  })

  it('never offers an archived plan', async () => {
    // Archived plans keep billing their existing subscribers but must not be
    // sold again — that is what archiving means.
    h.membership.findMany.mockResolvedValue([])
    await loadPublishedMemberships('t1')
    expect(h.membership.findMany.mock.calls[0][0].include.plans.where).toEqual({ archivedAt: null })
  })

  it('drops items whose offering no longer exists rather than rendering a blank row', async () => {
    h.membership.findMany.mockResolvedValue([{
      id: 'm1', name: 'Bundle', description: null, priceCents: 5000, ...CARD,
      items: [
        { packageId: 'gone', classRunId: null, productId: null, quantity: 1, imageUrl: null, description: null },
        { packageId: 'p1', classRunId: null, productId: null, quantity: 1, imageUrl: null, description: null },
      ],
    }])
    h.package.findMany.mockResolvedValue([{ id: 'p1', name: 'Still here', description: null }])

    const [m] = await loadPublishedMemberships('t1')

    expect(m.items).toEqual([{ label: 'Still here', quantity: 1, imageUrl: null, description: null }])
  })
})
