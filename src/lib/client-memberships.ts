import { prisma } from './prisma'
import { hasAddon } from './billing'
import {
  loadEligibilityContext,
  resolveEligibility,
  type EligibilityMode,
} from './membership-eligibility'
import { describePlanCommitment } from './membership-consent-copy'
import { accessPausedReason } from './membership-access'
import { formatMoney } from './money'
import type { PlanInterval } from './connect-subscriptions'

// The client-facing shape of a published membership (matches ClientMembershipsView's
// card): card styling + resolved included-item labels/images/descriptions.
export interface ClientMembershipItem { label: string; quantity: number; imageUrl: string | null; description: string | null }
export type ClientMembershipInterval = 'WEEK' | 'FORTNIGHT' | 'MONTH'
export interface ClientMembership {
  id: string; name: string; description: string | null; priceCents: number
  imageUrl: string | null; bgColor: string | null; headerColor: string | null; textColor: string | null; featuredColor: string | null
  buttonBgColor: string | null; buttonTextColor: string | null; buttonText: string | null
  items: ClientMembershipItem[]
  cadence: 'ONE_OFF' | 'RECURRING'
  /** Billing period of the headline price. Null for a one-off. */
  interval: ClientMembershipInterval | null
  /**
   * The billing options a RECURRING plan offers (e.g. $10/wk OR $35/mo). Each
   * carries its own consent copy, because each is a different agreement — a
   * different price, a different frequency, and possibly a different minimum
   * term and early-finish fee.
   */
  plans: {
    id: string
    interval: ClientMembershipInterval
    priceCents: number
    priceLabel: string
    consent: MembershipConsentCopy | null
  }[]
  /**
   * Can a client actually check this out right now? A ONE_OFF needs a price; a
   * RECURRING one needs a priced plan AND the trainer switched on for recurring
   * payments. The UI reads this rather than re-deriving the rule, so a listing
   * can never offer a button the API would reject.
   */
  buyable: boolean
  /**
   * Why checkout can't take it — drives the card's explanation. Null when it is
   * buyable. Mirrors what POST …/request would record.
   */
  blockedReason: 'RECURRING' | 'NO_PRICE' | null
  /** This client already has a PENDING request in for it. */
  requested: boolean
  /**
   * RECURRING only: a subscription needs explicit, recorded consent, so the card
   * opens a confirmation screen instead of going straight to Stripe.
   */
  needsConsent: boolean
  /** The client is already subscribed — the card says so instead of selling again. */
  subscribed: boolean
  /**
   * May THIS client join it at all? Separate from `buyable`, which is about
   * whether money can change hands. A package can be perfectly buyable and
   * still not be theirs to buy.
   */
  eligible: boolean
  /** Why it's locked, for the card's wording. Null when they can join. */
  lockedReason: 'ACHIEVEMENT' | 'INVITE_ONLY' | null
  /** Names of the achievements still needed — "You still need: Bronze Recall". */
  missingAchievements: string[]
  /**
   * RECURRING + buyable only: the exact sentences the consent screen must show,
   * built server-side by the SAME function that writes the stored consent, so
   * the screen and the record can never disagree.
   */
  consent: MembershipConsentCopy | null
}

/** The sentences a consent screen must show for one billing option. */
export interface MembershipConsentCopy {
  text: string
  priceLabel: string
  termLabel: string
  earlyTermFeeLabel: string | null
  cancelWhereLabel: string
  nextChargeLabel: string
}

/** A recurring membership this client is (or was recently) paying for. */
export interface ClientSubscription {
  purchaseId: string
  /** The package itself — what a switch compares against, and moves away from. */
  membershipId: string
  name: string
  /** Per-period price of the plan they're on, so a switch can say up or down. */
  priceCents: number | null
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLING' | 'CANCELLED' | 'PAUSED' | 'LAPSED'
  priceLabel: string | null
  /** End of the period they have already paid for. */
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  /** End of a minimum term, when there is one and it hasn't passed. */
  committedUntil: string | null
  /**
   * Plain words for why this plan isn't giving them anything right now, from
   * the single access-policy function. Null when it is working normally.
   */
  pausedReason: string | null
  /** The card on file, so "the card ending 4242" means something to them. */
  cardLast4: string | null
  /** Stripe's hosted page for an invoice their BANK needs them to approve. */
  actionRequiredUrl: string | null
}

