import { describe, it, expect } from 'vitest'
import {
  buildConsentText,
  describePlanCommitment,
  RECURRING_CONSENT_VERSION,
} from '@/lib/membership-consent-copy'

// The words a client agrees to before a recurring charge.
//
// These assertions are deliberately about WORDING, not just shape. The stored
// consent is the whole defence in a dispute six months later, and the screen and
// the stored row are only equivalent because they come from this one function —
// so the text is the contract, and a silent reword should break a test.

describe('buildConsentText', () => {
  it('names the TRAINER as the party taking the money, with amount and frequency', () => {
    // The client is paying their dog trainer, not PupManager — and the trainer's
    // name is what appears on their bank statement.
    expect(buildConsentText({ businessName: 'Mersea Mutts', priceCents: 40000, currency: 'nzd', interval: 'MONTH' }))
      .toBe('I agree Mersea Mutts can charge my card $400.00 every month until I cancel.')
  })

  it('says fortnight rather than "every 2 weeks"', () => {
    expect(buildConsentText({ businessName: 'X', priceCents: 1000, currency: 'nzd', interval: 'FORTNIGHT' }))
      .toContain('every fortnight')
  })

  it('uses the trainer’s own currency symbol', () => {
    expect(buildConsentText({ businessName: 'X', priceCents: 2500, currency: 'gbp', interval: 'WEEK' }))
      .toContain('£25.00')
  })
})

describe('describePlanCommitment', () => {
  const base = {
    businessName: 'E2E Dog School',
    priceCents: 4000,
    currency: 'nzd',
    interval: 'MONTH' as const,
    from: new Date('2026-01-14T00:00:00Z'),
  }

  it('says "Cancel any time" when there is no minimum term', () => {
    const c = describePlanCommitment({ ...base, minTermCount: 0, earlyTermFeeCents: null })
    expect(c.termLabel).toBe('Cancel any time.')
    expect(c.committedUntil).toBeNull()
    // No term means no fee to warn about, even if one is configured.
    expect(c.earlyTermFeeLabel).toBeNull()
  })

  it('states the exact minimum term and the fee BEFORE they confirm', () => {
    const c = describePlanCommitment({ ...base, minTermCount: 3, earlyTermFeeCents: 5000 })
    expect(c.termLabel).toBe("You're committing to 3 months.")
    expect(c.earlyTermFeeLabel).toBe("If you cancel before then there's a $50.00 early-finish fee.")
    expect(c.committedUntil?.toISOString().slice(0, 10)).toBe('2026-04-14')
  })

  it('singularises a one-cycle term', () => {
    const c = describePlanCommitment({ ...base, minTermCount: 1, earlyTermFeeCents: null })
    expect(c.termLabel).toBe("You're committing to 1 month.")
  })

  it('omits the fee line when a term exists but no fee is set', () => {
    const c = describePlanCommitment({ ...base, minTermCount: 3, earlyTermFeeCents: null })
    expect(c.earlyTermFeeLabel).toBeNull()
    const zero = describePlanCommitment({ ...base, minTermCount: 3, earlyTermFeeCents: 0 })
    expect(zero.earlyTermFeeLabel).toBeNull()
  })

  it('bills on the anniversary — first charge today, next one a cycle later', () => {
    // Anniversary billing (Karl, 2026-07-27): no proration, no fixed day of the
    // month, no first-cycle part-charge.
    const c = describePlanCommitment({ ...base, minTermCount: 0, earlyTermFeeCents: null })
    expect(c.firstChargeLabel).toBe('Today')
    expect(c.nextChargeAt.toISOString().slice(0, 10)).toBe('2026-02-14')
  })

  it('advances a weekly plan by a week, not a month', () => {
    const c = describePlanCommitment({ ...base, interval: 'WEEK', minTermCount: 0, earlyTermFeeCents: null })
    expect(c.nextChargeAt.toISOString().slice(0, 10)).toBe('2026-01-21')
    expect(c.priceLabel).toBe('$40.00 every week')
  })

  it('tells them WHERE to cancel, by name', () => {
    // Naming the screen is the difference between a self-serve cancellation and
    // a support email.
    const c = describePlanCommitment({ ...base, minTermCount: 0, earlyTermFeeCents: null })
    expect(c.cancelWhereLabel).toContain('Packages')
  })

  it('stamps the consent version so we can always say which text they saw', () => {
    const c = describePlanCommitment({ ...base, minTermCount: 0, earlyTermFeeCents: null })
    expect(c.consentVersion).toBe(RECURRING_CONSENT_VERSION)
    expect(c.consentText).toBe(buildConsentText({ ...base, interval: 'MONTH' }))
  })
})

