import { describe, it, expect } from 'vitest'
import { countryCodeFor, currencyForCountry } from '@/lib/connect'

// Regression: a real customer (UK) could not turn Stripe payments on at all.
// Their `addressCountry` was the display name Google autocomplete filled in —
// "United Kingdom " — and it was handed straight to Stripe, which only accepts
// an ISO 3166-1 alpha-2 code. Account creation threw, so no Connect account was
// ever made and the toggle could never go green.

describe('countryCodeFor', () => {
  it('passes an alpha-2 code straight through, upper-cased', () => {
    expect(countryCodeFor('GB')).toBe('GB')
    expect(countryCodeFor('nz')).toBe('NZ')
  })

  it('maps the display names the address form actually stores', () => {
    expect(countryCodeFor('United Kingdom')).toBe('GB')
    expect(countryCodeFor('New Zealand')).toBe('NZ')
    expect(countryCodeFor('South Africa')).toBe('ZA')
    expect(countryCodeFor('United States of America')).toBe('US')
  })

  it('tolerates the stray whitespace and casing a typed address carries', () => {
    // Exactly what was in the database for the customer who hit this.
    expect(countryCodeFor('United Kingdom ')).toBe('GB')
    expect(countryCodeFor('  new zealand  ')).toBe('NZ')
  })

  it('falls through to the next candidate when the first is unusable', () => {
    // signupCountry is always a code, so it's the safety net.
    expect(countryCodeFor(null, 'GB')).toBe('GB')
    expect(countryCodeFor('', 'AU')).toBe('AU')
    expect(countryCodeFor('Somewhere Unmapped', 'GB')).toBe('GB')
  })

  it('lands on NZ only when nothing usable is supplied', () => {
    expect(countryCodeFor()).toBe('NZ')
    expect(countryCodeFor(null, undefined, '')).toBe('NZ')
  })
})

describe('currencyForCountry', () => {
  it('works from a display name, not just a code', () => {
    expect(currencyForCountry('United Kingdom ')).toBe('gbp')
    expect(currencyForCountry('GB')).toBe('gbp')
    expect(currencyForCountry('New Zealand')).toBe('nzd')
  })

  it('falls back to the home market for anywhere unmapped', () => {
    expect(currencyForCountry('Narnia')).toBe('nzd')
    expect(currencyForCountry(null)).toBe('nzd')
  })
})
