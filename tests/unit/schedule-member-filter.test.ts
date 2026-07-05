import { describe, it, expect } from 'vitest'
import {
  filterSessionsByMember,
  resolveMemberFilter,
  MEMBER_EVERYONE,
  MEMBER_UNASSIGNED,
} from '../../src/lib/schedule-member-filter'

// Minimal session shape the filter cares about.
type S = { id: string; assignedMembershipId: string | null }

const sessions: S[] = [
  { id: 'a', assignedMembershipId: 'm1' },
  { id: 'b', assignedMembershipId: 'm2' },
  { id: 'c', assignedMembershipId: null },
  { id: 'd', assignedMembershipId: 'm1' },
  { id: 'e', assignedMembershipId: null },
]

const ids = (list: S[]) => list.map(s => s.id)

describe('filterSessionsByMember', () => {
  it('returns everything for the "everyone" sentinel', () => {
    expect(ids(filterSessionsByMember(sessions, MEMBER_EVERYONE))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns everything for null / undefined / empty string', () => {
    expect(ids(filterSessionsByMember(sessions, null))).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(ids(filterSessionsByMember(sessions, undefined))).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(ids(filterSessionsByMember(sessions, ''))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('filters to a single member id', () => {
    expect(ids(filterSessionsByMember(sessions, 'm1'))).toEqual(['a', 'd'])
    expect(ids(filterSessionsByMember(sessions, 'm2'))).toEqual(['b'])
  })

  it('filters to only unassigned sessions', () => {
    expect(ids(filterSessionsByMember(sessions, MEMBER_UNASSIGNED))).toEqual(['c', 'e'])
  })

  it('returns an empty list for a member with no sessions', () => {
    expect(filterSessionsByMember(sessions, 'nobody')).toEqual([])
  })

  it('does not mutate the input array', () => {
    const copy = [...sessions]
    filterSessionsByMember(sessions, 'm1')
    expect(sessions).toEqual(copy)
  })
})

describe('resolveMemberFilter', () => {
  const known = ['m1', 'm2']

  it('keeps a valid member id', () => {
    expect(resolveMemberFilter('m1', known, true)).toBe('m1')
  })

  it('collapses an unknown / stale member id to everyone', () => {
    expect(resolveMemberFilter('ghost', known, true)).toBe(MEMBER_EVERYONE)
  })

  it('keeps "unassigned" when unassigned sessions exist', () => {
    expect(resolveMemberFilter(MEMBER_UNASSIGNED, known, true)).toBe(MEMBER_UNASSIGNED)
  })

  it('drops "unassigned" to everyone when none exist', () => {
    expect(resolveMemberFilter(MEMBER_UNASSIGNED, known, false)).toBe(MEMBER_EVERYONE)
  })

  it('treats null / undefined / everyone as everyone', () => {
    expect(resolveMemberFilter(null, known, true)).toBe(MEMBER_EVERYONE)
    expect(resolveMemberFilter(undefined, known, true)).toBe(MEMBER_EVERYONE)
    expect(resolveMemberFilter(MEMBER_EVERYONE, known, true)).toBe(MEMBER_EVERYONE)
  })
})
