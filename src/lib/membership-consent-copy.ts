import { formatMoney } from './money'
import { addCycles, cycleTermLabel, intervalLabel, type PlanInterval } from './billing-interval'

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
  /** How many of the unit make one cycle. Absent = 1, i.e. today's wording. */
  intervalCount?: number
}): string {
  const amount = formatMoney(args.priceCents, args.currency)
  // "every week" / "every 6 weeks" — never "every 1 week". A count honoured at
  // Stripe but missing from this sentence is a client agreeing to one thing and
  // being charged another, which is the whole reason this is one function.
  return `I agree ${args.businessName} can charge my card ${amount} every ${intervalLabel(args.interval, args.intervalCount ?? 1)} until I cancel.`
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
  /** How many of the unit make one cycle. Absent = 1, i.e. today's wording. */
  intervalCount?: number
  minTermCount: number
  earlyTermFeeCents: number | null
  from?: Date
}): PlanCommitment {
  const from = args.from ?? new Date()
  const amount = formatMoney(args.priceCents, args.currency)
  const count = args.intervalCount ?? 1
  const unit = intervalLabel(args.interval, count)

  return {
    consentText: buildConsentText(args),
    consentVersion: RECURRING_CONSENT_VERSION,
    priceLabel: `${amount} every ${unit}`,
    firstChargeLabel: 'Today',
    nextChargeAt: addCycles(from, args.interval, 1, count),
    committedUntil: args.minTermCount > 0 ? addCycles(from, args.interval, args.minTermCount, count) : null,
    // "Cancel any time" is the honest headline when there is no minimum term,
    // and it is the thing a client most wants to know before handing over a card.
    //
    // The term is stated in the BASE unit — "12 weeks", not "2 cycles" and
    // certainly not "2 6 weekss". With a count of 1 this is character-for-
    // character the sentence it has always been.
    termLabel: args.minTermCount > 0
      ? `You're committing to ${cycleTermLabel(args.interval, count, args.minTermCount)}.`
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
