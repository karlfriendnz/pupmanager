import { describe, it, expect } from 'vitest'
import {
  FIELD_PACKS,
  packsForRoles,
  recommendedPackIds,
  recommendedFieldKeys,
  resolveFieldKeys,
} from '@/lib/field-packs'

describe('field packs catalog', () => {
  it('has unique pack ids and unique field keys within a pack', () => {
    const ids = FIELD_PACKS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const pack of FIELD_PACKS) {
      const keys = pack.fields.map(f => f.key)
      expect(new Set(keys).size, `duplicate key in ${pack.id}`).toBe(keys.length)
    }
  })

  it('gives every DROPDOWN field some options to choose from', () => {
    for (const pack of FIELD_PACKS) {
      for (const f of pack.fields) {
        if (f.type === 'DROPDOWN') {
          expect(f.options?.length, `${pack.id}:${f.key}`).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('packsForRoles', () => {
  it('always offers the role-agnostic essentials', () => {
    expect(packsForRoles([]).map(p => p.id)).toContain('essentials')
    expect(packsForRoles(['groomer']).map(p => p.id)).toContain('essentials')
  })

  it('offers a walker walking fields, not grooming ones', () => {
    const ids = packsForRoles(['walker']).map(p => p.id)
    expect(ids).toContain('walking')
    expect(ids).not.toContain('grooming')
  })

  it('unions the packs for someone wearing two hats', () => {
    const ids = packsForRoles(['trainer', 'groomer']).map(p => p.id)
    expect(ids).toContain('puppy')
    expect(ids).toContain('grooming')
  })
})

describe('recommended selections', () => {
  it('pre-ticks packs the trainer is offered', () => {
    expect(recommendedPackIds(['behaviourist'])).toEqual(
      packsForRoles(['behaviourist']).map(p => p.id)
    )
  })

  it('pre-ticks only the recommended fields, keyed pack:field', () => {
    const keys = recommendedFieldKeys(['walker'])
    expect(keys).toContain('essentials:breed')
    expect(keys).toContain('walking:access')
    // "Pulls on lead?" is offered but not ticked by default.
    expect(keys).not.toContain('walking:pulls')
  })
})

describe('resolveFieldKeys', () => {
  it('resolves keys to their catalog definitions', () => {
    const [first] = resolveFieldKeys(['essentials:breed'])
    expect(first.pack.id).toBe('essentials')
    expect(first.field.label).toBe('Breed')
    expect(first.pack.section).toBe('About your dog')
  })

  it('drops unknown, malformed and duplicate keys rather than trusting them', () => {
    expect(resolveFieldKeys(['nope:nope'])).toEqual([])
    expect(resolveFieldKeys(['garbage'])).toEqual([])
    expect(resolveFieldKeys(['essentials:not-a-field'])).toEqual([])
    expect(resolveFieldKeys(['essentials:breed', 'essentials:breed'])).toHaveLength(1)
  })
})
