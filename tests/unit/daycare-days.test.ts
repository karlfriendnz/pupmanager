import { describe, it, expect } from 'vitest'
import { openDaysFromSlots, ISO_DAY_LABEL } from '@/lib/daycare-days'

// Which weekdays a daycare is open is a fact about its own day-parts — the
// slots already record the weekday they run on. The board used to take its
// columns from TrainerProfile.scheduleDays instead, a setting SHARED with the
// scheduler, so narrowing the calendar hid a day the daycare was open.
//
// Slots count Sunday as 0 and Saturday as 6; the board (and the scheduler it
// used to borrow from) counts ISO, Monday 1 … Sunday 7. Every case below is
// really about that translation not slipping.

describe('openDaysFromSlots', () => {
  it('translates slot weekdays to ISO, sorted and deduped', () => {
    // Tue, Fri, Tue again, Sun — a part per day, two parts on Tuesday.
    expect(openDaysFromSlots([{ day: 2 }, { day: 5 }, { day: 2 }, { day: 0 }])).toEqual([2, 5, 7])
  })

  it('puts Sunday at the END of the week, not the start', () => {
    // The whole reason for the translation: as stored, Sunday is 0 and would
    // sort in front of Monday, drawing the week backwards.
    expect(openDaysFromSlots([{ day: 0 }, { day: 1 }])).toEqual([1, 7])
  })

  it('reads "Dukes runs Tue–Fri" off the parts', () => {
    expect(openDaysFromSlots([{ day: 2 }, { day: 3 }, { day: 4 }, { day: 5 }])).toEqual([2, 3, 4, 5])
    expect(openDaysFromSlots([{ day: 2 }, { day: 3 }, { day: 4 }, { day: 5 }]).map(d => ISO_DAY_LABEL[d]))
      .toEqual(['Tue', 'Wed', 'Thu', 'Fri'])
  })

  it('shows the whole week when there are no parts at all', () => {
    // A daycare with nothing set up yet still reads as a week, rather than the
    // board collapsing to no columns.
    expect(openDaysFromSlots([])).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('ignores a weekday that is out of range rather than inventing a column', () => {
    // day is a plain Int in the database with no check constraint, so a bad
    // value is reachable. An 8th column has nothing to render into it.
    expect(openDaysFromSlots([{ day: 9 }, { day: -1 }, { day: 1.5 }, { day: 3 }])).toEqual([3])
  })

  it('treats every day out of range as no days at all, not as an empty board', () => {
    expect(openDaysFromSlots([{ day: 12 }])).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
