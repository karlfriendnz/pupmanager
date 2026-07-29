import { describe, it, expect } from 'vitest'
import { orderCountryCounts } from '@/app/(admin)/admin/country-summary'
import { flagEmoji } from '@/lib/countries'

// The country panel above the businesses table. It sits over a list you can sort
// by country, so its ordering has to be the one a reader expects — biggest group
// first — and its numbers have to add up to the tab's own count, which means the
// accounts with no country recorded can't quietly be dropped.

describe('orderCountryCounts', () => {
  const rows = [
    { code: 'AU', count: 1 },
    { code: 'GB', count: 3 },
    { code: null, count: 5 },
    { code: 'NZ', count: 1 },
    { code: 'ZA', count: 1 },
  ]

  it('puts the biggest country first', () => {
    expect(orderCountryCounts(rows).known.map(r => r.code)).toEqual(['GB', 'AU', 'NZ', 'ZA'])
  })

  // Ties break on the country's NAME, not its code — Australia, New Zealand,
  // South Africa reads right; AU, NZ, ZA is the same here but wouldn't be for,
  // say, DE (Germany) against DK (Denmark).
  it('breaks ties on the country name rather than the code', () => {
    const tied = [{ code: 'DE', count: 2 }, { code: 'DK', count: 2 }]
    expect(orderCountryCounts(tied).known.map(r => r.code)).toEqual(['DK', 'DE'])
  })

  it('keeps the unknown group separate from the named ones', () => {
    const { known, unknown } = orderCountryCounts(rows)
    expect(known.every(r => r.code)).toBe(true)
    expect(unknown).toEqual({ code: null, count: 5 })
  })

  // The chips have to reconcile with the tab count above them, or the panel is
  // describing a different set of businesses than the table.
  it('totals every row, named or not', () => {
    expect(orderCountryCounts(rows).total).toBe(11)
  })

  it('has nothing to say about an empty tab', () => {
    expect(orderCountryCounts([])).toEqual({ known: [], unknown: undefined, total: 0 })
  })

  it('does not mutate the caller’s array', () => {
    const input = [{ code: 'AU', count: 1 }, { code: 'GB', count: 3 }]
    orderCountryCounts(input)
    expect(input.map(r => r.code)).toEqual(['AU', 'GB'])
  })
})

describe('flagEmoji', () => {
  it('turns a 2-letter code into its flag', () => {
    expect(flagEmoji('NZ')).toBe('🇳🇿')
    expect(flagEmoji('gb')).toBe('🇬🇧')
  })

  // Null rather than two mystery boxes, so a caller can fall back to the code.
  it('is null for anything that isn’t a clean code', () => {
    for (const bad of [null, undefined, '', 'N', 'NZL', 'N1', '🇳🇿']) {
      expect(flagEmoji(bad)).toBeNull()
    }
  })
})
