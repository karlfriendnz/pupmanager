import { describe, it, expect } from 'vitest'
import { createSlotAllocator } from '@/lib/demo-seed'

// The demo seed places every session for a single trainer, who can only run one
// at a time. createSlotAllocator is the guard that guarantees no two placed
// sessions overlap — these tests pin that invariant so the demo schedule (and
// the booking-conflict UI that reads it) never shows a double-booked trainer.

const MIN = 60_000
const HOUR = 60 * MIN

function pairwiseOverlaps(intervals: ReadonlyArray<{ start: number; end: number }>): number {
  const arr = [...intervals].sort((a, b) => a.start - b.start)
  let n = 0
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[j].start >= arr[i].end) break
      // half-open [start, end): touching (start === end) is NOT an overlap
      if (arr[i].start < arr[j].end && arr[j].start < arr[i].end) n++
    }
  }
  return n
}

describe('createSlotAllocator — non-overlapping trainer schedule', () => {
  it('shifts colliding sessions so no two intervals overlap', () => {
    const alloc = createSlotAllocator()
    const base = Date.UTC(2026, 6, 6, 9, 0, 0) // Mon 09:00
    // Ten sessions all *preferring* the same instant — classic collision.
    const placed = Array.from({ length: 10 }, () => alloc.place(base, 60))
    // Every returned start is distinct and slots are back-to-back or later.
    expect(new Set(placed).size).toBe(10)
    expect(pairwiseOverlaps(alloc.intervals)).toBe(0)
  })

  it('flows placements around a pre-reserved fixed slot (e.g. a group class)', () => {
    const alloc = createSlotAllocator()
    const noon = Date.UTC(2026, 6, 6, 12, 0, 0)
    alloc.reserve(noon, 60) // class occupies 12:00–13:00
    const placed = alloc.place(noon, 45) // wants 12:00 but must move
    expect(placed).toBeGreaterThanOrEqual(noon + 60 * MIN)
    expect(pairwiseOverlaps(alloc.intervals)).toBe(0)
  })

  it('keeps a placement at its preferred time when the slot is free', () => {
    const alloc = createSlotAllocator()
    const t = Date.UTC(2026, 6, 6, 14, 0, 0)
    expect(alloc.place(t, 60)).toBe(t)
    // A far-away, non-conflicting session also keeps its time.
    const later = t + 5 * HOUR
    expect(alloc.place(later, 60)).toBe(later)
  })

  it('handles a busy mix of durations across many preferred times with zero overlaps', () => {
    const alloc = createSlotAllocator()
    const durations = [30, 45, 60, 90]
    // Reserve a couple of fixed class slots first.
    alloc.reserve(Date.UTC(2026, 6, 7, 18, 0, 0), 60)
    alloc.reserve(Date.UTC(2026, 6, 9, 19, 0, 0), 60)
    // 200 sessions clustered on weekday afternoons — heavy contention.
    for (let i = 0; i < 200; i++) {
      const day = Date.UTC(2026, 6, 6 + (i % 14), 12 + (i % 6), (i % 2) * 30, 0)
      alloc.place(day, durations[i % durations.length])
    }
    expect(pairwiseOverlaps(alloc.intervals)).toBe(0)
  })

  it('snaps preferred times onto a 15-minute grid', () => {
    const alloc = createSlotAllocator()
    const t = Date.UTC(2026, 6, 6, 12, 7, 0) // 12:07 → snaps up to 12:15
    expect(alloc.place(t, 30)).toBe(Date.UTC(2026, 6, 6, 12, 15, 0))
  })
})
