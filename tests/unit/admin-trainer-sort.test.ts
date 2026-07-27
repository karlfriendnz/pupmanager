import { describe, it, expect } from 'vitest'
import {
  HIDDEN_COLUMNS_BY_TAB,
  SORT_COLUMNS,
  isColumnHidden,
  nextDir,
  parseSort,
  resolveSort,
  sortTrainers,
  visibleSortColumns,
  type SortableTrainer,
} from '@/app/(admin)/admin/trainers/trainer-sort'

// Column sorting for the Super Admin Businesses table. The comparators live
// away from Prisma on purpose (half the columns are computed, not stored), so
// everything here is exercised directly on plain rows.

function row(over: Partial<SortableTrainer> & { id?: string } = {}): SortableTrainer & { id: string } {
  return {
    id: over.id ?? 'x',
    name: null,
    businessName: null,
    signupCountry: null,
    conversionLikelihood: null,
    clientCount: 0,
    onboardingCompleted: 0,
    onboardingTotal: 0,
    onboardingEmails: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastLoginAt: null,
    trialEndsAt: null,
    planValue: null,
    ...over,
  }
}

const ids = (rows: { id: string }[]) => rows.map(r => r.id)

describe('parseSort / nextDir', () => {
  it('ignores a missing or unknown column — that means "leave the default order alone"', () => {
    expect(parseSort(undefined, 'asc')).toBeNull()
    expect(parseSort('', 'asc')).toBeNull()
    expect(parseSort('nonsense', 'asc')).toBeNull()
  })

  it('falls back to the column default when the direction is missing or junk', () => {
    expect(parseSort('name')).toEqual({ key: 'name', dir: 'asc' })
    expect(parseSort('name', 'sideways')).toEqual({ key: 'name', dir: 'asc' })
    // Counts/money/dates read biggest-or-newest first on the first click.
    expect(parseSort('value')).toEqual({ key: 'value', dir: 'desc' })
    expect(parseSort('joined')).toEqual({ key: 'joined', dir: 'desc' })
    // Trial ends is a call list: soonest first.
    expect(parseSort('trialEnds')).toEqual({ key: 'trialEnds', dir: 'asc' })
  })

  it('honours an explicit direction', () => {
    expect(parseSort('clients', 'asc')).toEqual({ key: 'clients', dir: 'asc' })
  })

  it('toggles the active column and uses the default for any other', () => {
    expect(nextDir('name', { key: 'name', dir: 'asc' })).toBe('desc')
    expect(nextDir('name', { key: 'name', dir: 'desc' })).toBe('asc')
    expect(nextDir('clients', { key: 'name', dir: 'asc' })).toBe('desc')
    expect(nextDir('business', null)).toBe('asc')
  })
})

describe('sortTrainers — default order', () => {
  it('no sort state = the order it was given (the tab default survives)', () => {
    const rows = [row({ id: 'b', name: 'Bea' }), row({ id: 'a', name: 'Ann' })]
    expect(ids(sortTrainers(rows, null))).toEqual(['b', 'a'])
  })

  it('never mutates the input array', () => {
    const rows = [row({ id: 'b', name: 'Bea' }), row({ id: 'a', name: 'Ann' })]
    sortTrainers(rows, { key: 'name', dir: 'asc' })
    expect(ids(rows)).toEqual(['b', 'a'])
  })
})

describe('sortTrainers — text columns', () => {
  it('sorts case-insensitively', () => {
    const rows = [
      row({ id: 'z', businessName: 'zebra dogs' }),
      row({ id: 'A', businessName: 'Alpha Hounds' }),
      row({ id: 'm', businessName: 'mutt Manor' }),
    ]
    expect(ids(sortTrainers(rows, { key: 'business', dir: 'asc' }))).toEqual(['A', 'm', 'z'])
    expect(ids(sortTrainers(rows, { key: 'business', dir: 'desc' }))).toEqual(['z', 'm', 'A'])
  })

  it('treats blank/whitespace text as missing, not as an empty string that sorts first', () => {
    const rows = [
      row({ id: 'blank', name: '   ' }),
      row({ id: 'ann', name: 'Ann' }),
      row({ id: 'none', name: null }),
    ]
    expect(ids(sortTrainers(rows, { key: 'name', dir: 'asc' }))).toEqual(['ann', 'blank', 'none'])
    // Nulls stay last when the direction flips too.
    expect(ids(sortTrainers(rows, { key: 'name', dir: 'desc' })).slice(0, 1)).toEqual(['ann'])
  })

  it('compares country codes as text', () => {
    const rows = [row({ id: 'nz', signupCountry: 'NZ' }), row({ id: 'au', signupCountry: 'AU' })]
    expect(ids(sortTrainers(rows, { key: 'country', dir: 'asc' }))).toEqual(['au', 'nz'])
  })
})

