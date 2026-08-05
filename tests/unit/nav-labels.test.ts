import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isRenameable, sanitizeNavLabels, labelFor, sectionKey, shouldShowSectionHeader,
  NAV_LABEL_CATALOG, pageTitleLabel,
  type RenameableEntry,
  clientLabelFor,
  CLIENT_NAV_LABEL_CATALOG, RENAMEABLE_CATALOG, CLIENT_OWN_LABEL_KEY,
} from '@/lib/nav-labels'

const entries: RenameableEntry[] = [
  { key: 'section:programs', defaultLabel: 'Offerings', isSection: true, examples: ['Services', 'Training'] },
  { key: '/packages', defaultLabel: '1:1 Sessions', isSection: false, examples: ['Private lessons', 'Consults'] },
  { key: '/library', defaultLabel: 'Library', isSection: false, examples: ['Resources', 'Guides'] },
  { key: '/finances', defaultLabel: 'Finances', isSection: false, examples: ['Money', 'Accounts'] },
  { key: '/stripe', defaultLabel: 'Stripe', isSection: false, examples: ['Payments', 'Card'] },
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
      // A locked heading is deliberately absent from the catalogue — the
      // editor must not offer a box it would refuse to save. Every OTHER
      // heading has to be there, or renaming it silently does nothing.
      if (!isRenameable(sectionKey(section), label)) {
        expect(inCatalog.has(sectionKey(section)), `locked heading ${section} must not be offered`).toBe(false)
        continue
      }
      expect(inCatalog.get(sectionKey(section)), `heading ${section}`).toBe(label)
    }
  })

  // The placeholder used to repeat our own label, sitting beside a label that
  // already said it. An example is the whole point of the box — so a new menu
  // item must not be added without one, or it silently goes back to useless.
  it('gives every renameable thing a few examples, not its own name back', () => {
    for (const e of NAV_LABEL_CATALOG) {
      // Several, so it reads as a range to pick from rather than the one
      // answer we had in mind.
      expect(e.examples.length, `${e.defaultLabel} needs a few examples`).toBeGreaterThan(1)
      for (const ex of e.examples) {
        expect(ex.trim(), `${e.defaultLabel} has a blank example`).not.toBe('')
        expect(
          ex.trim().toLowerCase(),
          `${e.defaultLabel}'s example just repeats it`,
        ).not.toBe(e.defaultLabel.trim().toLowerCase())
      }
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
  // This used to compare /clients against /clients/waitlist. Waitlist was
  // locked on 2026-07-30 and left the catalogue with it, and no nested pair is
  // renameable any more — so the two-candidate case has no honest example. What
  // still matters, and is what the sort actually guards, is that a page BELOW a
  // renamed item inherits that item's label rather than losing it.
  it('a page under a renamed item keeps that name', () => {
    const mine = { '/clients': 'People' }
    expect(pageTitleLabel('/clients', 'Clients', mine)).toBe('People')
    expect(pageTitleLabel('/clients/abc123', 'Clients', mine)).toBe('People')
  })

  it('does not reach across to an unrelated item', () => {
    const mine = { '/clients': 'People' }
    expect(pageTitleLabel('/library', 'Library', mine)).toBe('Library')
  })

  // "/schedule?availability=1" isn't a path; matching it against /schedule would
  // rename the schedule to whatever they called Availability.
  it('ignores the query-string menu entries', () => {
    expect(pageTitleLabel('/schedule', 'Schedule', { '/schedule?availability=1': 'Free time' }))
      .toBe('Schedule')
  })
})

describe("a client sees the trainer's words too", () => {
  const mine = { 'section:programs': 'Services', '/products': 'Merch', '/memberships': 'Plans' }

  it('borrows the trainer label for the same thing', () => {
    expect(clientLabelFor('/my-availability', 'Offerings', mine)).toBe('Services')
    expect(clientLabelFor('/my-shop', 'Shop', mine)).toBe('Merch')
    expect(clientLabelFor('/my-memberships', 'Packages', mine)).toBe('Plans')
  })

  it('keeps our word where the trainer has not chosen one', () => {
    expect(clientLabelFor('/my-availability', 'Offerings', {})).toBe('Offerings')
    expect(clientLabelFor('/my-shop', 'Shop', null)).toBe('Products')
  })

  // The client's Sessions is everything they have booked — classes, events and
  // one-to-ones. The trainer's "1:1 Sessions" is one product among those, so
  // renaming it to "Private lessons" must not relabel the whole list.
  it('does not borrow across a meaning it does not share', () => {
    const renamed = { '/packages': 'Private lessons' }
    expect(clientLabelFor('/my-sessions', 'Sessions', renamed)).toBe('Sessions')
    expect(clientLabelFor('/home', 'Home', renamed)).toBe('Home')
    expect(clientLabelFor('/my-invoices', 'Invoices', renamed)).toBe('Invoices')
  })

  // A locked word is locked on both sides — the sanitizer drops it, so a
  // client can never be shown something the trainer was not allowed to set.
  it('will not carry a locked rename across', () => {
    expect(clientLabelFor('/my-messages', 'Messages', { '/messages': 'Chat' })).toBe('Messages')
  })
})

// ── The booking tile's own word ──────────────────────────────────────────────
//
// It used to borrow the "Offerings" SECTION heading, so the only way to rename
// the tile on a client's home was to rename the trainer's whole Offerings group
// (Karl, 2026-08-06). It now has a word of its own, and falls back to the
// borrowed one so nothing regresses for a trainer who already renamed theirs.

describe('the booking tile can be named on its own', () => {
  const OWN = 'client:/my-availability'

  it('uses their word for the tile when they set one', () => {
    expect(clientLabelFor('/my-availability', 'Offerings', { [OWN]: 'Book now' })).toBe('Book now')
  })

  it('their tile word wins over the borrowed section word', () => {
    const both = { [OWN]: 'Book now', 'section:programs': 'Services' }
    expect(clientLabelFor('/my-availability', 'Offerings', both)).toBe('Book now')
  })

  it('falls back to the section word when the tile has none', () => {
    expect(clientLabelFor('/my-availability', 'Offerings', { 'section:programs': 'Services' }))
      .toBe('Services')
  })

  it('falls back to ours when they have set neither', () => {
    expect(clientLabelFor('/my-availability', 'Offerings', {})).toBe('Offerings')
    expect(clientLabelFor('/my-availability', 'Offerings', null)).toBe('Offerings')
  })

  it('treats a blank tile word as not set, not as an empty tile', () => {
    expect(clientLabelFor('/my-availability', 'Offerings', { [OWN]: '   ', 'section:programs': 'Services' }))
      .toBe('Services')
  })

  it('saves and reads back through the same sanitizer as a menu label', () => {
    expect(sanitizeNavLabels({ [OWN]: 'Book now' })).toEqual({ [OWN]: 'Book now' })
    // Same rules: blanks, over-long values and "the same as the default" go.
    expect(sanitizeNavLabels({ [OWN]: '  ' })).toEqual({})
    expect(sanitizeNavLabels({ [OWN]: 'Offerings' })).toEqual({})
    expect(sanitizeNavLabels({ [OWN]: 'x'.repeat(80) })[OWN]).toHaveLength(40)
  })

  // Messages is locked on BOTH sides (Karl, 2026-07-30) and gets no client-side
  // escape hatch — an invented key for it must not save, and must not render.
  it('gives no client-side way round a lock', () => {
    expect(sanitizeNavLabels({ 'client:/my-messages': 'Chat' })).toEqual({})
    expect(clientLabelFor('/my-messages', 'Messages', { 'client:/my-messages': 'Chat' })).toBe('Messages')
    expect(clientLabelFor('/my-messages', 'Messages', { '/messages': 'Chat' })).toBe('Messages')
  })
})

describe('the client-side catalogue', () => {
  // NAV_LABEL_CATALOG mirrors the trainer menu and is drift-tested against it,
  // so a client-only key CANNOT live there — it has no menu row to mirror and
  // the "lists nothing that isn't in the menu" test would fail. It is a second
  // list, and this is what keeps it honest on its own terms.
  it('stays out of the trainer-menu mirror', () => {
    const menuKeys = new Set(NAV_LABEL_CATALOG.map(e => e.key))
    for (const e of CLIENT_NAV_LABEL_CATALOG) {
      expect(menuKeys.has(e.key), `${e.key} must not be in the menu catalogue`).toBe(false)
      expect(e.key.startsWith('client:'), `${e.key} needs the client: prefix`).toBe(true)
    }
  })

  it('is carried by the catalogue the sanitizer and the editor use', () => {
    for (const e of [...NAV_LABEL_CATALOG, ...CLIENT_NAV_LABEL_CATALOG]) {
      expect(RENAMEABLE_CATALOG.some(x => x.key === e.key), e.key).toBe(true)
    }
  })

  it('offers nothing it would then refuse to save', () => {
    const refused = CLIENT_NAV_LABEL_CATALOG.filter(e => !isRenameable(e.key, e.defaultLabel))
    expect(refused).toEqual([])
  })

  it('says where each one appears, since its default word repeats a menu row', () => {
    for (const e of CLIENT_NAV_LABEL_CATALOG) {
      expect(e.hint?.trim(), `${e.key} needs a hint`).toBeTruthy()
      expect(e.examples.length, `${e.key} needs a few examples`).toBeGreaterThan(1)
    }
  })

  it('every own-label key has a catalogue entry behind it', () => {
    for (const key of Object.values(CLIENT_OWN_LABEL_KEY)) {
      expect(CLIENT_NAV_LABEL_CATALOG.some(e => e.key === key), key).toBe(true)
    }
  })

  it('is offered in the trainer’s rename editor', () => {
    const panel = readFileSync(
      resolve(__dirname, '../../src/app/(trainer)/settings/nav-labels-panel.tsx'),
      'utf8',
    )
    expect(panel).toContain('CLIENT_NAV_LABEL_CATALOG.map')
    // Dirty/count read the whole list, or a client-only rename can't be saved.
    expect(panel).toContain('RENAMEABLE_CATALOG.some')
  })
})

// ── The client app speaks the trainer's words too ────────────────────────────
//
// A trainer renaming "1:1 Sessions" to "Private lessons" was still showing their
// clients OUR word in the one place a client chooses between what's on offer. These
// guard the surfaces, because the way this breaks is a hardcoded string that no
// type checker will ever complain about.

const clientFile = (rel: string) =>
  readFileSync(resolve(__dirname, '../../src/app/(client)/' + rel), 'utf8')

describe('the client app asks for the trainer’s words', () => {
  it('the booking flow names every offering type from the overrides', () => {
    const src = clientFile('my-availability/booking-wizard.tsx')
    // One place resolves them, so each use reads the same source.
    expect(src).toContain('useNavLabelOverrides()')
    for (const key of ['/packages', '/classes', '/events', '/memberships']) {
      expect(src, key).toContain(`labelFor('${key}'`)
    }
  })

  // The words that were hardcoded. If one comes back as a literal, a rename stops
  // reaching the screen a client actually books from.
  it('the booking flow has no hardcoded offering headings left', () => {
    const src = clientFile('my-availability/booking-wizard.tsx')
    for (const word of ['>1-on-1 sessions<', '>Group classes<', '>Packages<']) {
      expect(src, word).not.toContain(word)
    }
  })

  it('the home tiles use them as well', () => {
    const src = clientFile('home/home-view.tsx')
    expect(src).toContain("clientLabelFor('/my-availability'")
    expect(src).toContain("clientLabelFor('/my-shop'")
    // The tile said "Offerings" while the menu beside it said the trainer's word.
    expect(src).not.toContain("{ label: 'Offerings'")
  })

  // Without the provider around the client shell, every hook above silently
  // returns an empty map and every label quietly falls back to ours.
  it('the client shell provides the overrides its screens read', () => {
    const shell = readFileSync(resolve(__dirname, '../../src/components/shared/app-shell.tsx'), 'utf8')
    expect(shell.match(/<NavLabelProvider/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})
