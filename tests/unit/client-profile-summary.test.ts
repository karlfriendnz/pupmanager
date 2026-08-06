import { describe, it, expect } from 'vitest'
import {
  agoLine, countLine, dogsLine, dogsTileLine, nextSessionLine, notesLine, owingLine,
} from '@/lib/client-profile-summary'

// The second line on every tile of a client's profile.
//
// Two rules, and both are the point of the feature: the line must be TRUE, and
// a zero must read as words. A grid of "0"s on a client added a minute ago is
// bleaker than the bare menu it replaced, and a wrong count on someone's record
// is worse than no count at all.
//
// `now` is pinned in every case — these lines are relative to it, and a test
// that races the clock is a test that fails at midnight.
const NOW = new Date('2026-08-06T09:00:00')

const money = (minor: number, currency: string) =>
  `${currency === 'nzd' ? '$' : currency === 'gbp' ? '£' : ''}${(minor / 100).toFixed(2)}`

describe('nextSessionLine', () => {
  it('names the next session, weekday + time inside a week', () => {
    const line = nextSessionLine([{ scheduledAt: '2026-08-08T10:00:00' }], NOW)
    expect(line).toMatch(/^Sat 10:00/)
  })

  it('switches to a date beyond a week out, so "Thu" cannot mean next month', () => {
    const line = nextSessionLine([{ scheduledAt: '2026-09-15T10:00:00' }], NOW)
    expect(line).toMatch(/^15 Sept?, /)
  })

  it('picks the SOONEST upcoming one, not the first in the array', () => {
    const line = nextSessionLine([
      { scheduledAt: '2026-08-20T10:00:00' },
      { scheduledAt: '2026-08-07T14:30:00' },
    ], NOW)
    expect(line).toMatch(/^Fri 2:30/)
  })

  it('falls back to the LAST session — a history with nothing booked is not the same as no history', () => {
    expect(nextSessionLine([{ scheduledAt: '2026-07-01T10:00:00' }], NOW))
      .toBe('Last 1 Jul 2026')
  })

  it('says words, not a zero, when there is nothing at all', () => {
    expect(nextSessionLine([], NOW)).toBe('No sessions yet')
  })
})

describe('agoLine', () => {
  it.each([
    ['2026-08-06T08:00:00', 'Today'],
    ['2026-08-05T20:00:00', 'Yesterday'],
    ['2026-08-03T09:00:00', '3 days ago'],
    ['2026-07-30T09:00:00', 'Last week'],
    ['2026-07-10T09:00:00', '3 weeks ago'],
  ])('%s reads as %s', (iso, expected) => {
    expect(agoLine(iso, NOW, 'Not spoken yet')).toBe(expected)
  })

  it('gives a plain date once "N weeks ago" stops meaning anything', () => {
    expect(agoLine('2026-01-04T09:00:00', NOW, 'Not spoken yet')).toBe('4 Jan 2026')
  })

  it('uses the worded empty state for nothing at all', () => {
    expect(agoLine(null, NOW, 'Not spoken yet')).toBe('Not spoken yet')
  })

  it('does not print "Invalid Date" for a broken value', () => {
    expect(agoLine('not-a-date', NOW, 'Not spoken yet')).toBe('Not spoken yet')
  })
})

describe('countLine', () => {
  it('counts, and gets the singular right', () => {
    expect(countLine(1, 'entry', 'entries', 'No practice logged')).toBe('1 entry')
    expect(countLine(4, 'entry', 'entries', 'No practice logged')).toBe('4 entries')
  })

  it('words the zero', () => {
    expect(countLine(0, 'entry', 'entries', 'No practice logged')).toBe('No practice logged')
  })

  it('says "30+" at the cap, because a capped fetch is a floor and not a total', () => {
    expect(countLine(30, 'entry', 'entries', 'No practice logged', 30)).toBe('30+ entries')
    expect(countLine(29, 'entry', 'entries', 'No practice logged', 30)).toBe('29 entries')
  })
})

