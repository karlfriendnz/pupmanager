import { describe, it, expect } from 'vitest'
import {
  whereForView,
  viewFromTab,
  currentWhere,
  ARCHIVED_STATUS,
  VIEW_LABEL,
} from '@/lib/client-activity'

// Where a client is up to is DERIVED from what they've booked. It used to be
// read off ClientProfile.status, which meant somebody had to keep it true — a
// nightly recalculation that then fought whatever a staff member set by hand.
//
// These assert the SHAPE of the filters, because the shape is where the bug was.
// The counts they produce are checked against the customer's real data in
// tests/e2e — see the acceptance numbers quoted below.
const NOW = new Date('2026-07-29T00:00:00.000Z')

describe('in class now', () => {
  // ── THE TRAP ──────────────────────────────────────────────────────────────
  // A five-week course that began on 18 July is STILL RUNNING and its clients
  // are still in class. Asking whether the run starts in the future returned 4
  // clients out of 684; asking whether it still has a session to come returns
  // 60, which matches the trainer's own spreadsheet.
  it('asks whether a session is still to come, never when the course started', () => {
    const w = JSON.stringify(currentWhere(NOW))
    expect(w).toContain('sessions')
    expect(w).toContain('scheduledAt')
    expect(w).not.toContain('startDate')
  })

  it('only counts a class seat they actually hold', () => {
    expect(JSON.stringify(currentWhere(NOW))).toContain('"status":"ENROLLED"')
  })

  // Every kind of offering, not just group classes. Events, casual classes and
  // daycare are all ClassRuns; a 1:1 or package session hangs off the client
  // directly. Without that second arm a 1:1-only trainer sits at 0 for ever.
  it('counts 1:1 and package sessions, not only class places', () => {
    const w = JSON.stringify(currentWhere(NOW))
    expect(w).toContain('trainingSessions')
    expect(w).toContain('classEnrollments')
  })

  it('leaves out anyone archived', () => {
    expect(JSON.stringify(whereForView('current', NOW))).toContain(ARCHIVED_STATUS)
  })
})

describe('past client', () => {
  // "Booked before, nothing to come" is the NEGATION of in-class-now, taken
  // from the same function — so the two can never drift apart.
  it('is defined as having booked, and not being current', () => {
    const w = whereForView('past', NOW) as { AND?: unknown[] }
    expect(w.AND).toHaveLength(2)
    expect(JSON.stringify(w.AND![1])).toBe(JSON.stringify({ NOT: currentWhere(NOW) }))
  })

  // Both halves are an OR. Spread into one object they'd overwrite each other
  // and "past" would quietly mean whichever landed last — hence the AND.
  it('nests the two ORs instead of letting one clobber the other', () => {
    const w = whereForView('past', NOW) as Record<string, unknown>
    expect(w.OR).toBeUndefined()
  })

  it('counts a package as having booked, not just a class', () => {
    expect(JSON.stringify(whereForView('past', NOW))).toContain('clientPackages')
  })
})

describe('never booked', () => {
  it('is neither a class nor a package, ever', () => {
    const w = whereForView('never', NOW) as Record<string, { none?: object }>
    expect(w.classEnrollments?.none).toEqual({})
    expect(w.clientPackages?.none).toEqual({})
  })
})

describe('archived', () => {
  // The one thing status is still for: a human pressed "hide this person".
  // That's a decision, not something derivable.
  it('is the only view that reads status', () => {
    expect(whereForView('archived', NOW)).toEqual({ status: ARCHIVED_STATUS })
  })

  it('ignores activity entirely', () => {
    const w = JSON.stringify(whereForView('archived', NOW))
    expect(w).not.toContain('classEnrollments')
    expect(w).not.toContain('scheduledAt')
  })

  // Every activity view has to exclude them, or an archived person shows up in
  // two places at once.
  it('is excluded from all three activity views', () => {
    for (const v of ['current', 'past', 'never'] as const) {
      expect(JSON.stringify(whereForView(v, NOW))).toContain('"not":"INACTIVE"')
    }
  })
})

describe('the old links still work', () => {
  // These are in bookmarks, in emails and in the trainer's muscle memory.
  it('?tab=new lands on the people it always did', () => {
    expect(viewFromTab('new')).toBe('never')
  })

  it('?tab=inactive lands on the people it always did', () => {
    expect(viewFromTab('inactive')).toBe('archived')
  })

  it('the new names work too', () => {
    expect(viewFromTab('past')).toBe('past')
    expect(viewFromTab('never')).toBe('never')
    expect(viewFromTab('archived')).toBe('archived')
  })

  it('anything unrecognised falls back to the default view', () => {
    expect(viewFromTab(undefined)).toBe('current')
    expect(viewFromTab('active')).toBe('current')
    expect(viewFromTab('nonsense')).toBe('current')
  })
})

