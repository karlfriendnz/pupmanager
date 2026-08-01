import type { ClientMembership } from './client-memberships'

// The decision a membership card makes, in a module with NO prisma import.
//
// It lives apart from client-memberships.ts for the same reason
// membership-consent-copy.ts does: the card is a 'use client' component, and a
// client component importing anything that reaches prisma drags `pg` into the
// browser bundle, where it fails to resolve `dns` and takes the whole page down
// with a 500. Types are safe to import across that line because they are
// erased; functions are not.

/** What a card offers, once every rule has been applied. */
export type CardAction =
  | { kind: 'LOCKED'; copy: string }
  | { kind: 'SUBSCRIBED' }
  | { kind: 'SWITCH'; movingUp: boolean; copy: string }
  | { kind: 'BUY'; needsConsent: boolean }
  | { kind: 'REQUEST'; copy: string }

const BLOCKED_COPY: Record<'RECURRING' | 'NO_PRICE', string> = {
  RECURRING: 'This one bills you regularly, so it has to be set up for you before you can buy it.',
  NO_PRICE: 'This one doesn’t have a price on it yet.',
}

/**
 * The ONE decision a membership card makes, extracted from the JSX so it can be
 * reasoned about and tested — the same reason `resolveBuyability` and
 * `resolveEligibility` are pure functions rather than conditions inline.
 *
 * ORDER IS THE WHOLE THING. Locked comes before everything, so a package a
 * client cannot join never shows a way in. Already-subscribed comes before
 * switch, so their own plan says "you're on this" rather than offering to move
 * them to it. Switch comes before buy, because buying while already on a
 * recurring plan would open a SECOND subscription beside the one they pay for
 * rather than changing it.
 */
export function resolveCardAction(
  m: ClientMembership,
  currentPlan: { membershipId: string; priceCents: number | null } | null,
): CardAction {
  if (!m.eligible) return { kind: 'LOCKED', copy: lockedCopy(m) }
  if (m.subscribed) return { kind: 'SUBSCRIBED' }

  const isSwitch =
    !!currentPlan &&
    m.cadence === 'RECURRING' &&
    m.id !== currentPlan.membershipId &&
    m.plans.length > 0
  if (isSwitch) {
    const movingUp = (m.plans[0]?.priceCents ?? 0) > (currentPlan?.priceCents ?? 0)
    return {
      kind: 'SWITCH',
      movingUp,
      // Says what happens to their money, because a plan change takes some (or
      // credits some) and doing that silently is how people lose trust.
      copy: movingUp
        ? 'You’ll be charged the difference for the rest of this period.'
        : 'The difference comes off your next bill.',
    }
  }

  if (m.buyable) return { kind: 'BUY', needsConsent: m.needsConsent }
  return { kind: 'REQUEST', copy: BLOCKED_COPY[m.blockedReason ?? 'NO_PRICE'] }
}

/**
 * What a locked package says, in the client's own terms.
 *
 * Never "you are not allowed": the point of showing a locked rung is to tell
 * someone what to work towards. Invite-only says who to ask, because there is
 * nothing they can do about it themselves.
 */
export function lockedCopy(m: Pick<ClientMembership, 'lockedReason' | 'missingAchievements'>): string {
  if (m.lockedReason === 'INVITE_ONLY') return 'Your trainer invites people to this one.'
  const names = m.missingAchievements
  if (names.length === 1) return `Earn ${names[0]} to unlock this.`
  if (names.length > 1) {
    const all = [...names]
    const last = all.pop()
    return `Earn ${all.join(', ')} and ${last} to unlock this.`
  }
  return 'Not available to you yet.'
}
