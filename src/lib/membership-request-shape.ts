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
  client: { id: string; name: string }
  product: { id: string; name: string }
}

/** A package a client asked for because checkout refused to take it. */
export interface PendingMembershipRequest {
  id: string
  createdAt: string
  reason: MembershipRequestReasonValue
  client: { id: string; name: string }
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

/**
 * What accepting actually does to the money — stated once, in words, and shown
 * verbatim to the trainer before they confirm.
 *
 * PupManager cannot charge either of these:
 *  - RECURRING has no mandate layer (no saved payment method, no subscription
 *    on the connected account), so there is nothing to bill against.
 *  - NO_PRICE has no amount to charge.
 *
 * Accepting therefore grants the package and records the purchase, and takes
 * NOTHING. Never phrase this as "paid", "purchased" or "active subscription".
 */
export function paymentCaveat(reason: MembershipRequestReasonValue): string {
  return reason === 'RECURRING'
    ? 'No payment is taken. PupManager can’t bill an ongoing plan yet, so you’ll need to invoice them each period or collect it another way.'
    : 'No payment is taken — this package has no price set. Invoice them or collect it another way.'
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
