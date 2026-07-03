import { describe, it, expect } from 'vitest'
import { formatPhoneInput } from '@/lib/format-phone'

describe('formatPhoneInput', () => {
  it('groups a NZ mobile as 0XX XXX XXXX', () => {
    expect(formatPhoneInput('0212345678')).toBe('021 234 5678')
  })

  it('formats progressively as digits are typed', () => {
    expect(formatPhoneInput('021')).toBe('021')
    expect(formatPhoneInput('021234')).toBe('021 234')
    expect(formatPhoneInput('0212345')).toBe('021 234 5')
  })

  it('strips non-digits the user pastes in', () => {
    expect(formatPhoneInput('(021) 234-5678')).toBe('021 234 5678')
  })

  it('keeps a leading + and groups international digits in blocks of 3', () => {
    expect(formatPhoneInput('+64212345678')).toBe('+642 123 456 78')
    expect(formatPhoneInput('+1 415 555 0100')).toBe('+141 555 501 00')
  })

  it('returns a lone + while an international number is being started', () => {
    expect(formatPhoneInput('+')).toBe('+')
  })

  it('returns empty string for empty input', () => {
    expect(formatPhoneInput('')).toBe('')
  })

  it('caps at 15 digits (E.164 ceiling)', () => {
    const long = formatPhoneInput('+1234567890123456789')
    expect(long.replace(/\D/g, '')).toHaveLength(15)
  })
})
