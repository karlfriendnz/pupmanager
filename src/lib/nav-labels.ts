/**
 * What a trainer calls the things in their own left menu.
 *
 * A groomer says "Services", a daycare says "Programmes", we say "Offerings". The
 * software shouldn't insist. This is the registry of what can be renamed, what
 * can't, and how a stored override is applied.
 *
 * WHAT CAN'T BE RENAMED, and why (Karl, 2026-07-30: "except for things like
 * stripes, reports, finances"):
 *   • Proper nouns — Stripe, Xero, Instagram. Renaming "Stripe" to something else
 *     doesn't make it not Stripe, and a support conversation needs the real name.
 *   • Money and records — Finances, Reports, Timesheets. These are words with an
 *     accounting meaning; a trainer renaming "Finances" to "Money in" is fine
 *     until they're reading a help article that says Finances.
 *   • Settings, because it's how you get back here.
 *
 * Everything else is theirs.
 */

/** Keys are the nav item's href, or `section:<name>` for a group heading.
 *  The href is already unique per item and needs no second identifier — the cost
 *  is that changing an href orphans a stored label, which reverts to the default
 *  rather than breaking. */
export type NavLabelKey = string

export const SECTION_KEY_PREFIX = 'section:'

/** Locked by href (or section key). Not renameable at any price. */
const LOCKED: ReadonlySet<NavLabelKey> = new Set([
  '/finances',
  '/reports',
  '/timesheets',
  '/settings',
  '/instagram',
  // Stripe and Xero are the connected services' own names.
  '/finances/stripe',
  '/settings?tab=xero',

  // Locked 2026-07-30 (Karl). These name things the app itself is built
  // around, not things a trainer sells. Renaming Schedule or Dashboard makes
  // support conversations, documentation and every screenshot wrong for that
  // one account, and the words buy nothing — nobody has a different word for
  // their calendar. The offerings above stay renameable, because "1:1
  // Sessions" genuinely is a trainer's own word for their own product.
  '/dashboard',
  '/schedule',
  '/schedule?availability=1',
  '/schedule/route',
  '/sessions/draft-notes',
  '/clients/waitlist',
  '/marketing',
  '/help',
  'section:tools',
  'section:business',

  // Locked too (Karl, 2026-07-30). Clients stays renameable — plenty of
  // trainers say Owners or Members — but an Enquiry is a stage in the app's own
  // pipeline, not a word for a person, so renaming it makes the reports and the
  // follow-up chase read wrong.
  '/enquiries',
  // Messages too — it is the same word in every app anyone uses, and the
  // client side calls it that as well.
  '/messages',
])

/** Locked when the label itself is a proper noun, wherever it sits. Belt and
 *  braces for a nav item that moves house or gets added later. */
const LOCKED_LABELS: ReadonlySet<string> = new Set([
  'Stripe', 'Xero', 'Instagram link', 'Finances', 'Reports', 'Timesheets', 'Settings',
  // Same belt and braces for the 2026-07-30 set: if one of these moves to a new
  // href it stays locked rather than quietly becoming renameable again.
  'Dashboard', 'Schedule', 'Availability', 'Route', 'Notes', 'Waitlist',
  'Marketing', 'Help', 'Tools', 'Business', 'Enquiries', 'Messages',
])

export interface RenameableEntry {
  key: NavLabelKey
  /** What we call it out of the box. */
  defaultLabel: string
  /** A group heading rather than a link, so it reads differently in the editor. */
  isSection: boolean
  /**
   * A few plausible alternatives, shown as the input's placeholder.
   *
   * The placeholder used to repeat our own label, which sat beside a label
   * already saying it — telling the trainer nothing. Examples say what the box
   * is FOR: that "Events" is theirs to call Seminars, or Workshops, or Talks.
   * Several rather than one, so it reads as a range to pick from rather than
   * the single answer we had in mind.
   */
  examples: string[]
}

/**
 * Everything a trainer may rename, in the order the menu shows it.
 *
 * A COPY of what app-shell declares, not a shared import: app-shell is a client
 * component carrying the whole chrome, and the editor and the API both need this
 * list on the server. `tests/unit/nav-labels.test.ts` fails if the two drift, so
 * adding a menu item without listing it here is caught rather than silently
 * un-renameable.
 */
export const NAV_LABEL_CATALOG: readonly RenameableEntry[] = [

  { key: 'section:clients', defaultLabel: 'Clients', isSection: true, examples: ['Owners', 'Members', 'People'] },
  { key: '/clients', defaultLabel: 'Clients', isSection: false, examples: ['Owners', 'Members', 'Guardians'] },

  { key: 'section:programs', defaultLabel: 'Offerings', isSection: true, examples: ['Services', 'Training', 'What we do'] },
  { key: '/packages', defaultLabel: '1:1 Sessions', isSection: false, examples: ['Private lessons', 'One-to-ones', 'Consults'] },
  { key: '/classes', defaultLabel: 'Group Classes', isSection: false, examples: ['Courses', 'Programmes', 'Group training'] },
  { key: '/casual-classes', defaultLabel: 'Casual Classes', isSection: false, examples: ['Drop-ins', 'Pay as you go', 'Casual sessions'] },
  { key: '/events', defaultLabel: 'Events', isSection: false, examples: ['Seminars', 'Workshops', 'Talks'] },
  { key: '/memberships', defaultLabel: 'Packages', isSection: false, examples: ['Memberships', 'Plans', 'Bundles'] },

  { key: '/library', defaultLabel: 'Library', isSection: false, examples: ['Resources', 'Guides', 'Downloads'] },
  { key: '/products', defaultLabel: 'Products', isSection: false, examples: ['Shop', 'Store', 'Merch'] },
  { key: '/achievements', defaultLabel: 'Achievements', isSection: false, examples: ['Badges', 'Milestones', 'Awards'] },


  // The daily three sit above the group headings, so they come last in the
  // editor — a trainer scanning for "Offerings" shouldn't wade past them.
]

