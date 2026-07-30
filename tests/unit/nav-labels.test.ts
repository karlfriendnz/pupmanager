import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isRenameable, sanitizeNavLabels, labelFor, sectionKey, shouldShowSectionHeader,
  NAV_LABEL_CATALOG, pageTitleLabel,
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

// ── The catalogue, and keeping it honest ──────────────────────────────────────
//
// NAV_LABEL_CATALOG is a hand-kept COPY of what app-shell declares, because the
// editor and the API both need the list on the server and app-shell is the whole
// client-side chrome. A copy drifts, so these tests are the thing that stops it:
// add a menu item and forget the catalogue, and it silently can't be renamed.

const shell = () => readFileSync(resolve(__dirname, '../../src/components/shared/app-shell.tsx'), 'utf8')

/** Every ACTIVE trainer nav item, as [href, label]. Commented-out items (Doggy
 *  Daycare, Lead magnets) are deliberately skipped — they aren't in the menu. */
function navItemsFromShell(): [string, string][] {
  const src = shell()
  const block = src.slice(src.indexOf('const TRAINER_NAV'), src.indexOf('// Section headers shown'))
  return block
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .map(l => /\{\s*href:\s*'([^']+)',\s*label:\s*'([^']+)'/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => [m[1], m[2]] as [string, string])
}

describe('the rename catalogue matches the real menu', () => {
  it('finds the menu it is meant to mirror', () => {
    // If this fails the parser broke, and every assertion below is vacuous.
    expect(navItemsFromShell().length).toBeGreaterThan(15)
  })

  it('lists every menu item a trainer is allowed to rename', () => {
    const inCatalog = new Set(NAV_LABEL_CATALOG.map(e => e.key))
    const missing = navItemsFromShell()
      .filter(([href, label]) => isRenameable(href, label))
      .filter(([href]) => !inCatalog.has(href))
    expect(missing).toEqual([])
  })

  it('lists nothing that isn’t in the menu', () => {
    const hrefs = new Set(navItemsFromShell().map(([href]) => href))
    const stale = NAV_LABEL_CATALOG
      .filter(e => !e.isSection)
      .filter(e => !hrefs.has(e.key))
    expect(stale).toEqual([])
  })

  it('agrees with the menu on what each thing is called', () => {
    const byHref = new Map(navItemsFromShell())
    const wrong = NAV_LABEL_CATALOG
      .filter(e => !e.isSection && byHref.has(e.key))
      .filter(e => byHref.get(e.key) !== e.defaultLabel)
      .map(e => [e.key, e.defaultLabel, byHref.get(e.key)])
    expect(wrong).toEqual([])
  })

  // A group heading renames a whole run of items, so missing one is worse than
  // missing a single link.
  it('lists every group heading the sidebar draws', () => {
    const src = shell()
    const block = src.slice(src.indexOf('const NAV_SECTION_LABEL'), src.indexOf('const MENU_SECTION_ORDER'))
    const headed = [...block.matchAll(/^\s*(\w+):\s*'([^']+)'/gm)].map(m => [m[1], m[2]])
    expect(headed.length).toBeGreaterThan(3)
    const inCatalog = new Map(NAV_LABEL_CATALOG.map(e => [e.key, e.defaultLabel]))
    for (const [section, label] of headed) {
      expect(inCatalog.get(sectionKey(section)), `heading ${section}`).toBe(label)
    }
  })

  // Offered-then-refused is the worst of both: a box that quietly does nothing.
  it('offers nothing it would then refuse to save', () => {
    const refused = NAV_LABEL_CATALOG.filter(e => !isRenameable(e.key, e.defaultLabel))
    expect(refused).toEqual([])
  })

  it('defaults its own sanitizer to the catalogue', () => {
    expect(sanitizeNavLabels({ '/library': 'Resources' })).toEqual({ '/library': 'Resources' })
    // Locked, so dropped even without an explicit allow-list.
    expect(sanitizeNavLabels({ '/finances': 'Money in' })).toEqual({})
  })
})

describe('a renamed menu item renames its page too', () => {
  const mine = { '/library': 'Resources', '/packages': 'Private lessons' }

  it('uses their word on the page that IS that menu item', () => {
    expect(pageTitleLabel('/library', 'Library', mine)).toBe('Resources')
    expect(pageTitleLabel('/packages', '1:1 Sessions', mine)).toBe('Private lessons')
  })

  it('follows them into the pages underneath', () => {
    expect(pageTitleLabel('/library/item/abc123', 'Library', mine)).toBe('Resources')
  })

  // The condition that keeps this safe: most page titles aren't menu labels.
  it('leaves a page titled something else alone', () => {
    expect(pageTitleLabel('/library/item/abc123', 'Settle on mat', mine)).toBe('Settle on mat')
    expect(pageTitleLabel('/clients/abc123', 'Sarah Scott', mine)).toBe('Sarah Scott')
  })

  it('does nothing when they haven’t renamed anything', () => {
    expect(pageTitleLabel('/library', 'Library', {})).toBe('Library')
    expect(pageTitleLabel('/library', 'Library', null)).toBe('Library')
  })

  it('never renames a locked page', () => {
    expect(pageTitleLabel('/finances', 'Finances', { '/finances': 'Money in' })).toBe('Finances')
  })

  // /clients is a prefix of /clients/waitlist, and the waitlist has its own name.
  it('prefers the most specific menu item', () => {
    const both = { '/clients': 'People', '/clients/waitlist': 'Queue' }
    expect(pageTitleLabel('/clients/waitlist', 'Waitlist', both)).toBe('Queue')
    expect(pageTitleLabel('/clients', 'Clients', both)).toBe('People')
  })

  // "/schedule?availability=1" isn't a path; matching it against /schedule would
  // rename the schedule to whatever they called Availability.
  it('ignores the query-string menu entries', () => {
    expect(pageTitleLabel('/schedule', 'Schedule', { '/schedule?availability=1': 'Free time' }))
      .toBe('Schedule')
  })
})
