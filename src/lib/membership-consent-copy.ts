import { formatMoney } from './money'
import { addCycles, intervalLabel, type PlanInterval } from './connect-subscriptions'

// The words a client is shown before they agree to a recurring charge, and the
// dates that go with them.
//
// Deliberately PURE — no prisma, no Stripe, no notifications — for two reasons.
// The storefront needs this copy without dragging the whole billing stack into
// its module graph, and the exact same function has to produce the text on the
// consent SCREEN and the text we STORE, or the record of what they agreed to is
// worth nothing.

/**
 * Bump whenever the wording below changes. Stored on every consent row so we can
 * always answer "which text did THIS client agree to".
 */
export const RECURRING_CONSENT_VERSION = '2026-07-28.1'

/**
 * The verbatim sentence the client ticks.
 *
 * Names the TRAINER as the party taking the money, because that is who it is —
 * the client is paying their dog trainer, not PupManager, and the trainer's name
 * is what will appear on their bank statement.
 */
export function buildConsentText(args: {
  businessName: string
  priceCents: number
  currency: string
  interval: PlanInterval
}): string {
  const amount = formatMoney(args.priceCents, args.currency)
  return `I agree ${args.businessName} can charge my card ${amount} every ${intervalLabel(args.interval)} until I cancel.`
}

export interface PlanCommitment {
  consentText: string
  consentVersion: string
  priceLabel: string
  firstChargeLabel: string
  nextChargeAt: Date
  committedUntil: Date | null
  termLabel: string
  earlyTermFeeLabel: string | null
  cancelWhereLabel: string
}

/**
 * Everything the consent screen must state before someone commits.
 *
 * BILLING DATE: the anniversary of the day they subscribe — Stripe's default.
 * No proration and no first-cycle part-charge, so "you pay today, then the same
 * amount on the same date every cycle" is the whole story.
 */
export function describePlanCommitment(args: {
  businessName: string
  priceCents: number
  currency: string
  interval: PlanInterval
  minTermCount: number
  earlyTermFeeCents: number | null
  from?: Date
}): PlanCommitment {
  const from = args.from ?? new Date()
  const amount = formatMoney(args.priceCents, args.currency)
  const unit = intervalLabel(args.interval)

  return {
    consentText: buildConsentText(args),
    consentVersion: RECURRING_CONSENT_VERSION,
    priceLabel: `${amount} every ${unit}`,
    firstChargeLabel: 'Today',
    nextChargeAt: addCycles(from, args.interval, 1),
    committedUntil: args.minTermCount > 0 ? addCycles(from, args.interval, args.minTermCount) : null,
    // "Cancel any time" is the honest headline when there is no minimum term,
    // and it is the thing a client most wants to know before handing over a card.
    termLabel: args.minTermCount > 0
      ? `You're committing to ${args.minTermCount} ${unit}${args.minTermCount === 1 ? '' : 's'}.`
      : 'Cancel any time.',
    // Phase 1 DISPLAYS the early-finish fee and does not charge it. Showing a
    // number we then don't take is the safe direction to be wrong in.
    earlyTermFeeLabel: args.minTermCount > 0 && args.earlyTermFeeCents && args.earlyTermFeeCents > 0
      ? `If you cancel before then there's a ${formatMoney(args.earlyTermFeeCents, args.currency)} early-finish fee.`
      : null,
    // Naming the exact screen is the difference between a self-serve
    // cancellation and a support email.
    cancelWhereLabel: 'You can cancel any time from Packages in this app.',
  }
}
