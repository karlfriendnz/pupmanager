import { describe, it, expect } from 'vitest'
import {
  LIVE_SESSION,
  isCancelled,
  isScheduleOverridden,
  hasPerOccurrenceEdits,
  spokenForInstants,
  cancelledLabel,
} from '@/lib/run-occurrences'

// One occurrence of a run, changed on its own. The property that matters is
// NEGATIVE and therefore easy to lose: nothing may resurrect a week the trainer
// killed, or revert one they moved.

const d = (iso: string) => new Date(iso)
const live = { scheduledAt: d('2026-08-04T18:00:00.000Z'), cancelledAt: null, originalScheduledAt: null, scheduleOverriddenAt: null }

describe('LIVE_SESSION', () => {
  it('is exactly "not cancelled" — nothing else', () => {
    // Anything more would silently narrow every count, price and roster that
    // spreads it.
    expect(LIVE_SESSION).toEqual({ cancelledAt: null })
  })
})

describe('the two per-occurrence states', () => {
  it('reads a cancelled one', () => {
    expect(isCancelled({ cancelledAt: null })).toBe(false)
    expect(isCancelled({ cancelledAt: d('2026-08-01T00:00:00.000Z') })).toBe(true)
  })

  it('reads a hand-set one', () => {
    expect(isScheduleOverridden({ scheduleOverriddenAt: null })).toBe(false)
    expect(isScheduleOverridden({ scheduleOverriddenAt: d('2026-08-01T00:00:00.000Z') })).toBe(true)
  })

  it('labels a cancellation with the trainer\'s reason when there is one', () => {
    expect(cancelledLabel({ cancelReason: null })).toBe('Cancelled')
    expect(cancelledLabel({ cancelReason: 'Labour Day' })).toBe('Cancelled — Labour Day')
  })
})

describe('hasPerOccurrenceEdits — the rebuild guard', () => {
  it('says no for an untouched run, so an ordinary reschedule still works', () => {
    expect(hasPerOccurrenceEdits([{ cancelledAt: null, scheduleOverriddenAt: null }])).toBe(false)
    expect(hasPerOccurrenceEdits([])).toBe(false)
  })

  it('says yes when ANY week was cancelled', () => {
    expect(hasPerOccurrenceEdits([
      { cancelledAt: null, scheduleOverriddenAt: null },
      { cancelledAt: d('2026-08-01T00:00:00.000Z'), scheduleOverriddenAt: null },
      { cancelledAt: null, scheduleOverriddenAt: null },
    ])).toBe(true)
  })

  it('says yes when ANY week was moved', () => {
    // A rebuild is deleteMany + createMany. Letting it run would undo the move
    // silently, on a save the trainer thought was about the session count.
    expect(hasPerOccurrenceEdits([
      { cancelledAt: null, scheduleOverriddenAt: null },
      { cancelledAt: null, scheduleOverriddenAt: d('2026-08-01T00:00:00.000Z') },
    ])).toBe(true)
  })
})

describe('spokenForInstants — what the nightly top-up must never plan again', () => {
  it('holds nothing for a run nobody has touched', () => {
    expect(spokenForInstants([live]).size).toBe(0)
  })

  it('holds a CANCELLED week\'s own time, so the date stays dead', () => {
    const at = d('2026-10-27T18:00:00.000Z')
    const out = spokenForInstants([{ scheduledAt: at, cancelledAt: d('2026-08-01T00:00:00.000Z'), originalScheduledAt: null }])
    expect(out.has(at.getTime())).toBe(true)
  })

  it('holds a MOVED week\'s ORIGINAL time, not its new one', () => {
    // This is the whole trick. The planner rebuilds from the slot's rule, so it
    // will produce the OLD instant — and the tail may have fallen behind it
    // when the trainer moved the week earlier. Without the original recorded,
    // the cron re-creates the week at the time they just moved it away from.
    const was = d('2026-10-27T18:00:00.000Z')
    const now = d('2026-10-27T19:00:00.000Z')
    const out = spokenForInstants([{ scheduledAt: now, cancelledAt: null, originalScheduledAt: was }])
    expect(out.has(was.getTime())).toBe(true)
    expect(out.has(now.getTime())).toBe(false)
  })

  it('holds BOTH when a moved week is later cancelled', () => {
    const was = d('2026-10-27T18:00:00.000Z')
    const now = d('2026-10-28T18:00:00.000Z')
    const out = spokenForInstants([
      { scheduledAt: now, cancelledAt: d('2026-08-01T00:00:00.000Z'), originalScheduledAt: was },
    ])
    expect(out.has(was.getTime())).toBe(true)
    expect(out.has(now.getTime())).toBe(true)
  })

  it('compares to the millisecond, since the planner rebuilds the same instants', () => {
    const at = d('2026-10-27T18:00:00.000Z')
    const out = spokenForInstants([{ scheduledAt: at, cancelledAt: d('2026-08-01T00:00:00.000Z'), originalScheduledAt: null }])
    expect(out.has(at.getTime() + 1)).toBe(false)
  })
})
