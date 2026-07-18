import { describe, it, expect } from 'vitest'
import { isPlaceholderEmail, displayEmail } from '@/lib/utils'

describe('isPlaceholderEmail', () => {
  it('treats @pupmanager.test addresses as placeholders', () => {
    expect(isPlaceholderEmail('bailey@pupmanager.test')).toBe(true)
    expect(isPlaceholderEmail('SARAH@PUPMANAGER.TEST')).toBe(true)
  })

  it('treats empty / missing values as placeholders', () => {
    expect(isPlaceholderEmail(null)).toBe(true)
    expect(isPlaceholderEmail(undefined)).toBe(true)
    expect(isPlaceholderEmail('')).toBe(true)
    expect(isPlaceholderEmail('   ')).toBe(true)
  })

  it('accepts a real address', () => {
    expect(isPlaceholderEmail('sarah@gmail.com')).toBe(false)
    // domain merely containing the placeholder string is not the placeholder domain
    expect(isPlaceholderEmail('sarah@pupmanager.test.co')).toBe(false)
    expect(isPlaceholderEmail('sarah@notpupmanager.test')).toBe(false)
  })
})

describe('displayEmail', () => {
  it('returns null for placeholders so callers can render "No email"', () => {
    expect(displayEmail('bailey@pupmanager.test')).toBeNull()
    expect(displayEmail(null)).toBeNull()
    expect(displayEmail('')).toBeNull()
  })

  it('returns the trimmed address for real emails', () => {
    expect(displayEmail('  sarah@gmail.com  ')).toBe('sarah@gmail.com')
  })
})
