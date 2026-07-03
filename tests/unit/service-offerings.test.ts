import { describe, it, expect } from 'vitest'
import { allowedSlotTypes } from '@/lib/service-offerings'

describe('allowedSlotTypes', () => {
  it('shows everything when no roles are captured (legacy/unknown accounts)', () => {
    expect(allowedSlotTypes([])).toEqual(['session', 'class', 'buddies', 'dropin'])
    expect(allowedSlotTypes(null)).toEqual(['session', 'class', 'buddies', 'dropin'])
    expect(allowedSlotTypes(undefined)).toEqual(['session', 'class', 'buddies', 'dropin'])
  })

  it('groomer only sees 1:1 sessions — no group walk, class or drop-in', () => {
    expect(allowedSlotTypes(['groomer'])).toEqual(['session'])
  })

  it('pet sitter only sees 1:1 sessions', () => {
    expect(allowedSlotTypes(['petsitter'])).toEqual(['session'])
  })

  it('walker adds group walks but not classes', () => {
    expect(allowedSlotTypes(['walker'])).toEqual(['session', 'buddies'])
  })

  it('trainer and behaviourist run classes and drop-ins but not group walks', () => {
    expect(allowedSlotTypes(['trainer'])).toEqual(['session', 'class', 'dropin'])
    expect(allowedSlotTypes(['behaviourist'])).toEqual(['session', 'class', 'dropin'])
  })

  it('unions across multiple personas (walker + trainer = everything)', () => {
    expect(allowedSlotTypes(['walker', 'trainer'])).toEqual(['session', 'class', 'buddies', 'dropin'])
  })

  it('preserves canonical order regardless of input order', () => {
    expect(allowedSlotTypes(['trainer', 'walker'])).toEqual(['session', 'class', 'buddies', 'dropin'])
  })

  it('ignores unrecognised roles but keeps known ones', () => {
    expect(allowedSlotTypes(['groomer', 'spaceship'])).toEqual(['session'])
  })

  it('falls back to everything when only unrecognised roles are given', () => {
    expect(allowedSlotTypes(['spaceship'])).toEqual(['session', 'class', 'buddies', 'dropin'])
  })
})
