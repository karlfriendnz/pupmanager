// The client-safe half of the membership-request feature: the serialisable row
// shape the dashboard panel renders, and the wording it is not allowed to
// improvise. Deliberately free of any prisma import so a 'use client' component
// can pull it in.

export type MembershipRequestReasonValue = 'RECURRING' | 'NO_PRICE'
export type MembershipInterval = 'WEEK' | 'FORTNIGHT' | 'MONTH'

/** A shop product a client asked for — the flow this one was modelled on. */
export interface PendingProductRequest {
  id: string
  createdAt: string
  note: string | null
  client: { id: string; name: string | null }
  product: { id: string; name: string }
  /**
   * Which size/colour, when the product has options. The trainer is being
   * asked to go and fetch this thing, and "a harness" isn't a thing.
   */
  variantName?: string | null
}

/** A package a client asked for because checkout refused to take it. */
export interface PendingMembershipRequest {
  id: string
  createdAt: string
  reason: MembershipRequestReasonValue
  /**
   * PENDING — the trainer hasn't answered.
   * INVITED — the trainer asked the client to subscribe and pay, and nothing has
   * been granted. The row stays on the dashboard in that state deliberately: an
   * invitation nobody has acted on is still an unfinished job, and dropping it
   * off the list would make "I asked them to pay" indistinguishable from
   * "nothing happened".
   */
  status: 'PENDING' | 'INVITED'
  /**
   * Can the trainer be offered the PAID route for this row — i.e. would
   * inviting the client actually lead to a checkout that works?
   *
   * Resolved on the SERVER from the trainer's real Connect capability plus this
   * package having a current, priced ongoing option. Never inferred in the
   * browser: offering "send them a payment link" to a trainer who cannot take
   * cards sends the client to a button that 409s, and the trainer never learns
   * why nobody paid.
   */
  canCharge: boolean
  client: { id: string; name: string | null }
  membership: {
    id: string
    name: string
    priceCents: number
    cadence: 'ONE_OFF' | 'RECURRING'
    /** Billing period of the headline price. Null for a one-off. */
    interval: MembershipInterval | null
  }
}

export const INTERVAL_LABEL: Record<MembershipInterval, string> = {
  WEEK: 'week',
  FORTNIGHT: 'fortnight',
  MONTH: 'month',
}

// ─── COPY ───────────────────────────────────────────────────────────────────
// PLACEHOLDER WORDING — Karl approves every client- and trainer-facing sentence,
// and none of the strings below have been through him yet. They are written to
// be accurate rather than final; the shapes they describe are the part that
// matters. Anything here can be reworded without touching a decision.

/**
 * What GRANTING does to the money — stated once, in words, shown verbatim to
 * the trainer before they confirm, and shown ONLY against the grant-it choice.
 *
 * This no longer says PupManager cannot bill an ongoing plan, because it can:
 * the trainer's other choice on that screen is to send the client a payment
 * link, and the subscription then bills itself. What is still true, and what
 * this sentence is for, is that choosing to grant takes NOTHING — the trainer
 * has said they will collect it themselves. Never phrase this as "paid",
 * "purchased" or "active subscription".
 */
export function paymentCaveat(reason: MembershipRequestReasonValue): string {
  return reason === 'RECURRING'
    ? 'No payment is taken. You’re giving them the plan and collecting for it yourself — invoice them each period or arrange it another way.'
    : 'No payment is taken — this package has no price set. Invoice them or collect it another way.'
}

/**
 * The other choice: ask the client to pay for it themselves.
 *
 * Says the two things a trainer needs before choosing it — that nothing is
 * handed over until the money arrives, and that they then never chase it again.
 */
export function chargeExplainer(): string {
  return 'They get a link to set up payment. Nothing is handed over until they’ve paid, and after that it bills itself every period.'
}

/** Why the paid choice isn't on offer, so its absence isn't a mystery. */
export function cannotChargeReason(cadence: 'ONE_OFF' | 'RECURRING'): string {
  return cadence === 'RECURRING'
    ? 'To charge for this you need Stripe connected in Settings → Payments, and an ongoing price on the package.'
    : 'Ongoing payment only applies to a repeating plan.'
}

/** The state line on a row the trainer has already invited the client to pay. */
export function waitingOnClientLine(): string {
  return 'Waiting on them to pay — nothing has been handed over yet'
}

/** One line saying why checkout wouldn't take it, for the request row. */
export function requestReasonLine(
  m: PendingMembershipRequest['membership'],
  price: string,
): string {
  if (m.cadence === 'RECURRING') {
    const per = m.interval ? ` / ${INTERVAL_LABEL[m.interval]}` : ''
    return `Ongoing plan · ${price}${per} · needs setting up`
  }
  return 'No price set on this package yet'
}
