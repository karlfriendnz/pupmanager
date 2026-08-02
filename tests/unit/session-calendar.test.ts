import { describe, it, expect } from 'vitest'

import {
  isSelectableSession,
  groupSessionsByDay,
  monthOf,
  monthLabel,
  monthGrid,
  monthsWithSessions,
  defaultOpenDay,
  picksOnDay,
  selectedInOrder,
  allSelectableIds,
  type CalendarSession,
} from '../../src/lib/session-calendar'

// Pacific/Auckland is UTC+12 (NZST) in August — the offset that made the old
// bug visible. A 07:30 NZ class is 19:30 UTC the day BEFORE, so every day
// label here would be off by one if the calendar read the viewer's zone.
const NZ = 'Pacific/Auckland'

function s(id: string, at: string, extra: Partial<CalendarSession> = {}): CalendarSession {
  return { id, at, spacesLeft: null, booked: false, ...extra }
}

describe('isSelectableSession — what is actually on offer', () => {
  it('offers a session with room', () => {
    expect(isSelectableSession(s('a', '2026-08-02T19:30:00.000Z', { spacesLeft: 3 }))).toBe(true)
  })

  it('offers an uncapped session', () => {
    expect(isSelectableSession(s('a', '2026-08-02T19:30:00.000Z', { spacesLeft: null }))).toBe(true)
  })

  it('never offers a full session — it would be refused at checkout', () => {
    expect(isSelectableSession(s('a', '2026-08-02T19:30:00.000Z', { spacesLeft: 0 }))).toBe(false)
  })

  it('never offers one the client already holds', () => {
    expect(isSelectableSession(s('a', '2026-08-02T19:30:00.000Z', { spacesLeft: 5, booked: true }))).toBe(false)
  })
})

describe('groupSessionsByDay — trainer-local days, not the viewer’s', () => {
  it('buckets a 19:30 UTC instant onto the NEXT NZ day', () => {
    const days = groupSessionsByDay([s('a', '2026-08-02T19:30:00.000Z')], NZ)
    expect(days.map(d => d.dateStr)).toEqual(['2026-08-03'])
  })

  it('gives the same instant a different day in London and Auckland', () => {
    const one = [s('a', '2026-08-02T19:30:00.000Z')]
    expect(groupSessionsByDay(one, NZ)[0].dateStr).toBe('2026-08-03')
    expect(groupSessionsByDay(one, 'Europe/London')[0].dateStr).toBe('2026-08-02')
  })

  it('puts several sessions on one day, earliest first, whatever order they arrive in', () => {
    const days = groupSessionsByDay(
      [
        s('late', '2026-08-03T07:30:00.000Z'),
        s('early', '2026-08-02T19:30:00.000Z'),
        s('mid', '2026-08-03T02:00:00.000Z'),
      ],
      NZ,
    )
    expect(days).toHaveLength(1)
    expect(days[0].dateStr).toBe('2026-08-03')
    expect(days[0].sessions.map(x => x.id)).toEqual(['early', 'mid', 'late'])
  })

  it('returns the days themselves in calendar order', () => {
    const days = groupSessionsByDay(
      [s('c', '2026-09-01T07:30:00.000Z'), s('a', '2026-08-03T07:30:00.000Z'), s('b', '2026-08-12T07:30:00.000Z')],
      NZ,
    )
    expect(days.map(d => d.dateStr)).toEqual(['2026-08-03', '2026-08-12', '2026-09-01'])
  })

  it('counts only the sessions still on offer', () => {
    const days = groupSessionsByDay(
      [
        s('open', '2026-08-03T07:30:00.000Z', { spacesLeft: 2 }),
        s('full', '2026-08-03T09:30:00.000Z', { spacesLeft: 0 }),
        s('mine', '2026-08-03T11:30:00.000Z', { booked: true }),
      ],
      NZ,
    )
    expect(days[0].sessions).toHaveLength(3)
    expect(days[0].selectableCount).toBe(1)
  })

  it('survives a daylight-saving change — NZDT starts 27 Sep 2026', () => {
    // 26 Sep 12:00Z is NZST (+12) → 27 Sep 00:00 local.
    // 27 Sep 12:00Z is NZDT (+13) → 28 Sep 01:00 local.
    const days = groupSessionsByDay(
      [s('a', '2026-09-26T12:00:00.000Z'), s('b', '2026-09-27T12:00:00.000Z')],
      NZ,
    )
    expect(days.map(d => d.dateStr)).toEqual(['2026-09-27', '2026-09-28'])
  })

  it('has no days at all for a run with no sessions', () => {
    expect(groupSessionsByDay([], NZ)).toEqual([])
  })
})

describe('month arithmetic', () => {
  it('reads the month off a date', () => {
    expect(monthOf('2026-08-03')).toBe('2026-08')
  })

  it('labels a month for a human', () => {
    expect(monthLabel('2026-08')).toBe('August 2026')
    expect(monthLabel('2026-12')).toBe('December 2026')
  })
})