describe('sortTrainers — numeric columns', () => {
  it('sorts client counts numerically, not as strings', () => {
    const rows = [row({ id: '9', clientCount: 9 }), row({ id: '100', clientCount: 100 }), row({ id: '20', clientCount: 20 })]
    expect(ids(sortTrainers(rows, { key: 'clients', dir: 'desc' }))).toEqual(['100', '20', '9'])
    expect(ids(sortTrainers(rows, { key: 'clients', dir: 'asc' }))).toEqual(['9', '20', '100'])
  })

  it('sorts onboarding by PROPORTION complete, so 4/5 beats 4/12', () => {
    const rows = [
      row({ id: 'long', onboardingCompleted: 4, onboardingTotal: 12 }),
      row({ id: 'short', onboardingCompleted: 4, onboardingTotal: 5 }),
      row({ id: 'none', onboardingCompleted: 0, onboardingTotal: 0 }),
    ]
    expect(ids(sortTrainers(rows, { key: 'onboarding', dir: 'desc' }))).toEqual(['short', 'long', 'none'])
  })

  it('sorts emails sent', () => {
    const rows = [row({ id: 'a', onboardingEmails: 1 }), row({ id: 'b', onboardingEmails: 7 })]
    expect(ids(sortTrainers(rows, { key: 'emails', dir: 'desc' }))).toEqual(['b', 'a'])
  })

  it('ranks Likely on its own cold→warm scale, not alphabetically', () => {
    // Alphabetical would give DEFINITELY, MAYBE, NAH, YEAH — meaningless.
    const rows = [
      row({ id: 'maybe', conversionLikelihood: 'MAYBE' }),
      row({ id: 'definitely', conversionLikelihood: 'DEFINITELY' }),
      row({ id: 'nah', conversionLikelihood: 'NAH' }),
      row({ id: 'yeah', conversionLikelihood: 'YEAH' }),
      row({ id: 'unset', conversionLikelihood: null }),
    ]
    expect(ids(sortTrainers(rows, { key: 'likely', dir: 'desc' })))
      .toEqual(['definitely', 'yeah', 'maybe', 'nah', 'unset'])
    expect(ids(sortTrainers(rows, { key: 'likely', dir: 'asc' })))
      .toEqual(['nah', 'maybe', 'yeah', 'definitely', 'unset'])
  })
})

describe('sortTrainers — date columns', () => {
  it('sorts chronologically, and accepts ISO strings as well as Dates', () => {
    const rows = [
      row({ id: 'jun', createdAt: '2026-06-01T00:00:00Z' }),
      row({ id: 'jan', createdAt: new Date('2026-01-15T00:00:00Z') }),
      row({ id: 'dec', createdAt: '2026-12-31T00:00:00Z' }),
    ]
    expect(ids(sortTrainers(rows, { key: 'joined', dir: 'desc' }))).toEqual(['dec', 'jun', 'jan'])
    expect(ids(sortTrainers(rows, { key: 'joined', dir: 'asc' }))).toEqual(['jan', 'jun', 'dec'])
  })

  it('sorts trial ends soonest-first and keeps "no trial" out of the way', () => {
    const rows = [
      row({ id: 'later', trialEndsAt: '2026-09-01T00:00:00Z' }),
      row({ id: 'none', trialEndsAt: null }),
      row({ id: 'soon', trialEndsAt: '2026-08-01T00:00:00Z' }),
    ]
    expect(ids(sortTrainers(rows, { key: 'trialEnds', dir: 'asc' }))).toEqual(['soon', 'later', 'none'])
    expect(ids(sortTrainers(rows, { key: 'trialEnds', dir: 'desc' }))).toEqual(['later', 'soon', 'none'])
  })

  it('sorts last seen, with "Never" last in both directions', () => {
    const rows = [
      row({ id: 'never', lastLoginAt: null }),
      row({ id: 'old', lastLoginAt: '2026-01-01T00:00:00Z' }),
      row({ id: 'recent', lastLoginAt: '2026-07-20T00:00:00Z' }),
    ]
    expect(ids(sortTrainers(rows, { key: 'lastSeen', dir: 'desc' }))).toEqual(['recent', 'old', 'never'])
    expect(ids(sortTrainers(rows, { key: 'lastSeen', dir: 'asc' }))).toEqual(['old', 'recent', 'never'])
  })
})