describe('a cycle of N weeks in the words the client agrees to', () => {
  // The failure this block exists to prevent: a count honoured at Stripe and
  // missing from the consent sentence, so the client agrees to "every week" and
  // is charged every six.
  const base = {
    businessName: 'Mersea Mutts',
    priceCents: 6000,
    currency: 'nzd',
    interval: 'WEEK' as const,
    from: new Date('2026-01-14T00:00:00Z'),
  }

  it('says "every 6 weeks" in the sentence they tick', () => {
    expect(buildConsentText({ ...base, intervalCount: 6 }))
      .toBe('I agree Mersea Mutts can charge my card $60.00 every 6 weeks until I cancel.')
  })

  it('never says "every 1 week" — a count of one keeps the bare singular', () => {
    expect(buildConsentText({ ...base, intervalCount: 1 }))
      .toBe('I agree Mersea Mutts can charge my card $60.00 every week until I cancel.')
    // …and the sentence is character-for-character what it was with no count
    // at all, which is what every existing row reads back as.
    expect(buildConsentText({ ...base, intervalCount: 1 })).toBe(buildConsentText(base))
  })

  it('prices the plan as "every 6 weeks", not "per week"', () => {
    const c = describePlanCommitment({ ...base, intervalCount: 6, minTermCount: 0, earlyTermFeeCents: null })
    expect(c.priceLabel).toBe('$60.00 every 6 weeks')
  })

  it('dates the next charge six weeks out, not one', () => {
    const c = describePlanCommitment({ ...base, intervalCount: 6, minTermCount: 0, earlyTermFeeCents: null })
    expect(c.nextChargeAt.toISOString().slice(0, 10)).toBe('2026-02-25')
  })

  it('states a minimum term in WEEKS, not in cycles', () => {
    // "2 cycles" means nothing to somebody handing over a card, and
    // "2 6 weekss" is what naive pluralisation produces.
    const c = describePlanCommitment({ ...base, intervalCount: 6, minTermCount: 2, earlyTermFeeCents: null })
    expect(c.termLabel).toBe("You're committing to 12 weeks.")
    expect(c.committedUntil?.toISOString().slice(0, 10)).toBe('2026-04-08')
  })

  it('leaves the single-cycle term wording exactly as it has always read', () => {
    const monthly = { ...base, interval: 'MONTH' as const }
    expect(describePlanCommitment({ ...monthly, intervalCount: 1, minTermCount: 3, earlyTermFeeCents: null }).termLabel)
      .toBe("You're committing to 3 months.")
    expect(describePlanCommitment({ ...monthly, minTermCount: 1, earlyTermFeeCents: null }).termLabel)
      .toBe("You're committing to 1 month.")
  })

  it('leaves a stored FORTNIGHT saying "fortnight", untouched', () => {
    const c = describePlanCommitment({
      ...base, interval: 'FORTNIGHT', intervalCount: 1, minTermCount: 3, earlyTermFeeCents: null,
    })
    expect(c.consentText).toContain('every fortnight')
    expect(c.priceLabel).toBe('$60.00 every fortnight')
    expect(c.termLabel).toBe("You're committing to 3 fortnights.")
    expect(c.nextChargeAt.toISOString().slice(0, 10)).toBe('2026-01-28')
  })
})