/**
 * The client's own recurring plans, for the "here's what you're paying for"
 * list and its cancel action.
 *
 * CANCELLED rows are deliberately excluded once they have actually ended —
 * a finished plan is history, not something to show a cancel button beside.
 */
export async function loadClientSubscriptions(clientId: string, currency: string): Promise<ClientSubscription[]> {
  const rows = await prisma.membershipPurchase.findMany({
    where: {
      clientId,
      stripeSubscriptionId: { not: null },
      status: { in: ['ACTIVE', 'PAST_DUE', 'CANCELLING', 'PAUSED'] },
    },
    orderBy: { purchasedAt: 'desc' },
    select: {
      id: true, status: true, currentPeriodEnd: true, committedUntil: true, cancelAtPeriodEnd: true,
      cardLast4: true,
      membershipId: true,
      membership: { select: { name: true } },
      plan: { select: { priceCents: true, interval: true } },
      // An invoice the client's bank wants them to authorise. Nothing in the
      // app can act for them, so the hosted URL has to be reachable from here.
      invoices: {
        where: { actionRequiredAt: { not: null }, status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { hostedInvoiceUrl: true },
      },
    },
  })

  const now = Date.now()
  return rows.map(r => ({
    purchaseId: r.id,
    membershipId: r.membershipId,
    name: r.membership?.name ?? 'Package',
    priceCents: r.plan?.priceCents ?? null,
    status: r.status as ClientSubscription['status'],
    priceLabel: r.plan
      ? `${formatMoney(r.plan.priceCents, currency)} / ${INTERVAL_WORD[r.plan.interval as ClientMembershipInterval]}`
      : null,
    currentPeriodEnd: r.currentPeriodEnd ? r.currentPeriodEnd.toISOString() : null,
    cancelAtPeriodEnd: r.cancelAtPeriodEnd,
    committedUntil: r.committedUntil && r.committedUntil.getTime() > now ? r.committedUntil.toISOString() : null,
    pausedReason: accessPausedReason(r.status),
    cardLast4: r.cardLast4,
    actionRequiredUrl: r.invoices[0]?.hostedInvoiceUrl ?? null,
  }))
}

const INTERVAL_WORD: Record<ClientMembershipInterval, string> = {
  WEEK: 'week',
  FORTNIGHT: 'fortnight',
  MONTH: 'month',
}

/**
 * The single rule for whether a card can sell. Extracted so the storefront and
 * the buy route cannot drift apart — a card offering a button the API then
 * refuses is the exact failure this shape exists to prevent.
 *
 * A RECURRING plan is buyable when the trainer is switched on for recurring
 * payments and the plan has a price. It still routes through a consent screen
 * rather than straight to Stripe, which is what `needsConsent` marks.
 */
export function resolveBuyability(args: {
  cadence: 'ONE_OFF' | 'RECURRING'
  priceCents: number
  planPriceCents: number | null
  recurringOn: boolean
  subscribed: boolean
}): { buyable: boolean; blockedReason: 'RECURRING' | 'NO_PRICE' | null; needsConsent: boolean } {
  if (args.cadence === 'ONE_OFF') {
    return {
      buyable: args.priceCents > 0,
      blockedReason: args.priceCents > 0 ? null : 'NO_PRICE',
      needsConsent: false,
    }
  }
  // Already paying for it — not buyable, but not "blocked" either. The card
  // shows their plan rather than an explanation of why they can't have it.
  if (args.subscribed) return { buyable: false, blockedReason: null, needsConsent: false }
  // Not switched on for this trainer yet: falls back to the existing
  // "Request this" path, which tells the trainer to set it up.
  if (!args.recurringOn) return { buyable: false, blockedReason: 'RECURRING', needsConsent: false }

  const price = args.planPriceCents ?? args.priceCents
  if (price <= 0) return { buyable: false, blockedReason: 'NO_PRICE', needsConsent: false }
  return { buyable: true, blockedReason: null, needsConsent: true }
}

// The card's own decision lives in membership-card-action.ts — a prisma-free
// module, so the 'use client' card can import it without pulling `pg` into the
// browser bundle. Re-exported here so server callers have one place to look.
export { resolveCardAction, lockedCopy, type CardAction } from './membership-card-action'

/**
 * Load a trainer's published memberships for the client storefront, resolving
 * each included item's name/image/description (per-item override wins;
 * otherwise the offering's own — a class run's blurb comes from its package).
 * Shared by the Memberships storefront and the Offerings flow.
 *
 * Recurring plans come back too, flagged `buyable: false`. They used to be
 * filtered out here, which meant a trainer whose only published membership was
 * recurring saw NOTHING on either screen — no card, no "Packages" type in the
 * booking flow, and no explanation. Showing it and saying it has to be set up
 * by the trainer is honest; hiding their published work is not.
 */
export async function loadPublishedMemberships(trainerId: string, clientId?: string): Promise<ClientMembership[]> {
  // Memberships are a trainer add-on: switched off, clients see none of them —
  // including in the Offerings flow, where they'd otherwise still be buyable.
  if (!(await hasAddon(trainerId, 'memberships'))) return []

  const memberships = await prisma.membership.findMany({
    where: { trainerId, published: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: {
      items: { orderBy: { order: 'asc' } },
      // Archived plans still bill their existing subscribers but must never be
      // OFFERED again — that's what archiving means.
      plans: { where: { archivedAt: null }, orderBy: { order: 'asc' } },
    },
  })
  if (memberships.length === 0) return []

  const pkgIds: string[] = [], runIds: string[] = [], prodIds: string[] = []
  for (const m of memberships) for (const it of m.items) {
    if (it.packageId) pkgIds.push(it.packageId)
    if (it.classRunId) runIds.push(it.classRunId)
    if (it.productId) prodIds.push(it.productId)
  }
  const [pkgs, runs, prods] = await Promise.all([
    pkgIds.length ? prisma.package.findMany({ where: { id: { in: pkgIds } }, select: { id: true, name: true, description: true } }) : [],
    runIds.length ? prisma.classRun.findMany({ where: { id: { in: runIds } }, select: { id: true, name: true, imageUrl: true, package: { select: { description: true } } } }) : [],
    prodIds.length ? prisma.product.findMany({ where: { id: { in: prodIds } }, select: { id: true, name: true, imageUrl: true, description: true } }) : [],
  ])
  // Which of these this client has already asked for. Read from the DB rather
  // than kept in component state so "Requested" survives a reload — otherwise
  // someone taps five times wondering whether the first one worked.
  const requestedIds = clientId
    ? new Set((await prisma.membershipRequest.findMany({
        where: { clientId, status: 'PENDING', membershipId: { in: memberships.map(m => m.id) } },
        select: { membershipId: true },
      })).map(r => r.membershipId))
    : new Set<string>()

  // Recurring is gated per trainer (the old CONNECT_LIVE_ALLOWLIST env var is
  // gone, so this column is the allowlist). Read once for the whole list.
  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { recurringPaymentsEnabled: true, businessName: true, payoutCurrency: true },
  })
  const recurringOn = !!trainer?.recurringPaymentsEnabled
  const businessName = trainer?.businessName ?? 'Your trainer'
  const currency = trainer?.payoutCurrency ?? 'nzd'

  // Which of these the client is already subscribed to — a card must not sell a
  // second monthly charge for a plan they are already paying for.
  const subscribedIds = clientId
    ? new Set((await prisma.membershipPurchase.findMany({
        where: {
          clientId,
          membershipId: { in: memberships.map(m => m.id) },
          status: { in: ['ACTIVE', 'PAST_DUE', 'CANCELLING'] },
          stripeSubscriptionId: { not: null },
        },
        select: { membershipId: true },
      })).map(p => p.membershipId))
    : new Set<string>()

  // Who may join what. One pass for the whole list rather than per card.
  const eligibilityCtx = await loadEligibilityContext({
    membershipIds: memberships.map(m => m.id),
    clientId,
  })
  // Names for the achievements anyone is short of, resolved in one query.
  const gateIds = new Set<string>()
  for (const ids of eligibilityCtx.requiresByMembership.values()) for (const id of ids) gateIds.add(id)
  const achievementName = gateIds.size
    ? new Map((await prisma.achievement.findMany({
        where: { id: { in: [...gateIds] } },
        select: { id: true, name: true },
      })).map(a => [a.id, a.name]))
    : new Map<string, string>()

  const nameOf = new Map<string, string>([...pkgs, ...runs, ...prods].map(x => [x.id, x.name]))
  const imgOf = new Map<string, string | null>([...runs, ...prods].map(x => [x.id, x.imageUrl ?? null]))
  const descOf = new Map<string, string | null>([
    ...pkgs.map(x => [x.id, x.description ?? null] as const),
    ...runs.map(x => [x.id, x.package?.description ?? null] as const),
    ...prods.map(x => [x.id, x.description ?? null] as const),
  ])

  return memberships.flatMap(m => {
    // Defensive: a membership row always carries a plans array from Prisma, but
    // reading [0] off an undefined here would take the whole storefront down.
    const plans = m.plans ?? []
    const eligibility = resolveEligibility({
      mode: m.eligibility as EligibilityMode,
      requires: eligibilityCtx.requiresByMembership.get(m.id) ?? [],
      holds: eligibilityCtx.holds,
      invited: eligibilityCtx.invitedTo.has(m.id),
      subscribed: subscribedIds.has(m.id),
    })
    // Hidden means hidden: a package the trainer chose not to advertise to
    // people who can't join it drops out of the list entirely. `showWhenLocked`
    // is the trainer's call between "work towards this" and "not your business".
    if (!eligibility.eligible && !m.showWhenLocked) return []
    const buyability = resolveBuyability({
      cadence: m.cadence as 'ONE_OFF' | 'RECURRING',
      priceCents: m.priceCents,
      planPriceCents: plans[0]?.priceCents ?? null,
      recurringOn,
      subscribed: subscribedIds.has(m.id),
    })
    // Every option gets its OWN consent copy. A weekly and a monthly plan are
    // two different agreements — different price, different frequency, possibly
    // a different minimum term — so a picker that showed one set of words for
    // both would store a consent that did not match what was on screen.
    const copyFor = (p: { priceCents: number; interval: string; minTermCount: number; earlyTermFeeCents: number | null }) => {
      const c = describePlanCommitment({
        businessName,
        priceCents: p.priceCents,
        currency,
        interval: p.interval as PlanInterval,
        minTermCount: p.minTermCount,
        earlyTermFeeCents: p.earlyTermFeeCents,
      })
      return {
        text: c.consentText,
        priceLabel: c.priceLabel,
        termLabel: c.termLabel,
        earlyTermFeeLabel: c.earlyTermFeeLabel,
        cancelWhereLabel: c.cancelWhereLabel,
        nextChargeLabel: c.nextChargeAt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long' }),
      }
    }
    // The card's headline still describes the FIRST option, which is the one the
    // buy route falls back to when no planId is sent.
    const plan = plans[0] ?? null
    const consent = buyability.needsConsent && plan ? copyFor(plan) : null

    return [{
    id: m.id, name: m.name, description: m.description, priceCents: m.priceCents,
    imageUrl: m.imageUrl, bgColor: m.bgColor, headerColor: m.headerColor, textColor: m.textColor, featuredColor: m.featuredColor,
    buttonBgColor: m.buttonBgColor, buttonTextColor: m.buttonTextColor, buttonText: m.buttonText,
    cadence: m.cadence as 'ONE_OFF' | 'RECURRING',
    interval: m.cadence === 'RECURRING' ? ((m.interval ?? null) as ClientMembershipInterval | null) : null,
    plans: m.cadence === 'RECURRING'
      ? plans.map(p => ({
          id: p.id,
          interval: p.interval as ClientMembershipInterval,
          priceCents: p.priceCents,
          priceLabel: `${formatMoney(p.priceCents, currency)} / ${INTERVAL_WORD[p.interval as ClientMembershipInterval]}`,
          consent: buyability.needsConsent ? copyFor(p) : null,
        }))
      : [],
    ...buyability,
    // Eligibility wins over buyability for the BUTTON: a locked package must
    // never render a working Subscribe, whatever the payment side says.
    buyable: buyability.buyable && eligibility.eligible,
    eligible: eligibility.eligible,
    lockedReason: eligibility.lockedReason,
    missingAchievements: eligibility.missing.map(id => achievementName.get(id) ?? '').filter(Boolean),
    requested: requestedIds.has(m.id),
    subscribed: subscribedIds.has(m.id),
    consent,
    items: m.items
      .map(it => {
        const id = it.packageId ?? it.classRunId ?? it.productId
        return {
          label: id ? nameOf.get(id) ?? '' : '',
          quantity: it.quantity,
          imageUrl: it.imageUrl ?? (id ? imgOf.get(id) ?? null : null),
          description: it.description ?? (id ? descOf.get(id) ?? null : null),
        }
      })
      .filter(x => x.label),
    }]
  })
}
