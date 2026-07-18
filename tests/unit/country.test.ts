import { describe, it, expect } from 'vitest'
import { countryToISO, trainerRegionCode } from '@/lib/country'

describe('countryToISO', () => {
  it('maps full country names to ISO alpha-2', () => {
    expect(countryToISO('New Zealand')).toBe('NZ')
    expect(countryToISO('australia')).toBe('AU')
    expect(countryToISO('United Kingdom')).toBe('GB')
    expect(countryToISO('Scotland')).toBe('GB')
    expect(countryToISO('USA')).toBe('US')
  })

  it('passes through existing 2-letter codes, uppercased', () => {
    expect(countryToISO('nz')).toBe('NZ')
    expect(countryToISO('fr')).toBe('FR') // not in the name map, but a valid code
  })

  it('returns undefined for empty or unknown values', () => {
    expect(countryToISO(null)).toBeUndefined()
    expect(countryToISO(undefined)).toBeUndefined()
    expect(countryToISO('')).toBeUndefined()
    expect(countryToISO('Freedonia')).toBeUndefined()
  })
})

describe('trainerRegionCode', () => {
  it('prefers the business address country', () => {
    expect(trainerRegionCode({ addressCountry: 'New Zealand', signupCountry: 'AU' })).toBe('NZ')
  })

  it('falls back to the signup country when the address country is unknown/blank', () => {
    expect(trainerRegionCode({ addressCountry: null, signupCountry: 'AU' })).toBe('AU')
    expect(trainerRegionCode({ addressCountry: 'Freedonia', signupCountry: 'gb' })).toBe('GB')
  })

  it('is undefined when neither is known — caller then lets the browser locale decide', () => {
    expect(trainerRegionCode({ addressCountry: null, signupCountry: null })).toBeUndefined()
    expect(trainerRegionCode({})).toBeUndefined()
  })
})