describe('monthGrid — Monday-anchored weeks', () => {
  it('starts every week on a Monday', () => {
    for (const week of monthGrid('2026-08')) {
      const [y, m, d] = week[0].split('-').map(Number)
      expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(1)
    }
  })

  it('gives every row seven days', () => {
    for (const week of monthGrid('2026-09')) expect(week).toHaveLength(7)
  })

  it('pads the front from the previous month and the back from the next', () => {
    // 1 Aug 2026 is a Saturday, so the first row runs 27 Jul – 2 Aug.
    const weeks = monthGrid('2026-08')
    expect(weeks[0][0]).toBe('2026-07-27')
    expect(weeks[0][5]).toBe('2026-08-01')
    expect(weeks[weeks.length - 1][6]).toBe('2026-09-06')
  })

  it('holds every day of the month exactly once', () => {
    const flat = monthGrid('2026-08').flat().filter(d => d.startsWith('2026-08'))
    expect(flat).toHaveLength(31)
    expect(new Set(flat).size).toBe(31)
  })

  it('handles a month that starts on a Monday without a leading blank week', () => {
    // 1 Jun 2026 is a Monday.
    expect(monthGrid('2026-06')[0][0]).toBe('2026-06-01')
  })

  it('handles February in a leap year', () => {
    const flat = monthGrid('2028-02').flat().filter(d => d.startsWith('2028-02'))
    expect(flat).toHaveLength(29)
  })

  it('is only as tall as the month needs', () => {
    // Feb 2027 starts on a Monday and has 28 days — exactly four rows.
    expect(monthGrid('2027-02')).toHaveLength(4)
  })
})

describe('monthsWithSessions — the months the arrows may reach', () => {
  const days = groupSessionsByDay(
    [
      s('a', '2026-08-03T07:30:00.000Z'),
      s('b', '2026-08-20T07:30:00.000Z'),
      s('c', '2026-10-01T07:30:00.000Z'),
    ],
    NZ,
  )

  it('lists each month once, in order', () => {
    expect(monthsWithSessions(days)).toEqual(['2026-08', '2026-10'])
  })

  it('leaves out a month the run skips, so no arrow lands on an empty grid', () => {
    expect(monthsWithSessions(days)).not.toContain('2026-09')
  })

  it('is empty for a run with no sessions', () => {
    expect(monthsWithSessions([])).toEqual([])
  })
})

describe('defaultOpenDay — where the picker lands', () => {
  it('opens on the first day that still has something to pick', () => {
    const days = groupSessionsByDay(
      [
        s('full', '2026-08-03T07:30:00.000Z', { spacesLeft: 0 }),
        s('open', '2026-08-12T07:30:00.000Z', { spacesLeft: 4 }),
      ],
      NZ,
    )
    expect(defaultOpenDay(days)).toBe('2026-08-12')
  })

  it('still opens somewhere when the whole run is full', () => {
    const days = groupSessionsByDay([s('full', '2026-08-03T07:30:00.000Z', { spacesLeft: 0 })], NZ)
    expect(defaultOpenDay(days)).toBe('2026-08-03')
  })

  it('is null when there is nothing at all', () => {
    expect(defaultOpenDay([])).toBeNull()
  })
})

describe('the selection', () => {
  const days = groupSessionsByDay(
    [
      s('aug3-am', '2026-08-02T19:30:00.000Z'),
      s('aug3-pm', '2026-08-03T00:30:00.000Z'),
      s('aug12', '2026-08-11T19:30:00.000Z'),
      s('sep1-full', '2026-08-31T19:30:00.000Z', { spacesLeft: 0 }),
      s('sep1-mine', '2026-08-31T21:30:00.000Z', { booked: true }),
      s('sep2', '2026-09-01T19:30:00.000Z'),
    ],
    NZ,
  )

  it('counts a day’s picks', () => {
    expect(picksOnDay(days[0], ['aug3-am', 'aug3-pm', 'aug12'])).toBe(2)
    expect(picksOnDay(days[0], [])).toBe(0)
  })

  it('lists picks in calendar order however they were tapped', () => {
    const picked = selectedInOrder(days, ['sep2', 'aug3-pm', 'aug3-am'])
    expect(picked.map(p => p.session.id)).toEqual(['aug3-am', 'aug3-pm', 'sep2'])
  })

  it('keeps each pick’s own day, so a pick made in August survives paging to September', () => {
    const picked = selectedInOrder(days, ['aug12', 'sep2'])
    expect(picked.map(p => p.dateStr)).toEqual(['2026-08-12', '2026-09-02'])
  })

  it('ignores an id that is not in the run', () => {
    expect(selectedInOrder(days, ['nope'])).toEqual([])
  })

  it('“Select all” means every session on offer — never a full or already-held one', () => {
    expect(allSelectableIds(days)).toEqual(['aug3-am', 'aug3-pm', 'aug12', 'sep2'])
  })

})
