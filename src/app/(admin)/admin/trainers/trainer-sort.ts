// Sorting for the Super Admin Businesses table.
//
// Sorting happens in JS, on the rows we already fetched — deliberately, not for
// want of a Prisma `orderBy`:
//   • The list has no pagination (every matching row is fetched; ~60 in prod),
//     so there is nothing for the database to narrow down.
//   • HALF the columns aren't database fields. Value is priced from the catalog
//     (planValueFor), Onboarding is derived live per trainer, Clients is a
//     relation count, Emails comes off a nested count. A DB-only sort would
//     leave those headers dead, and a table where some headers sort and some
//     don't is worse than one that doesn't sort at all.
// One comparator for every column keeps them all behaving identically.
//
// Pure + dependency-free (no prisma, no React) so it unit-tests directly.
import { LIKELIHOODS } from '@/lib/conversion-likelihood'
import { toNzd } from '@/lib/fx'
import type { PlanValue } from '@/lib/plan-value'

export type SortKey =
  | 'name' | 'business' | 'country' | 'likely' | 'clients' | 'onboarding'
  | 'emails' | 'joined' | 'lastSeen' | 'trialEnds' | 'value'

export type SortDir = 'asc' | 'desc'

export interface SortState { key: SortKey; dir: SortDir }

/** The only fields the comparators touch — a subset of the rendered row. */
export interface SortableTrainer {
  name: string | null
  businessName: string | null
  signupCountry: string | null
  conversionLikelihood: string | null
  clientCount: number
  onboardingCompleted: number
  onboardingTotal: number
  onboardingEmails: number
  createdAt: Date | string
  lastLoginAt: Date | string | null
  trialEndsAt: Date | string | null
  planValue: PlanValue | null
}

// Column definitions, in header order. `defaultDir` is the direction a column
// takes on its FIRST click — the reading most admins want without a second
// click: text A→Z, counts/money/dates biggest-or-newest first, and trial ends
// soonest first (that column is a conversion call list, not a calendar).
export const SORT_COLUMNS: { key: SortKey; label: string; defaultDir: SortDir }[] = [
  { key: 'name',       label: 'Name',       defaultDir: 'asc'  },
  { key: 'business',   label: 'Business',   defaultDir: 'asc'  },
  { key: 'country',    label: 'Country',    defaultDir: 'asc'  },
  { key: 'likely',     label: 'Likely',     defaultDir: 'desc' },
  { key: 'clients',    label: 'Clients',    defaultDir: 'desc' },
  { key: 'onboarding', label: 'Onboarding', defaultDir: 'desc' },
  { key: 'emails',     label: 'Emails',     defaultDir: 'desc' },
  { key: 'joined',     label: 'Joined',     defaultDir: 'desc' },
  { key: 'lastSeen',   label: 'Last seen',  defaultDir: 'desc' },
  { key: 'trialEnds',  label: 'Trial ends', defaultDir: 'asc'  },
  { key: 'value',      label: 'Value',      defaultDir: 'desc' },
]

const KEYS = new Set<string>(SORT_COLUMNS.map(c => c.key))

/**
 * Columns that can never say anything on a given tab — hidden there rather than
 * printed as a column of "—". Keyed by the tab keys in (admin)/admin/page.tsx
 * TABS; ONE declaration feeds the header row, the body cells, the mobile cards
 * and the sort strip, so they cannot drift out of alignment.
 *
 * Why each:
 *  • trial   → Value: a trialist has no subscription, so planValueFor is never
 *              called for them (see trainers-table) — always empty.
 *  • paying  → Likely / Trial ends: both are questions about whether someone
 *              WILL convert; they already have. Onboarding is a trial-period
 *              concern too.
 *  • churned → Value: CANCELLED can't be a paying customer, so the value is
 *              null for every row by definition.
 *  • ours    → Value: internal accounts are deliberately excluded from plan
 *              value (we don't bill ourselves).
 *  • inactive→ nothing: it holds deactivated accounts from ANY lifecycle, so a
 *              row there can legitimately carry a trial, a value or neither.
 */
export const HIDDEN_COLUMNS_BY_TAB: Record<string, readonly SortKey[]> = {
  trial: ['value'],
  paying: ['likely', 'onboarding', 'trialEnds'],
  churned: ['value'],
  ours: ['value'],
  inactive: [],
}

/** Is this column suppressed on this tab? Unknown tabs show everything. */
export function isColumnHidden(key: SortKey, tab?: string): boolean {
  return (HIDDEN_COLUMNS_BY_TAB[tab ?? ''] ?? []).includes(key)
}

/** The columns this tab actually renders, in header order. */
export function visibleSortColumns(tab?: string) {
  return SORT_COLUMNS.filter(c => !isColumnHidden(c.key, tab))
}

/**
 * Read `?sort=&dir=` off the URL. Returns null for anything we don't recognise
 * (including no sort at all) — and null means "leave the default DB order
 * alone", which is how the In-Trial tab keeps leading with whoever runs out
 * first.
 */
