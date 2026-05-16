import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/lib/prisma', () => ({ prisma: {} }))

import {
  computeStreak,
  longestStreak,
  evaluateBadges,
  type DaySummary,
} from '../../src/lib/trainer-streak'

// Helper: day summaries, most-recent-first (as computeStreak expects).
const D = (date: string, isTrainingDay: boolean, notesDone: boolean): DaySummary => ({
  date,
  isTrainingDay,
  notesDone,
})

describe('computeStreak (training-day based)', () => {
  it('counts consecutive notes-done training days', () => {
    expect(
      computeStreak([
        D('2026-05-16', true, true),
        D('2026-05-14', true, true),
        D('2026-05-12', true, true),
      ]),
    ).toBe(3)
  })

  it('skips non-training days — they neither extend nor break', () => {
    expect(
      computeStreak([
        D('2026-05-16', true, true),
        D('2026-05-15', false, false), // day off — skipped
        D('2026-05-14', true, true),
        D('2026-05-13', false, false), // day off — skipped
        D('2026-05-12', true, true),
      ]),
    ).toBe(3)
  })

  it('breaks at the first training day with notes not done', () => {
    expect(
      computeStreak([
        D('2026-05-16', true, true),
        D('2026-05-14', true, false), // missed notes — streak stops here
        D('2026-05-12', true, true),
      ]),
    ).toBe(1)
  })

  it('0 when the most recent training day missed notes', () => {
    expect(computeStreak([D('2026-05-16', true, false), D('2026-05-14', true, true)])).toBe(0)
  })

  it('0 with no training days at all', () => {
    expect(computeStreak([D('2026-05-16', false, false)])).toBe(0)
  })
})

describe('longestStreak', () => {
  it('finds the best historical run, ignoring days off', () => {
    expect(
      longestStreak([
        D('2026-05-20', true, true), // run of 2 (newest)
        D('2026-05-18', true, true),
        D('2026-05-16', true, false), // break
        D('2026-05-15', false, false), // off
        D('2026-05-14', true, true), // run of 3 (older)
        D('2026-05-12', true, true),
        D('2026-05-10', true, true),
      ]),
    ).toBe(3)
  })
  it('0 when nothing is done', () => {
    expect(longestStreak([D('2026-05-16', true, false)])).toBe(0)
  })
})

describe('evaluateBadges (streak now in training days)', () => {
  it('streak badges trigger off training-day longest streak', () => {
    const got = evaluateBadges({ clients: 12, sessionsDelivered: 60, currentStreak: 4, longestStreak: 4 })
    expect(got).toContain('first_client')
    expect(got).toContain('clients_10')
    expect(got).toContain('sessions_50')
    expect(got).toContain('streak_4w')
    expect(got).not.toContain('streak_12w')
  })
  it('nothing for a brand-new trainer', () => {
    expect(evaluateBadges({ clients: 0, sessionsDelivered: 0, currentStreak: 0, longestStreak: 0 })).toEqual([])
  })
})
