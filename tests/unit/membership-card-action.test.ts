import { describe, it, expect } from 'vitest'

import { resolveCardAction, lockedCopy } from '@/lib/membership-card-action'
import type { ClientMembership } from '@/lib/client-memberships'

// What a membership card offers. Extracted from the JSX because the ORDER of
// these checks is the whole design, and an ordering bug in a nested ternary is
// invisible until someone is charged twice.
//
// The three that must never be got wrong:
//
//   locked      beats everything — a package you cannot join never shows a way in
//   subscribed  beats switch     — your own plan says "you're on this"
//   switch      beats buy        — buying while on a recurring plan opens a
//                                  SECOND subscription beside the one you pay for

function membership(over: Partial<ClientMembership> = {}): ClientMembership {
  return {
    id: 'm1', name: 'Juniors', description: null, priceCents: 10000,
    imageUrl: null, bgColor: null, headerColor: null, textColor: null, featuredColor: null,
    buttonBgColor: null, buttonTextColor: null, buttonText: null,
    items: [], cadence: 'RECURRING', interval: 'MONTH',
    plans: [{ id: 'p1', interval: 'MONTH', priceCents: 10000, priceLabel: '$100.00 / month', consent: null }],
    buyable: true, blockedReason: null, requested: false, needsConsent: true, subscribed: false,
    eligible: true, lockedReason: null, missingAchievements: [],
    consent: null,
    ...over,
  }
}

const onJuniors = { membershipId: 'm1', priceCents: 10000 }
const onSomethingElse = { membershipId: 'other', priceCents: 10000 }

describe('locked beats everything', () => {
  it('offers no way in, even when the package is otherwise perfectly buyable', () => {
    const a = resolveCardAction(
      membership({ eligible: false, lockedReason: 'ACHIEVEMENT', missingAchievements: ['Bronze Recall'], buyable: true }),
      null,
    )
    expect(a.kind).toBe('LOCKED')
  })

  it('stays locked even for someone already paying for a different plan', () => {
    // The case that would otherwise turn into a Move button onto a rung they
    // have not earned.
    const a = resolveCardAction(
      membership({ eligible: false, lockedReason: 'ACHIEVEMENT', missingAchievements: ['Bronze Recall'] }),
      onSomethingElse,
    )
    expect(a.kind).toBe('LOCKED')
  })
})

describe('their own plan', () => {
  it('says so rather than offering to move them to it', () => {
    const a = resolveCardAction(membership({ subscribed: true }), onJuniors)
    expect(a.kind).toBe('SUBSCRIBED')
  })
})

describe('switching beats buying', () => {
  it('offers a move, not a second subscription, when they are on another plan', () => {
    // Buying here would leave them paying for two packages at once — the shape
    // that produced a live double charge in July.
    const a = resolveCardAction(membership({ id: 'seniors', priceCents: 15000, plans: [{ id: 'p2', interval: 'MONTH', priceCents: 15000, priceLabel: '$150.00 / month', consent: null }] }), onJuniors)
    expect(a.kind).toBe('SWITCH')
  })

  it('calls a dearer plan a move UP and warns money is taken now', () => {
    const a = resolveCardAction(
      membership({ id: 'seniors', plans: [{ id: 'p2', interval: 'MONTH', priceCents: 15000, priceLabel: '$150', consent: null }] }),
      onJuniors,
    )
    expect(a).toMatchObject({ kind: 'SWITCH', movingUp: true })
    if (a.kind === 'SWITCH') expect(a.copy).toContain('charged the difference')
  })

  it('calls a cheaper plan a move down and promises nothing is taken now', () => {
    const a = resolveCardAction(
      membership({ id: 'puppies', plans: [{ id: 'p3', interval: 'MONTH', priceCents: 5000, priceLabel: '$50', consent: null }] }),
      onJuniors,
    )
    expect(a).toMatchObject({ kind: 'SWITCH', movingUp: false })
    if (a.kind === 'SWITCH') expect(a.copy).toContain('next bill')
  })

  it('is an ordinary purchase when they are on nothing at all', () => {
    const a = resolveCardAction(membership(), null)
    expect(a).toMatchObject({ kind: 'BUY', needsConsent: true })
  })

  it('never offers to switch INTO a one-off — there is no subscription to re-price', () => {
    const a = resolveCardAction(
      membership({ id: 'oneoff', cadence: 'ONE_OFF', interval: null, plans: [], needsConsent: false }),
      onJuniors,
    )
    expect(a).toMatchObject({ kind: 'BUY', needsConsent: false })
  })

  it('never offers to switch to a recurring package with no sellable plan', () => {
    // A plan-less recurring package has no Price to move the subscription onto.
    const a = resolveCardAction(
      membership({ id: 'empty', plans: [], buyable: false, blockedReason: 'NO_PRICE' }),
      onJuniors,
    )
    expect(a.kind).toBe('REQUEST')
  })
})

describe('falling back to asking the trainer', () => {
  it('explains an unpriced package rather than showing a dead button', () => {
    const a = resolveCardAction(membership({ buyable: false, blockedReason: 'NO_PRICE', plans: [] }), null)
    expect(a).toMatchObject({ kind: 'REQUEST' })
    if (a.kind === 'REQUEST') expect(a.copy).toContain('price')
  })
})

describe('what a locked card actually says', () => {
  it('names the single achievement they are short of', () => {
    expect(lockedCopy({ lockedReason: 'ACHIEVEMENT', missingAchievements: ['Bronze Recall'] }))
      .toBe('Earn Bronze Recall to unlock this.')
  })

  it('lists several readably rather than as a comma soup', () => {
    expect(lockedCopy({ lockedReason: 'ACHIEVEMENT', missingAchievements: ['Bronze', 'Silver', 'Gold'] }))
      .toBe('Earn Bronze, Silver and Gold to unlock this.')
  })

  it('tells an invite-only client who to ask, since there is nothing they can do', () => {
    expect(lockedCopy({ lockedReason: 'INVITE_ONLY', missingAchievements: [] }))
      .toContain('invites people')
  })

  it('says something rather than nothing when the reason is unknown', () => {
    expect(lockedCopy({ lockedReason: null, missingAchievements: [] })).toBeTruthy()
  })
})