export function parseSort(sort?: string, dir?: string): SortState | null {
  if (!sort || !KEYS.has(sort)) return null
  const key = sort as SortKey
  const fallback = SORT_COLUMNS.find(c => c.key === key)!.defaultDir
  return { key, dir: dir === 'asc' || dir === 'desc' ? dir : fallback }
}

/**
 * What a tab sorts by before anyone clicks a heading.
 *
 * In Trial used to arrive in the query's own order — trial ending soonest — but
 * the question actually being asked of that tab is "who just signed up", and
 * answering it meant clicking Joined every single visit (Karl, 2026-08-06).
 *
 * A tab with no entry keeps the query's order, which is still the right default
 * everywhere else.
 */
const TAB_DEFAULT_SORT: Record<string, SortState> = {
  trial: { key: 'joined', dir: 'desc' },
}

/**
 * `parseSort`, but a sort on a column this tab HIDES falls back to the tab's
 * default order. Sort by Value on Churned, switch to In Trial (where Value is
 * hidden), and an invisible sort key would look like the rows had shuffled
 * themselves — the one interaction between per-tab columns and sorting that
 * bites. Every URL builder here drops the params too, so it self-heals.
 */
export function resolveSort(sort?: string, dir?: string, tab?: string): SortState | null {
  const state = parseSort(sort, dir)
  if (!state || isColumnHidden(state.key, tab)) return tabDefaultSort(tab)
  return state
}

/** The tab's own default, or null to keep the query's order. Never returns a
 *  column the tab hides — that would sort by something invisible. */
function tabDefaultSort(tab?: string): SortState | null {
  const fallback = tab ? TAB_DEFAULT_SORT[tab] : undefined
  if (!fallback || isColumnHidden(fallback.key, tab)) return null
  return fallback
}

/** Direction a header link should request: flip the active column, else its default. */
export function nextDir(key: SortKey, active: SortState | null): SortDir {
  if (active?.key === key) return active.dir === 'asc' ? 'desc' : 'asc'
  return SORT_COLUMNS.find(c => c.key === key)!.defaultDir
}

/** Milliseconds, or null for missing/unparseable — nulls are handled by the sorter. */
function time(d: Date | string | null | undefined): number | null {
  if (!d) return null
  const n = new Date(d).getTime()
  return Number.isNaN(n) ? null : n
}

/** Trimmed text, or null when blank — a blank cell renders "—" and sorts as missing. */
function text(s: string | null | undefined): string | null {
  const t = s?.trim()
  return t ? t : null
}

/**
 * The comparable value for one row in one column. `null` means "no value" and
 * always sinks to the bottom (see below).
 */
function valueOf(row: SortableTrainer, key: SortKey): string | number | null {
  switch (key) {
    case 'name':      return text(row.name)
    case 'business':  return text(row.businessName)
    case 'country':   return text(row.signupCountry)
    // Sales judgement is an ORDERED scale (Nah → Definitely), so sort by its
    // rank. Alphabetical would read Definitely, Maybe, Nah, Yeah — nonsense.
    case 'likely': {
      const i = LIKELIHOODS.indexOf(row.conversionLikelihood as never)
      return i === -1 ? null : i
    }
    case 'clients':   return row.clientCount
    // Proportion complete, not raw steps: the catalog length can differ between
    // accounts, so 4/5 must outrank 4/12.
    case 'onboarding': return row.onboardingTotal > 0 ? row.onboardingCompleted / row.onboardingTotal : 0
    case 'emails':    return row.onboardingEmails
    case 'joined':    return time(row.createdAt)
    case 'lastSeen':  return time(row.lastLoginAt)
    case 'trialEnds': return time(row.trialEndsAt)
    // Money is per-customer currency (six of them), so the raw number is not
    // comparable — £99 and $99 would interleave meaninglessly. Compare the
    // approximate NZD equivalent, the same yardstick the ARR bar uses.
    case 'value':     return row.planValue ? toNzd(row.planValue.monthly, row.planValue.currency) : null
  }
}

/**
 * Sort a copy of `rows` by one column.
 *
 * Two rules worth stating:
 *  • NULLS ALWAYS LAST, in both directions. A trainer with no trial end, no
 *    plan value, or who has never signed in is *missing* data, not the
 *    smallest/largest — flipping direction shouldn't dump eleven "—" rows on
 *    top of the screen and push the real answers off it.
 *  • Ties keep the incoming order (Array#sort is stable), so equal rows stay in
 *    the tab's default order rather than shuffling between loads.
 */
export function sortTrainers<T extends SortableTrainer>(rows: readonly T[], state: SortState | null): T[] {
  if (!state) return [...rows]
  const sign = state.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = valueOf(a, state.key)
    const bv = valueOf(b, state.key)
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    if (typeof av === 'string' && typeof bv === 'string') {
      // Case-insensitive, and numeric-aware so "Business 10" follows "Business 9".
      return sign * av.localeCompare(bv, 'en', { sensitivity: 'base', numeric: true })
    }
    return sign * ((av as number) - (bv as number))
  })
}
