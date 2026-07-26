import { describe, it, expect } from 'vitest'
import { isAssignmentFinished, isPackagePast } from '@/app/(trainer)/packages/past-packages'

// "Past" for a 1:1 package is derived, not stored — see the module for why.
// These lock the rule down so a future change to the query can't quietly move
// a package a trainer is still selling into the Past tab.

const NOW = Date.UTC(2026, 6, 26, 9, 0) // 26 Jul 2026
const YESTERDAY = NOW - 24 * 60 * 60 * 1000
const NEXT_WEEK = NOW + 7 * 24 * 60 * 60 * 1000

describe('isAssignmentFinished', () => {
  it('is finished once its last session has been', () => {
    expect(isAssignmentFinished({ extendIndefinitely: false, lastSessionAt: YESTERDAY }, NOW)).toBe(true)
  })

  it('is not finished while a session is still to come', () => {
    expect(isAssignmentFinished({ extendIndefinitely: false, lastSessionAt: NEXT_WEEK }, NOW)).toBe(false)
  })

  it('is not finished when no sessions have been created yet', () => {
    // Assigned but not yet scheduled — the work hasn't started, let alone ended.
    expect(isAssignmentFinished({ extendIndefinitely: false, lastSessionAt: null }, NOW)).toBe(false)
  })

  it('is never finished when it extends indefinitely', () => {
    // Ongoing assignments top themselves up, so a past last-session just means
    // the schedule hasn't regenerated yet.
    expect(isAssignmentFinished({ extendIndefinitely: true, lastSessionAt: YESTERDAY }, NOW)).toBe(false)
  })
})

describe('isPackagePast', () => {
  it('keeps a never-assigned package current', () => {
    // A brand new package is for sale, not finished. This is the case that
    // would be most damaging to get wrong.
    expect(isPackagePast([], NOW)).toBe(false)
  })

  it('is past when every assignment has finished', () => {
    expect(isPackagePast([
      { extendIndefinitely: false, lastSessionAt: YESTERDAY },
      { extendIndefinitely: false, lastSessionAt: YESTERDAY - 1000 },
    ], NOW)).toBe(true)
  })

  it('stays current while one client still has a session to come', () => {
    expect(isPackagePast([
      { extendIndefinitely: false, lastSessionAt: YESTERDAY },
      { extendIndefinitely: false, lastSessionAt: NEXT_WEEK },
    ], NOW)).toBe(false)
  })

  it('stays current while an ongoing assignment is running', () => {
    expect(isPackagePast([
      { extendIndefinitely: false, lastSessionAt: YESTERDAY },
      { extendIndefinitely: true, lastSessionAt: YESTERDAY },
    ], NOW)).toBe(false)
  })

  it('stays current when an assignment has no sessions yet', () => {
    expect(isPackagePast([
      { extendIndefinitely: false, lastSessionAt: YESTERDAY },
      { extendIndefinitely: false, lastSessionAt: null },
    ], NOW)).toBe(false)
  })

  it('treats a session happening right now as still to come', () => {
    expect(isPackagePast([{ extendIndefinitely: false, lastSessionAt: NOW }], NOW)).toBe(false)
  })
})
