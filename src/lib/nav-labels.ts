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
])

/** Locked when the label itself is a proper noun, wherever it sits. Belt and
 *  braces for a nav item that moves house or gets added later. */
const LOCKED_LABELS: ReadonlySet<string> = new Set([
  'Stripe', 'Xero', 'Instagram link', 'Finances', 'Reports', 'Timesheets', 'Settings',
])

export interface RenameableEntry {
  key: NavLabelKey
  /** What we call it out of the box. */
  defaultLabel: string
  /** A group heading rather than a link, so it reads differently in the editor. */
  isSection: boolean
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
  { key: 'section:clients', defaultLabel: 'Clients', isSection: true },
  { key: '/clients', defaultLabel: 'Clients', isSection: false },
  { key: '/enquiries', defaultLabel: 'Enquiries', isSection: false },
  { key: '/sessions/draft-notes', defaultLabel: 'Notes', isSection: false },
  { key: '/clients/waitlist', defaultLabel: 'Waitlist', isSection: false },

  { key: 'section:programs', defaultLabel: 'Offerings', isSection: true },
  { key: '/packages', defaultLabel: '1:1 Sessions', isSection: false },
  { key: '/classes', defaultLabel: 'Group Classes', isSection: false },
  { key: '/casual-classes', defaultLabel: 'Casual Classes', isSection: false },
  { key: '/events', defaultLabel: 'Events', isSection: false },
  { key: '/memberships', defaultLabel: 'Packages', isSection: false },

  { key: 'section:tools', defaultLabel: 'Tools', isSection: true },
  { key: '/schedule/route', defaultLabel: 'Route', isSection: false },
  { key: '/library', defaultLabel: 'Library', isSection: false },
  { key: '/products', defaultLabel: 'Products', isSection: false },
  { key: '/achievements', defaultLabel: 'Achievements', isSection: false },

  { key: 'section:business', defaultLabel: 'Business', isSection: true },
  { key: '/marketing', defaultLabel: 'Marketing', isSection: false },

  // The daily three sit above the group headings, so they come last in the
  // editor — a trainer scanning for "Offerings" shouldn't wade past them.
  { key: '/dashboard', defaultLabel: 'Dashboard', isSection: false },
  { key: '/messages', defaultLabel: 'Messages', isSection: false },
  { key: '/schedule', defaultLabel: 'Schedule', isSection: false },
  { key: '/schedule?availability=1', defaultLabel: 'Availability', isSection: false },
  { key: '/help', defaultLabel: 'Help', isSection: false },
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
