import { describe, it, expect } from 'vitest'
import {
  CLIENT_FIELDS,
  CLIENT_FIELD_KEYS,
  QUICK_ADD_KEYS,
  QUICK_ADD_FOLLOW_UP_STATUS,
  clientFieldLabel,
  clientFieldIsDogDetail,
  clientFieldInputType,
} from '@/lib/client-fields'

// The per-company config these fields used to carry — which were required, which
// showed on quick-add — is gone (Karl, 2026-07-30: "the system fields are just a
// result of the forms"). What's left is the catalogue: what each detail is called,
// whose record it belongs to, and what input it wants. These tests hold the shape
// the form builder and the write path both read.

describe('the catalogue', () => {
  it('has a unique key for every detail', () => {
    const keys = CLIENT_FIELDS.map(f => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  // A form validates what it may ask for against this list, so a key missing from
  // it is a detail no form can ever ask for.
  it('exposes every key for the form API to validate against', () => {
    expect([...CLIENT_FIELD_KEYS].sort()).toEqual(CLIENT_FIELDS.map(f => f.key).sort())
  })

  // A client record with no name is unusable, and it's the one thing a trainer
  // can't switch off.
  it('marks only the name as structurally required', () => {
    const always = CLIENT_FIELDS.filter(f => f.alwaysRequired).map(f => f.key)
    expect(always).toEqual(['name'])
  })
})

describe('quick add', () => {
  // Fixed, not configurable: quick-add exists to capture a walk-in in ten seconds,
  // and the configurable version was the one where a trainer couldn't save someone
  // whose email they didn't have.
  it('asks for the three you want when you meet someone', () => {
    expect(QUICK_ADD_KEYS).toEqual(['name', 'phone', 'email'])
  })

  it('only names details that exist', () => {
    const known = new Set(CLIENT_FIELDS.map(f => f.key))
    for (const k of QUICK_ADD_KEYS) expect(known.has(k), k).toBe(true)
  })

  // They land in the existing "New" bucket rather than a parallel status.
  it('files a quick-added contact as needing follow-up', () => {
    expect(QUICK_ADD_FOLLOW_UP_STATUS).toBe('NEW')
  })
})

describe('how a detail describes itself on a form', () => {
  it('gives each one its own words', () => {
    expect(clientFieldLabel('name')).toBe('Client name')
    expect(clientFieldLabel('dogDob')).toBe('Date of birth')
  })

  // A form authored against a key we later rename should still render something a
  // trainer recognises and can remove, rather than throwing the page away.
  it('falls back to the key rather than throwing', () => {
    expect(clientFieldLabel('nonsense')).toBe('nonsense')
    expect(clientFieldIsDogDetail('nonsense')).toBe(false)
    expect(clientFieldInputType('nonsense')).toBe('SHORT_TEXT')
  })

  it('knows which details are about the dog', () => {
    expect(clientFieldIsDogDetail('dogBreed')).toBe(true)
    expect(clientFieldIsDogDetail('phone')).toBe(false)
    // Every dog-scoped entry agrees with its own scope.
    for (const f of CLIENT_FIELDS) {
      expect(clientFieldIsDogDetail(f.key), f.key).toBe(f.scope === 'DOG')
    }
  })

  // The input belongs to the detail, so a trainer never picks it and can't pick
  // wrong: an email box for an email, a date picker for a birthday.
  it('brings its own input shape', () => {
    expect(clientFieldInputType('email')).toBe('EMAIL')
    expect(clientFieldInputType('phone')).toBe('TEL')
    expect(clientFieldInputType('dogDob')).toBe('DATE')
    expect(clientFieldInputType('dogWeight')).toBe('NUMBER')
    expect(clientFieldInputType('dogNotes')).toBe('LONG_TEXT')
    expect(clientFieldInputType('name')).toBe('SHORT_TEXT')
  })

  it('has an input for every detail', () => {
    for (const f of CLIENT_FIELDS) {
      expect(clientFieldInputType(f.key), f.key).toBeTruthy()
    }
  })
})
