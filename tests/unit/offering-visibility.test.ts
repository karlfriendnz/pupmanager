import { describe, it, expect } from 'vitest'
import {
  offeringVisibleWhere,
  offeringVisibleRelationWhere,
  isOfferingVisibleToClients,
  notYetShowingBadge,
  visibleFromInstant,
  visibleFromDateStr,
} from '@/lib/offering-visibility'

// `Package.visibleFrom` — the instant an offering starts being visible to
// clients. Two ways to get it wrong, both silent: publish something the trainer
// had held back, or hide something with no schedule at all because NULL failed
// a comparison.

const NOW = new Date('2026-08-02T09:00:00.000Z')

describe('offeringVisibleWhere', () => {
  it('lets an ungated offering through EXPLICITLY, not by omission', () => {
    // Postgres NULL fails every comparison, so `{ not: { gt: now } }` would
    // exclude the ~100% of offerings that have no schedule — the loudest
    // possible way to get this backwards.
    expect(offeringVisibleWhere(NOW)).toEqual({
      OR: [{ visibleFrom: null }, { visibleFrom: { lte: NOW } }],
    })
  })

  it('offers no other conditions — nothing else may narrow it', () => {
    const where = offeringVisibleWhere(NOW)
    expect(Object.keys(where)).toEqual(['OR'])
    expect(where.OR).toHaveLength(2)
  })

  it('wraps the same rule for a read that arrives through a relation', () => {
    expect(offeringVisibleRelationWhere(NOW)).toEqual({ package: offeringVisibleWhere(NOW) })
  })
})

describe('isOfferingVisibleToClients', () => {
  it('shows an offering with no schedule', () => {
    expect(isOfferingVisibleToClients({ visibleFrom: null }, NOW)).toBe(true)
  })

  it('hides one whose day has not come', () => {
    expect(isOfferingVisibleToClients({ visibleFrom: new Date('2026-09-01T00:00:00.000Z') }, NOW)).toBe(false)
  })

  it('shows one whose day has come, on the instant', () => {
    expect(isOfferingVisibleToClients({ visibleFrom: NOW }, NOW)).toBe(true)
    expect(isOfferingVisibleToClients({ visibleFrom: new Date('2026-07-01T00:00:00.000Z') }, NOW)).toBe(true)
  })
})

describe('notYetShowingBadge', () => {
  it('says nothing at all about an offering that is already showing', () => {
    expect(notYetShowingBadge(null, NOW)).toBeNull()
    expect(notYetShowingBadge(undefined, NOW)).toBeNull()
    expect(notYetShowingBadge(new Date('2026-07-01T00:00:00.000Z'), NOW)).toBeNull()
  })

  it('marks a held-back one, and takes an ISO string as readily as a Date', () => {
    expect(notYetShowingBadge(new Date('2026-09-01T00:00:00.000Z'), NOW)).toEqual({ label: 'Not showing yet', tone: 'warn' })
    expect(notYetShowingBadge('2026-09-01T00:00:00.000Z', NOW)).toEqual({ label: 'Not showing yet', tone: 'warn' })
  })

  it('says nothing rather than something wrong about an unparseable value', () => {
    expect(notYetShowingBadge('not a date', NOW)).toBeNull()
  })
})

describe('the day ↔ instant crossing', () => {
  it('stores the trainer\'s midnight, not UTC\'s', () => {
    // 1 December in Auckland begins at 11:00 UTC on 30 November. Stored as UTC
    // midnight instead, an NZ trainer's term would appear 13 hours early — and
    // a Los Angeles trainer's a whole day early.
    expect(visibleFromInstant('2026-12-01', 'Pacific/Auckland')?.toISOString())
      .toBe('2026-11-30T11:00:00.000Z')
    expect(visibleFromInstant('2026-12-01', 'America/Los_Angeles')?.toISOString())
      .toBe('2026-12-01T08:00:00.000Z')
  })

  it('round-trips the day the trainer picked', () => {
    for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'Europe/London', 'UTC']) {
      const stored = visibleFromInstant('2026-12-01', tz)
      expect(visibleFromDateStr(stored, tz)).toBe('2026-12-01')
    }
  })

  it('treats "no date" as no date in both directions', () => {
    expect(visibleFromInstant(null, 'Pacific/Auckland')).toBeNull()
    expect(visibleFromInstant('', 'Pacific/Auckland')).toBeNull()
    expect(visibleFromDateStr(null, 'Pacific/Auckland')).toBeNull()
  })
})
