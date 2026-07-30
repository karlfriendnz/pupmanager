import { describe, it, expect } from 'vitest'
import {
  isRenameable, sanitizeNavLabels, labelFor, sectionKey, shouldShowSectionHeader,
  type RenameableEntry,
} from '@/lib/nav-labels'

const entries: RenameableEntry[] = [
  { key: 'section:programs', defaultLabel: 'Offerings', isSection: true },
  { key: '/packages', defaultLabel: '1:1 Sessions', isSection: false },
  { key: '/library', defaultLabel: 'Library', isSection: false },
  { key: '/finances', defaultLabel: 'Finances', isSection: false },
  { key: '/stripe', defaultLabel: 'Stripe', isSection: false },
]

describe('what may be renamed', () => {
  it('lets a trainer rename their own vocabulary', () => {
    expect(isRenameable('section:programs', 'Offerings')).toBe(true)
    expect(isRenameable('/library', 'Library')).toBe(true)
    expect(isRenameable('/packages', '1:1 Sessions')).toBe(true)
  })

  // Renaming "Stripe" doesn't make it not Stripe, and a support conversation
  // needs the real name.
  it('locks proper nouns', () => {
    expect(isRenameable('/stripe', 'Stripe')).toBe(false)
    expect(isRenameable('/settings?tab=xero', 'Xero')).toBe(false)
    expect(isRenameable('/instagram', 'Instagram link')).toBe(false)
  })

  it('locks the money and records words', () => {
    expect(isRenameable('/finances', 'Finances')).toBe(false)
    expect(isRenameable('/reports', 'Reports')).toBe(false)
    expect(isRenameable('/timesheets', 'Timesheets')).toBe(false)
  })

  it('locks Settings, which is how you get back here', () => {
    expect(isRenameable('/settings', 'Settings')).toBe(false)
  })

  // Belt and braces: a locked thing that moves to a new href stays locked.
  it('locks by label too, so a moved item stays locked', () => {
    expect(isRenameable('/somewhere-new', 'Stripe')).toBe(false)
  })
})

describe('sanitizeNavLabels', () => {
  it('keeps a real rename', () => {
    expect(sanitizeNavLabels({ 'section:programs': 'Services' }, entries))
      .toEqual({ 'section:programs': 'Services' })
  })

  it('drops a rename of something locked', () => {
    expect(sanitizeNavLabels({ '/finances': 'Money in', '/stripe': 'Card stuff' }, entries)).toEqual({})
  })

  it('drops a key that isn’t in the menu at all', () => {
    expect(sanitizeNavLabels({ '/made-up': 'Nope' }, entries)).toEqual({})
  })

  it('drops blanks rather than storing an empty menu label', () => {
    expect(sanitizeNavLabels({ '/library': '   ' }, entries)).toEqual({})
  })

  // Storing "same as the default" is how a rename silently survives a copy
  // change — the default should win when they haven't really renamed anything.
  it('drops a value identical to the default', () => {
    expect(sanitizeNavLabels({ '/library': 'Library' }, entries)).toEqual({})
  })

  it('collapses whitespace — a label is one short line', () => {
    expect(sanitizeNavLabels({ '/library': '  My   Resources \n ' }, entries))
      .toEqual({ '/library': 'My Resources' })
  })

  it('caps the length so a nav row can still render', () => {
    const long = 'x'.repeat(80)
    expect(sanitizeNavLabels({ '/library': long }, entries)['/library']).toHaveLength(40)
  })

  it('ignores junk instead of throwing', () => {
    expect(sanitizeNavLabels(null, entries)).toEqual({})
    expect(sanitizeNavLabels('nope', entries)).toEqual({})
    expect(sanitizeNavLabels(['a'], entries)).toEqual({})
    expect(sanitizeNavLabels({ '/library': 42 }, entries)).toEqual({})
  })
})

describe('labelFor', () => {
  it('shows their word when they chose one', () => {
    expect(labelFor('/library', 'Library', { '/library': 'Resources' })).toBe('Resources')
  })

  it('falls back to ours', () => {
    expect(labelFor('/library', 'Library', {})).toBe('Library')
    expect(labelFor('/library', 'Library', null)).toBe('Library')
  })

  // Defence in depth: even if a locked override reached the database somehow, it
  // must not render.
  it('refuses a stored override on a locked item', () => {
    expect(labelFor('/finances', 'Finances', { '/finances': 'Money in' })).toBe('Finances')
  })
})

describe('sectionKey', () => {
  it('namespaces a heading so it can’t collide with an href', () => {
    expect(sectionKey('programs')).toBe('section:programs')
  })
})

describe('shouldShowSectionHeader', () => {
  // A heading over ONE row says "Offerings" above a single "Group Classes" link,
  // which the link already told you. Add-ons hiding a section down to one item is
  // a real state, not a hypothetical.
  it('hides a heading over a single item', () => {
    expect(shouldShowSectionHeader(1)).toBe(false)
  })

  it('shows it over two or more', () => {
    expect(shouldShowSectionHeader(2)).toBe(true)
    expect(shouldShowSectionHeader(5)).toBe(true)
  })

  it('hides it over none', () => {
    expect(shouldShowSectionHeader(0)).toBe(false)
  })
})