describe('sortTrainers — Value (computed, per-currency)', () => {
  it('compares the NZD equivalent, so currencies do not interleave meaninglessly', () => {
    // Raw numbers say NZD 100 > GBP 60. Converted (GBP ≈ 2.10 NZD) the GBP
    // customer is worth ~126 NZD and is the bigger account. That is the whole
    // reason this column can't be sorted on the stored figure.
    const rows = [
      row({ id: 'nzd', planValue: { currency: 'NZD', monthly: 100, annual: 1200 } }),
      row({ id: 'gbp', planValue: { currency: 'GBP', monthly: 60, annual: 720 } }),
      row({ id: 'zar', planValue: { currency: 'ZAR', monthly: 900, annual: 10800 } }),
    ]
    // GBP 60 → ~126, NZD 100 → 100, ZAR 900 → ~81.
    expect(ids(sortTrainers(rows, { key: 'value', dir: 'desc' }))).toEqual(['gbp', 'nzd', 'zar'])
    expect(ids(sortTrainers(rows, { key: 'value', dir: 'asc' }))).toEqual(['zar', 'nzd', 'gbp'])
  })

  it('parks trainers with no plan value at the bottom whichever way you sort', () => {
    const rows = [
      row({ id: 'none1', planValue: null }),
      row({ id: 'paid', planValue: { currency: 'NZD', monthly: 49, annual: 588 } }),
      row({ id: 'none2', planValue: null }),
    ]
    expect(ids(sortTrainers(rows, { key: 'value', dir: 'desc' }))).toEqual(['paid', 'none1', 'none2'])
    expect(ids(sortTrainers(rows, { key: 'value', dir: 'asc' }))).toEqual(['paid', 'none1', 'none2'])
  })

  it('keeps equal rows in the order they arrived (stable), so ties fall back to the tab default', () => {
    const rows = [
      row({ id: 'first', clientCount: 3 }),
      row({ id: 'second', clientCount: 3 }),
      row({ id: 'third', clientCount: 3 }),
    ]
    expect(ids(sortTrainers(rows, { key: 'clients', dir: 'desc' }))).toEqual(['first', 'second', 'third'])
  })
})

describe('per-tab columns', () => {
  it('hides the columns that can never say anything on that tab', () => {
    // A trialist has no subscription, so Value is empty for every row.
    expect(isColumnHidden('value', 'trial')).toBe(true)
    // Someone who has converted has no "will they?" and no trial left to run.
    expect(isColumnHidden('likely', 'paying')).toBe(true)
    expect(isColumnHidden('trialEnds', 'paying')).toBe(true)
    expect(isColumnHidden('onboarding', 'paying')).toBe(true)
    // Cancelled can't be a paying customer; internal accounts are excluded from
    // plan value by design — both would be a column of dashes.
    expect(isColumnHidden('value', 'churned')).toBe(true)
    expect(isColumnHidden('value', 'ours')).toBe(true)
    // Inactive holds deactivated accounts from any lifecycle — keep everything.
    expect(HIDDEN_COLUMNS_BY_TAB.inactive).toEqual([])
    expect(isColumnHidden('value', 'inactive')).toBe(false)
    // An unknown tab shows the lot rather than hiding something at random.
    expect(isColumnHidden('value', undefined)).toBe(false)
    expect(isColumnHidden('value', 'made-up')).toBe(false)
  })

  it('never hides a column that carries the row identity', () => {
    for (const hidden of Object.values(HIDDEN_COLUMNS_BY_TAB)) {
      expect(hidden).not.toContain('name')
      expect(hidden).not.toContain('business')
    }
  })

  it('visibleSortColumns drops exactly those, keeping header order', () => {
    const trial = visibleSortColumns('trial').map(c => c.key)
    expect(trial).toHaveLength(SORT_COLUMNS.length - 1)
    expect(trial).not.toContain('value')
    expect(trial.slice(0, 3)).toEqual(['name', 'business', 'country'])

    // Paying keeps Value — that's the one tab where it always has something to say.
    const paying = visibleSortColumns('paying').map(c => c.key)
    expect(paying).toEqual(['name', 'business', 'country', 'clients', 'emails', 'joined', 'lastSeen', 'value'])

    expect(visibleSortColumns('inactive')).toHaveLength(SORT_COLUMNS.length)
  })
})

describe('resolveSort — sorting and per-tab columns together', () => {
  it('drops a sort on a column the tab hides, falling back to the default order', () => {
    // Sort by Value on Churned, then switch to In Trial (Value hidden there):
    // keeping it would look like the rows had shuffled themselves.
    expect(resolveSort('value', 'desc', 'churned')).toBeNull()
    expect(resolveSort('value', 'desc', 'trial')).toBeNull()
    expect(resolveSort('trialEnds', 'asc', 'paying')).toBeNull()
    expect(resolveSort('likely', 'desc', 'paying')).toBeNull()
    expect(resolveSort('onboarding', 'desc', 'paying')).toBeNull()
  })

  it('keeps a sort the tab still shows', () => {
    expect(resolveSort('value', 'desc', 'inactive')).toEqual({ key: 'value', dir: 'desc' })
    expect(resolveSort('clients', 'asc', 'trial')).toEqual({ key: 'clients', dir: 'asc' })
    expect(resolveSort('trialEnds', undefined, 'trial')).toEqual({ key: 'trialEnds', dir: 'asc' })
  })

  it('is still null when there was no sort to begin with', () => {
    expect(resolveSort(undefined, undefined, 'trial')).toBeNull()
  })
})