export function isRenameable(key: NavLabelKey, defaultLabel: string): boolean {
  if (LOCKED.has(key)) return false
  if (LOCKED_LABELS.has(defaultLabel.trim())) return false
  return true
}

/**
 * A stored override map, cleaned up.
 *
 * Anything blank, unchanged from the default, over-long, or naming something
 * locked is dropped rather than stored — so the map only ever holds real,
 * deliberate renames and can't accumulate junk that shadows a future default.
 */
export function sanitizeNavLabels(
  input: unknown,
  renameable: readonly RenameableEntry[] = NAV_LABEL_CATALOG,
): Record<NavLabelKey, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const allowed = new Map(renameable.map(r => [r.key, r.defaultLabel]))
  const out: Record<NavLabelKey, string> = {}
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (typeof raw !== 'string') continue
    const def = allowed.get(key)
    if (def === undefined) continue
    if (!isRenameable(key, def)) continue
    // Collapse whitespace: a label is one short line, and a stray newline would
    // break the nav row it renders in.
    const value = raw.replace(/\s+/g, ' ').trim().slice(0, 40)
    if (!value) continue
    // Storing "the same as the default" is how a rename silently survives a copy
    // change — drop it and let the default speak.
    if (value === def) continue
    out[key] = value
  }
  return out
}

/** The label to show: their word if they chose one, ours otherwise. */
export function labelFor(
  key: NavLabelKey,
  defaultLabel: string,
  overrides: Record<NavLabelKey, string> | null | undefined,
): string {
  if (!overrides) return defaultLabel
  if (!isRenameable(key, defaultLabel)) return defaultLabel
  const custom = overrides[key]
  return custom && custom.trim() ? custom : defaultLabel
}

/**
 * Their word for a PAGE's own title, when that page is a menu destination.
 *
 * Renaming "Library" to "Resources" in the menu and then landing on a page headed
 * "Library" reads as a bug — the rename looks half-applied. So a page title gets
 * the same treatment, under two deliberately strict conditions:
 *
 *   • the path is (or sits under) a renameable menu destination, longest match
 *     first, so /library/item/xyz still resolves via /library; and
 *   • the title EXACTLY matches what we call that item.
 *
 * The second is what keeps this safe. Page titles are mostly not menu labels —
 * /clients/[id] is headed with a person's name — and a page that titles itself
 * anything else is left alone rather than guessed at.
 */
export function pageTitleLabel(
  pathname: string,
  title: string,
  overrides: Record<NavLabelKey, string> | null | undefined,
): string {
  if (!overrides || Object.keys(overrides).length === 0) return title
  const match = NAV_LABEL_CATALOG
    // Query-string keys ("/schedule?availability=1") aren't paths and would
    // match their own bare route by accident.
    .filter(e => !e.isSection && !e.key.includes('?'))
    .filter(e => pathname === e.key || pathname.startsWith(e.key + '/'))
    .sort((a, b) => b.key.length - a.key.length)[0]
  if (!match) return title
  if (title.trim() !== match.defaultLabel) return title
  return labelFor(match.key, match.defaultLabel, overrides)
}

/** Key for a section heading. */
export function sectionKey(section: string): NavLabelKey {
  return `${SECTION_KEY_PREFIX}${section}`
}

/**
 * Should a group heading be drawn at all?
 *
 * A heading over ONE row is chrome that earns nothing — it says "Offerings" above
 * a single "Group Classes" link, which the link already told you. With add-ons
 * hiding most of a section, that's a real state, not a hypothetical.
 * (Karl's pinned review note, 2026-07-30.)
 */
export function shouldShowSectionHeader(itemsInSection: number): boolean {
  return itemsInSection > 1
}

/**
 * Which trainer label a CLIENT-side menu item borrows.
 *
 * A trainer who renames Events to Seminars has clients who should see
 * Seminars too — the words are the business's, not the trainer screen's.
 *
 * Mapped by MEANING, not by matching text. Two deliberate omissions:
 *
 * - The client's "Sessions" is everything they have booked, across classes,
 *   events and one-to-ones. The trainer's "1:1 Sessions" is one product among
 *   several. Renaming that product to "Private lessons" must not relabel a list
 *   that also holds their group classes.
 * - "Home", "Invoices" and "My dogs" have no trainer-side twin to borrow from.
 */
export const CLIENT_LABEL_SOURCE: Readonly<Record<string, NavLabelKey>> = {
  '/my-availability': 'section:programs',
  '/my-memberships': '/memberships',
  '/my-achievements': '/achievements',
  // The client's shop IS the trainer's product list, seen from the other side.
  '/my-shop': '/products',
}

/** A client-side item's label: the trainer's word for it when they have one. */
export function clientLabelFor(
  href: string,
  fallback: string,
  overrides: Record<NavLabelKey, string> | null | undefined,
): string {
  const source = CLIENT_LABEL_SOURCE[href]
  if (!source) return fallback
  const entry = NAV_LABEL_CATALOG.find(e => e.key === source)
  // labelFor enforces the lock and the sanitizer, so a client can never be
  // shown a word the trainer was not allowed to set.
  return labelFor(source, entry?.defaultLabel ?? fallback, overrides)
}