describe('what the tabs are called', () => {
  // "Active / Inactive" is the wrong frame for a course business: clients finish
  // a five-week course BY DESIGN. Calling the other 90% "Inactive" says they
  // lapsed, when they're the repeat-and-referral pool.
  it('never calls a client inactive', () => {
    const labels = Object.values(VIEW_LABEL).join(' ').toLowerCase()
    expect(labels).not.toContain('inactive')
    expect(labels).not.toContain('active')
  })

  it('names them in the trainer’s own terms', () => {
    expect(VIEW_LABEL.current).toBe('Current')
    expect(VIEW_LABEL.past).toBe('Past')
    expect(VIEW_LABEL.never).toBe('Contacts')
  })

  // Four tabs share a row: on a 390px screen that's a quarter each, and
  // "Never booked" wrapped onto two lines there.
  it('keeps every label to one word', () => {
    for (const label of Object.values(VIEW_LABEL)) {
      expect(label.split(' ')).toHaveLength(1)
    }
  })
})

// The clients page is a SERVER component. OfferingTabs takes a Lucide icon per
// tab, and an icon is a function — passing one across that boundary throws
// "Only plain objects can be passed to Client Components", which is a blank
// screen, not a warning. The icons are chosen inside the client wrapper instead.
import { readFileSync } from 'node:fs'

describe('the tab strip crosses the server/client boundary safely', () => {
  const page = readFileSync('src/app/(trainer)/clients/page.tsx', 'utf8')
  const wrapper = readFileSync('src/app/(trainer)/clients/client-view-tabs.tsx', 'utf8')

  it('sends the tabs plain data — no functions of any kind', () => {
    const i = page.indexOf('tabs={TABS.map(')
    expect(i).toBeGreaterThan(-1)
    const payload = page.slice(i, i + 400)
    // An icon is a function, and a function cannot cross this boundary: React
    // rejects the whole payload and the page renders nothing at all.
    expect(payload).not.toContain('icon:')
  })

  it('renders on the client side of the line', () => {
    expect(wrapper).toContain("'use client'")
  })

  // A server component can't hand over an onChange either — these tabs navigate.
  it('navigates by href rather than a callback', () => {
    expect(page).toContain('href: tabHref(v)')
    expect(page).not.toContain('onChange')
  })
})

describe('the order of the header controls', () => {
  const list = readFileSync('src/app/(trainer)/clients/clients-list.tsx', 'utf8')

  // Tabs first — which list you're on — then search within it.
  it('puts the tabs above the search row', () => {
    const tabs = list.indexOf('<ClientViewTabs')
    const search = list.indexOf('Search name, email or dog')
    expect(tabs).toBeGreaterThan(-1)
    expect(search).toBeGreaterThan(tabs)
  })

  // The phone had its own Select because the toolbar was md-only. It isn't any
  // more, so that was the same button twice, one under the other.
  it('has exactly one Select control', () => {
    expect(list.match(/setSelectModeOn\(true\)/g) ?? []).toHaveLength(1)
  })
})

// The search row was desktop-only. A trainer scrolling hundreds of clients on a
// phone needs to filter where they're standing, and Select is how bulk email
// starts — so it now shows at every size. The COLUMN picker doesn't come with
// it: the phone renders cards, not a table, so it would control nothing.
describe('the clients search row on a phone', () => {
  const list = readFileSync('src/app/(trainer)/clients/clients-list.tsx', 'utf8')

  it('is no longer hidden below md', () => {
    expect(list).not.toContain('hidden md:flex items-center gap-2 mb-6')
    expect(list).toContain('<div className="flex items-center gap-2 mb-6">')
  })

  it('keeps the column picker to sizes that have a table', () => {
    expect(list).toContain('<div className="relative hidden md:block">')
  })

  it('labels Select at every size rather than leaving a bare icon', () => {
    expect(list).not.toContain('<span className="hidden sm:inline">{selectMode')
  })

  // One flat block split by hairlines — the house pattern, same as the
  // reschedule banner. Not a floating pill strip, and not a row of chips.
  it('wears the house flat-block shape', () => {
    const wrapper = readFileSync('src/app/(trainer)/clients/client-view-tabs.tsx', 'utf8')
    // No count beside a tab: it's a fact about a list you aren't looking at.
    expect(wrapper).not.toContain('t.badge')
    expect(wrapper).toContain('rounded-xl border border-slate-200 bg-white')
    expect(wrapper).toContain('[&>*+*]:border-l')
    // Even split, so the longest label can't set everyone else's width.
    expect(wrapper).toContain('flex-1 min-w-0')
  })

  // It borrows the shape, not the component: bending OfferingTabs into it took
  // three flags only this caller would ever set.
  it('leaves the shared offering strip alone', () => {
    const shared = readFileSync('src/components/shared/offering-tabs.tsx', 'utf8')
    expect(shared).not.toContain('stackedAlways')
    expect(shared).not.toContain('fullWidth')
  })
})
