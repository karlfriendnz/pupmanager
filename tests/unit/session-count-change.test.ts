import { describe, it, expect } from 'vitest'
import { sessionCountChange, sessionCountChangeMessage } from '@/lib/session-count-change'

// The number a trainer acts on. Shrinking a class deletes real sessions — some
// with bookings on them — so this warning has to be right before it's reassuring.

describe('sessionCountChange', () => {
  it('counts what will be added', () => {
    expect(sessionCountChange({ existingSessions: 6, wanted: 10 })).toEqual({ kind: 'add', count: 4 })
  })

  it('counts what will be removed', () => {
    expect(sessionCountChange({ existingSessions: 6, wanted: 3 })).toEqual({ kind: 'remove', count: 3 })
  })

  it('says nothing when the number hasn’t really moved', () => {
    expect(sessionCountChange({ existingSessions: 6, wanted: 6 })).toEqual({ kind: 'none' })
  })

  // Ongoing is "no fixed end", NOT a shrink to zero. Reading it as zero would
  // warn that all six sessions are about to be deleted — the opposite of true.
  it('treats ongoing as no fixed end, not a shrink to zero', () => {
    expect(sessionCountChange({ existingSessions: 6, wanted: 0 })).toEqual({ kind: 'ongoing', existing: 6 })
  })

  // A 1:1 package has no series of its own — sessions appear when it's assigned.
  // Promising an add or a delete here would be a lie.
  it('stays quiet when nothing is scheduled yet', () => {
    expect(sessionCountChange({ existingSessions: 0, wanted: 8 })).toEqual({ kind: 'none' })
  })

  it('shrinking to a single session still counts properly', () => {
    expect(sessionCountChange({ existingSessions: 4, wanted: 1 })).toEqual({ kind: 'remove', count: 3 })
  })

  it('survives a half-typed number', () => {
    expect(sessionCountChange({ existingSessions: 6, wanted: NaN })).toEqual({ kind: 'none' })
    expect(sessionCountChange({ existingSessions: NaN, wanted: 4 })).toEqual({ kind: 'none' })
    expect(sessionCountChange({ existingSessions: 6, wanted: -2 })).toEqual({ kind: 'none' })
  })
})

describe('sessionCountChangeMessage', () => {
  it('names the number going in', () => {
    expect(sessionCountChangeMessage({ kind: 'add', count: 4 })).toBe(
      '4 sessions will be added, carrying on the same cadence.')
  })

  it('names the number going out, and says the choice is theirs', () => {
    expect(sessionCountChangeMessage({ kind: 'remove', count: 3 })).toBe(
      "3 sessions will be removed — you'll choose which ones when you save.")
  })

  // Deleting a session someone attended loses a record, so say so.
  it('warns harder when attendance has been marked', () => {
    expect(sessionCountChangeMessage({ kind: 'remove', count: 2 }, { hasAttendance: true }))
      .toMatch(/attendance marked/)
  })

  it('gets the singular right', () => {
    expect(sessionCountChangeMessage({ kind: 'remove', count: 1 })).toContain('1 session will')
    expect(sessionCountChangeMessage({ kind: 'add', count: 1 })).toContain('1 session will')
  })

  it('explains ongoing rather than alarming anyone', () => {
    const msg = sessionCountChangeMessage({ kind: 'ongoing', existing: 6 })!
    expect(msg).toContain('No fixed end')
    expect(msg).not.toMatch(/removed|deleted/)
  })

  it('is silent when there is nothing to say', () => {
    expect(sessionCountChangeMessage({ kind: 'none' })).toBeNull()
  })
})

describe('offerings that own no single schedule', () => {
  // The gap Karl hit: on a 1:1 package the box moved and nothing appeared, which
  // reads as "this change does nothing". It DOES do something — just not to
  // sessions that already exist.
  it('speaks for a 1:1 package', () => {
    expect(sessionCountChange({ existingSessions: 0, wanted: 8, isGroup: false }))
      .toEqual({ kind: 'assignments', count: 8 })
  })

  it('says whose sessions are safe on a 1:1', () => {
    const msg = sessionCountChangeMessage({ kind: 'assignments', count: 8 })!
    expect(msg).toContain('8 sessions')
    expect(msg).toMatch(/keep the sessions they have/)
  })

  // Several cohorts: we can't say which schedule is meant, and the save leaves
  // all of them alone (syncOfferingRun no-ops on a multi-run offering).
  it('speaks for a class with several cohorts', () => {
    expect(sessionCountChange({ existingSessions: 0, wanted: 6, runCount: 3 }))
      .toEqual({ kind: 'cohorts', runCount: 3, count: 6 })
  })

  it('says the scheduled sessions do not move', () => {
    expect(sessionCountChangeMessage({ kind: 'cohorts', runCount: 3, count: 6 })!)
      .toMatch(/don't move/)
  })

  // A single-cohort class is still the precise case — it must not fall into the
  // vaguer cohorts wording.
  it('keeps the exact numbers for a single cohort', () => {
    expect(sessionCountChange({ existingSessions: 6, wanted: 3, runCount: 1 }))
      .toEqual({ kind: 'remove', count: 3 })
  })

  it('stays quiet for an ongoing 1:1, which has no number to promise', () => {
    expect(sessionCountChange({ existingSessions: 0, wanted: 0, isGroup: false }))
      .toEqual({ kind: 'none' })
  })
})