describe('dogsLine (the hero subtitle)', () => {
  it('names one dog with its breed', () => {
    expect(dogsLine([{ name: 'Sammy', breed: 'Cockapoo' }])).toBe('Sammy · Cockapoo')
  })

  it('drops the breed when there is not one', () => {
    expect(dogsLine([{ name: 'Sammy', breed: null }])).toBe('Sammy')
  })

  it('names every dog, and says how many', () => {
    expect(dogsLine([{ name: 'Sammy', breed: 'Cockapoo' }, { name: 'Bella', breed: null }]))
      .toBe('Sammy, Bella · 2 dogs')
  })

  it('words the empty case', () => {
    expect(dogsLine([])).toBe('No dog added')
  })
})

describe('dogsTileLine', () => {
  // Deliberately NOT the dog's name: the hero directly above the tile already
  // carries it, and a name repeated 40px below itself is the "nothing says the
  // same thing twice" rule broken in the most visible place on the screen.
  it('gives the age of a single dog', () => {
    expect(dogsTileLine([{ dob: '2023-02-06', deceasedAt: null }], NOW)).toBe('3 years old')
  })

  it('counts months while a puppy is under two', () => {
    expect(dogsTileLine([{ dob: '2026-05-06', deceasedAt: null }], NOW)).toBe('3 months old')
    expect(dogsTileLine([{ dob: '2026-07-06', deceasedAt: null }], NOW)).toBe('1 month old')
  })

  it('counts them instead when there are several', () => {
    expect(dogsTileLine([
      { dob: '2023-02-06', deceasedAt: null },
      { dob: null, deceasedAt: null },
    ], NOW)).toBe('2 on file')
  })

  it('says so, gently, for a dog that has died', () => {
    expect(dogsTileLine([{ dob: '2015-01-01', deceasedAt: '2026-01-01' }], NOW)).toBe('Passed away')
  })

  it('words both empty cases', () => {
    expect(dogsTileLine([], NOW)).toBe('No dog added')
    expect(dogsTileLine([{ dob: null, deceasedAt: null }], NOW)).toBe('No age on file')
  })
})

describe('notesLine', () => {
  it('shows a taste of the note', () => {
    expect(notesLine('Reactive on lead near bikes.')).toBe('Reactive on lead near bikes.')
  })

  it('collapses the whitespace a rich-text body leaves behind', () => {
    expect(notesLine('  Reactive\n\n  on lead ')).toBe('Reactive on lead')
  })

  it('truncates rather than wrapping a paragraph into a tile', () => {
    const line = notesLine('x'.repeat(200))
    expect(line.length).toBeLessThanOrEqual(60)
    expect(line.endsWith('…')).toBe(true)
  })

  it('words the empty case for null, empty and whitespace alike', () => {
    expect(notesLine(null)).toBe('No notes yet')
    expect(notesLine('')).toBe('No notes yet')
    expect(notesLine('   \n ')).toBe('No notes yet')
  })
})

describe('owingLine', () => {
  it('says what is owed', () => {
    expect(owingLine({ owingCents: 8000, currency: 'nzd', count: 1 }, money)).toBe('$80.00 owing')
  })

  it('words the zero rather than printing "$0.00 owing"', () => {
    expect(owingLine({ owingCents: 0, currency: null, count: 0 }, money)).toBe('Nothing owing')
  })

  it('treats a fully-paid set as nothing owing even if rows exist', () => {
    expect(owingLine({ owingCents: 0, currency: 'nzd', count: 2 }, money)).toBe('Nothing owing')
  })

  // The one tile where a wrong number is money: adding two currencies into one
  // total would be a lie, so it falls back to a count.
  it('counts instead of summing when the invoices disagree on currency', () => {
    expect(owingLine({ owingCents: 12000, currency: null, count: 3 }, money)).toBe('3 unpaid')
  })
})
