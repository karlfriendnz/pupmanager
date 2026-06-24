import { describe, it, expect } from 'vitest'
import { COUNTRIES, countryName, normalizeCountry } from '@/lib/countries'

describe('countries', () => {
  it('resolves names from ISO alpha-2 codes (case-insensitive)', () => {
    expect(countryName('NZ')).toBe('New Zealand')
    expect(countryName('us')).toBe('United States')
    expect(countryName(null)).toBe('')
    expect(countryName(undefined)).toBe('')
  })

  it('COUNTRIES includes common markets and is sorted by name', () => {
    const codes = COUNTRIES.map(c => c.code)
    expect(codes).toEqual(expect.arrayContaining(['NZ', 'AU', 'GB', 'US', 'IE', 'CA']))
    const names = COUNTRIES.map(c => c.name)
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
  })

  it('normalizeCountry upper-cases valid codes and rejects junk', () => {
    expect(normalizeCountry('nz')).toBe('NZ')
    expect(normalizeCountry('ZZ')).toBe(null) // not a real ISO code
    expect(normalizeCountry('')).toBe(null)
    expect(normalizeCountry(null)).toBe(null)
  })
})
