import { describe, it, expect } from 'vitest'
import {
  whereForView,
  viewFromTab,
  inClassNowWhere,
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
    const w = JSON.stringify(inClassNowWhere(NOW))
    expect(w).toContain('sessions')
    expect(w).toContain('scheduledAt')
    expect(w).not.toContain('startDate')
  })

  it('only counts a seat they actually hold', () => {
    const w = inClassNowWhere(NOW) as Record<string, { some?: { status?: string } }>
    expect(w.classEnrollments?.some?.status).toBe('ENROLLED')
  })

  it('leaves out anyone archived', () => {
    expect(JSON.stringify(whereForView('current', NOW))).toContain(ARCHIVED_STATUS)
  })
})

describe('past client', () => {
  // "Booked before, nothing to come" is the NEGATION of in-class-now, taken
  // from the same function — so the two can never drift apart.
  it('is defined as having booked, and not being current', () => {
    const w = whereForView('past', NOW) as Record<string, unknown>
    expect(w.OR).toBeDefined()
    expect(JSON.stringify(w.NOT)).toBe(JSON.stringify(inClassNowWhere(NOW)))
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
    expect(VIEW_LABEL.past).toBe('Past client')
    expect(VIEW_LABEL.never).toBe('Never booked')
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

  it('sends the tabs plain data, no icon functions', () => {
    const i = page.indexOf('<ClientViewTabs')
    expect(i).toBeGreaterThan(-1)
    expect(page.slice(i, i + 500)).not.toContain('icon:')
  })

  it('keeps the icons on the client side of the line', () => {
    expect(wrapper).toContain("'use client'")
    expect(wrapper).toContain('lucide-react')
    expect(wrapper).toContain('icon: ICON[t.id]')
  })

  // A server component can't hand over an onChange either — these tabs navigate.
  it('navigates by href rather than a callback', () => {
    expect(page).toContain('href: tabHref(v)')
    expect(page).not.toContain('onChange')
  })
})
