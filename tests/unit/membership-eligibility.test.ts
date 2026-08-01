import { describe, it, expect } from 'vitest'

import { resolveEligibility, type EligibilityMode } from '@/lib/membership-eligibility'

// WHO may join a package. The rule is small on purpose — it is consulted by the
// storefront, the buy route and the switch route, and all three have to reach
// the same answer or a card offers a button the API refuses.
//
// The three properties that carry the design, from Karl on 2026-08-01
// ("juniors can't necessarily go into a senior package"):
//
//   1. Checked only at the POINT OF JOINING. Someone already paying is never
//      evicted by a prerequisite added after they joined.
//   2. ALL prerequisites, never any-of — a ladder is a sequence.
//   3. An invitation beats the mode. A trainer naming a client has made a
//      decision; the ladder is what happens when they haven't.

const base = {
  mode: 'PUBLIC' as EligibilityMode,
  requires: [] as string[],
  holds: new Set<string>(),
  invited: false,
  subscribed: false,
}

describe('a public package', () => {
  it('is open to anyone', () => {
    expect(resolveEligibility(base)).toMatchObject({ eligible: true, lockedReason: null })
  })

  it('stays open even with prerequisites sitting on the row', () => {
    // Prerequisites are only consulted in ACHIEVEMENT mode. A trainer who set
    // some up and then switched the package back to public has changed their
    // mind, and the rows are inert until they change it back.
    const r = resolveEligibility({ ...base, requires: ['a1'], holds: new Set() })
    expect(r.eligible).toBe(true)
  })
})

describe('the ladder', () => {
  const gated = { ...base, mode: 'ACHIEVEMENT' as EligibilityMode, requires: ['bronze', 'silver'] }

  it('locks someone who holds none of it', () => {
    const r = resolveEligibility(gated)
    expect(r).toMatchObject({ eligible: false, lockedReason: 'ACHIEVEMENT' })
    expect(r.missing).toEqual(['bronze', 'silver'])
  })

  it('still locks someone who holds SOME of it — all, never any-of', () => {
    // The property that makes it a ladder. Any-of would let a client skip a rung.
    const r = resolveEligibility({ ...gated, holds: new Set(['bronze']) })
    expect(r.eligible).toBe(false)
    expect(r.missing).toEqual(['silver'])
  })

  it('opens once every prerequisite is held', () => {
    const r = resolveEligibility({ ...gated, holds: new Set(['bronze', 'silver']) })
    expect(r).toMatchObject({ eligible: true, lockedReason: null, missing: [] })
  })

  it('ignores achievements from other ladders', () => {
    const r = resolveEligibility({ ...gated, holds: new Set(['gold', 'agility']) })
    expect(r.eligible).toBe(false)
    expect(r.missing).toEqual(['bronze', 'silver'])
  })

  it('is OPEN when the mode is set but no prerequisites are chosen yet', () => {
    // A half-finished setting is not a locked door. Treating it as locked would
    // take a trainer's package off every client's screen the moment they picked
    // the mode and before they picked the achievements.
    const r = resolveEligibility({ ...base, mode: 'ACHIEVEMENT', requires: [] })
    expect(r.eligible).toBe(true)
  })
})

describe('invite-only', () => {
  it('is closed to someone who was not invited', () => {
    const r = resolveEligibility({ ...base, mode: 'INVITE_ONLY' })
    expect(r).toMatchObject({ eligible: false, lockedReason: 'INVITE_ONLY', missing: [] })
  })

  it('opens for someone who was', () => {
    const r = resolveEligibility({ ...base, mode: 'INVITE_ONLY', invited: true })
    expect(r.eligible).toBe(true)
  })
})

describe('an invitation beats the ladder', () => {
  it('lets an invited client into an achievement-gated package they have not earned', () => {
    // The trainer has looked at this specific client and decided. That is a
    // stronger signal than the default the ladder encodes.
    const r = resolveEligibility({
      ...base,
      mode: 'ACHIEVEMENT',
      requires: ['bronze'],
      holds: new Set(),
      invited: true,
    })
    expect(r).toMatchObject({ eligible: true, lockedReason: null })
  })
})

describe('nobody is evicted by a rule added later', () => {
  it('keeps an existing subscriber eligible for a package they could no longer join', () => {
    // The property that makes prerequisites safe to tighten. Without it, a
    // trainer raising the bar would cut off the people already paying — and
    // they would find out when their access stopped.
    const r = resolveEligibility({
      ...base,
      mode: 'ACHIEVEMENT',
      requires: ['bronze', 'silver', 'gold'],
      holds: new Set(),
      subscribed: true,
    })
    expect(r).toMatchObject({ eligible: true, lockedReason: null, missing: [] })
  })

  it('keeps an existing subscriber in an invite-only package with no invite on file', () => {
    const r = resolveEligibility({ ...base, mode: 'INVITE_ONLY', subscribed: true })
    expect(r.eligible).toBe(true)
  })
})
