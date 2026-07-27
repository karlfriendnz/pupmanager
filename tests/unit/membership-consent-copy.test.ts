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
