import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// On a phone the trainer's home is a launcher: a review line, one line about
// today, then six evergreen tiles. Client requests sat UNDER those tiles, below
// the fold — and a request nobody scrolls to is a request nobody answers. It's
// the only thing on that screen waiting on a reply, so it goes above them.
const mobile = readFileSync('src/app/(trainer)/dashboard/mobile-home.tsx', 'utf8')
const page = readFileSync('src/app/(trainer)/dashboard/page.tsx', 'utf8')

describe('the trainer’s phone home', () => {
  it('puts client requests above the tile grid', () => {
    const requests = mobile.indexOf('{requests && <div className="mb-3">{requests}</div>}')
    const grid = mobile.indexOf('grid grid-cols-2 overflow-hidden rounded-xl')
    expect(requests).toBeGreaterThan(-1)
    expect(grid).toBeGreaterThan(requests)
  })

  // …and below the two lines that say what's already happening today, so the
  // order reads: what needs you, what's on, what's asked, where to go.
  it('keeps it below the review line and today’s sessions', () => {
    const review = mobile.indexOf('thing{reviewTotal === 1')
    const today = mobile.indexOf('session${todayCount === 1')
    const requests = mobile.indexOf('{requests && <div className="mb-3">{requests}</div>}')
    expect(requests).toBeGreaterThan(review)
    expect(requests).toBeGreaterThan(today)
  })

  it('renders nothing at all when there are no requests', () => {
    // The slot is optional AND the panel returns null on an empty list, so an
    // empty state can't leave a gap above the tiles.
    expect(mobile).toContain('requests?: React.ReactNode')
    const panel = readFileSync('src/app/(trainer)/dashboard/pending-requests-panel.tsx', 'utf8')
    expect(panel).toContain('if (rows.length === 0) return null')
  })
})

describe('the desktop dashboard', () => {
  // Same split the booking-request panel already uses: the desktop copy stays
  // where it was, the phone gets its own inside the launcher home.
  it('keeps its own copy, hidden from phones', () => {
    const i = page.indexOf('<div className="hidden md:block">\n        <PendingRequestsPanel')
    expect(i).toBeGreaterThan(-1)
  })

  it('hands the phone copy to MobileHome', () => {
    const i = page.indexOf('requests={')
    expect(i).toBeGreaterThan(-1)
    expect(page.slice(i, i + 200)).toContain('<PendingRequestsPanel')
  })
})

// Accept and Decline do opposite things and both read as plain slate text —
// a yes and a no, side by side, in the same colour. This is semantic colour
// (yes / no), not decoration and not the trainer's accent, so it can sit beside
// their brand without competing with it.
describe('accept and decline', () => {
  const panel = readFileSync('src/app/(trainer)/dashboard/pending-requests-panel.tsx', 'utf8')

  it('tells the two apart by colour, not just by word order', () => {
    expect(panel).toContain('text-emerald-700')
    expect(panel).toContain('text-red-600')
  })

  it('carries the colour into the hover as well', () => {
    expect(panel).toContain('hover:bg-emerald-50')
    expect(panel).toContain('hover:bg-red-50')
  })

  // A green Accept opening a black confirm reads as a different decision.
  it('keeps the confirm dialog’s button the same green', () => {
    expect(panel).toContain('bg-emerald-600')
    expect(panel).not.toContain('bg-slate-900 px-4 text-sm font-medium text-white')
  })
})
