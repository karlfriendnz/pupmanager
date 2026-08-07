import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The one shape every trainer listing page wears.
 *
 * Karl, on a page that still had the old one: "please fix this page up — full
 * width, add button on the top — you know the drill by now — this is global for
 * listing pages".
 *
 * It kept being re-derived per screen, and every screen drifted a different way:
 * a max-w-2xl ribbon here, a max-w-3xl/5xl/7xl staircase there, an add button
 * under the last card on one and inside a card two thirds down on another. This
 * file is the drill, written down, so the next screen built from a neighbour
 * copies a conforming neighbour.
 *
 * It reads SOURCE rather than rendering, deliberately: what is being protected
 * is a decision about layout that no assertion about output could state as
 * plainly, and the pages are server components with a database behind them.
 * Same approach as tests/unit/home-hero-fade.test.ts.
 */

const root = join(process.cwd(), 'src', 'app', '(trainer)')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** The canonical page container — the one `OfferingPage` itself renders. */
const FULL_WIDTH = 'w-full p-4 md:p-8'

/**
 * Every trainer screen that lists a collection, and where its outermost page
 * container lives.
 *
 * Not listed, on purpose, with the reason each time — because "why is this one
 * missing?" is the question a future reader will actually have:
 *
 *   • /dashboard, /reports        a dashboard of figures, not a list of things.
 *   • /schedule                   a calendar.
 *   • /settings, /forms, /website, /add-ons, /email-templates
 *                                 settings tabs (the last four are redirects
 *                                 INTO Settings).
 *   • /offerings                  a hub of five tiles pointing at the lists.
 *   • /offerings/new              a wizard.
 *   • /messages                   a two-pane inbox, already edge to edge.
 *   • /help                       a help centre; prose wants a reading measure.
 *   • /awards, /progress, /ai-tools
 *                                 not reachable from the nav.
 *   • anything under a [param]    a detail or edit screen, which is allowed —
 *                                 and wants — a centred column.
 */
const LISTING_PAGES: { name: string; file: string }[] = [
  { name: 'Achievements', file: 'achievements/page.tsx' },
  { name: 'Clients', file: 'clients/page.tsx' },
  { name: 'Waitlist', file: 'clients/waitlist/page.tsx' },
  { name: 'Enquiries', file: 'enquiries/page.tsx' },
  { name: 'Finances', file: 'finances/page.tsx' },
  { name: 'Lead magnets', file: 'lead-magnets/page.tsx' },
  { name: 'Marketing', file: 'marketing/page.tsx' },
  { name: 'Notifications', file: 'notifications/page.tsx' },
  { name: 'Route', file: 'schedule/route/page.tsx' },
  { name: 'Draft notes', file: 'sessions/draft-notes/page.tsx' },
  { name: 'To do', file: 'sessions/needs-notes/page.tsx' },
  // A settings TAB rather than a page since 2026-08-06, but still a list of
  // things with an add button, so it still wears the drill — and the settings
  // content column is full width, so the no-centred-ribbon rule still bites.
  { name: 'Tags', file: 'settings/tags-panel.tsx' },
  { name: 'Timesheets', file: 'timesheets/page.tsx' },
]

describe('every trainer listing page runs the full width', () => {
  it.each(LISTING_PAGES)('$name', ({ file }) => {
    const src = read(file)
    // No centred ribbon. The failure a trainer sees is a table truncating an
    // email address on a monitor with room for three of them.
    expect(src).not.toMatch(/max-w-\S+\s+mx-auto/)
    expect(src).not.toMatch(/mx-auto\s+[^"]*max-w-/)
  })

  // The five offering lists and Products/Library reach full width through a
  // shared container rather than a class of their own, so they are checked at
  // the source of it — one place, which is the point of having one.
  it('the shared containers are full width, so every list built on them is', () => {
    const offeringCard = readFileSync(
      join(process.cwd(), 'src', 'components', 'shared', 'offering-card.tsx'),
      'utf8',
    )
    // OfferingPage — 1:1 Sessions, Group Classes, Casual Classes, Events, Packages.
    expect(offeringCard).toContain(FULL_WIDTH)

    // BrowseShell — Library and Products, which put their rail beside the list
    // instead of a margin. Its inner column is a @container on purpose: it sits
    // next to 17rem of rail, so a wide window is not a wide table.
    const browseShell = readFileSync(
      join(process.cwd(), 'src', 'components', 'shared', 'browse-shell.tsx'),
      'utf8',
    )
    expect(browseShell).toContain(FULL_WIDTH)
    expect(browseShell).toContain('@container')
  })
})

describe('the add action is a button at the top, not a row under the last card', () => {
  // Each of these owns the ONLY way to make the thing it lists, so the button
  // has to be on the page — the corner create circle offers offerings, clients
  // and sales, and none of these is one of those (see lib/offering-create.ts).
  const OWNS_ITS_ONLY_ADD: { name: string; file: string; label: string }[] = [
    { name: 'Tags', file: 'settings/tags-panel.tsx', label: 'New tag' },
    { name: 'Achievements', file: 'achievements/achievements-manager.tsx', label: 'Add achievement' },
    { name: 'Timesheets', file: 'timesheets/timesheets-view.tsx', label: 'New timesheet' },
    { name: 'Marketing', file: 'marketing/marketing-view.tsx', label: 'New email' },
  ]

  it.each(OWNS_ITS_ONLY_ADD)('$name puts $label on the shared bar', ({ file, label }) => {
    const src = read(file)
    expect(src).toContain('OfferingListBar')
    expect(src).toContain(label)
  })

  it('every list can still be added to on a phone', () => {
    const offeringCard = readFileSync(
      join(process.cwd(), 'src', 'components', 'shared', 'offering-card.tsx'),
      'utf8',
    )
    // The rule this protects has survived three designs: a phone must never be
    // left with no way to add. It has been broken once, when the button hid
    // itself on phones and deferred to a floating create circle that had since
    // become home-only — stranding classes, drop-ins, events and packages.
    //
    // Karl asked for the circle per page on 2026-08-07 ("I only want plus
    // circle on mobile"), so the button now hides below md — but ONLY because
    // it renders its own circle there. Both halves have to be present: assert
    // them together, because either alone is the bug.
    expect(offeringCard).not.toContain('prePickedOfferingHref')
    expect(offeringCard).toContain('hidden md:inline-flex')
    expect(offeringCard).toContain('md:hidden fixed')
  })

  it('the create circle is the home screen\'s, and nowhere else', () => {
    const fab = readFileSync(
      join(process.cwd(), 'src', 'components', 'shared', 'floating-create-button.tsx'),
      'utf8',
    )
    // It floats over whatever is in the bottom-right corner of the page it is
    // on — a colour picker, in the report that prompted this.
    expect(fab).toContain("pathname !== '/dashboard'")
    // Phone only. The desktop control bar keeps its own "+", which starts
    // anything from anywhere and is not what anyone complained about.
    expect(fab).toContain('md:hidden fixed right-4')
  })
})

describe('the view toggle appears only where a grid is a second useful reading', () => {
  // A toggle with nothing behind it is worse than no toggle (the waitlist's
  // lesson). These screens pass no `view` to OfferingListBar on purpose:
  //
  //   • the waitlist   a queue dragged into the order it will be worked; a grid
  //                    wraps that order sideways across columns.
  //   • lead magnets   a row of title, status, filename, sign-ups and three
  //                    actions, which falls apart at a third of the width.
  //   • timesheets     a week, a status, an entry count and a total: figures,
  //                    which only line up down a column.
  //   • marketing      a subject and three counts, ditto.
  const NO_TOGGLE = [
    'clients/waitlist-view.tsx',
    'lead-magnets/lead-magnets-manager.tsx',
    'timesheets/timesheets-view.tsx',
    'marketing/marketing-view.tsx',
  ]

  it.each(NO_TOGGLE)('%s takes no view toggle', file => {
    expect(read(file)).not.toContain('useOfferingView')
  })

  // And where a grid IS worth having, it is remembered per page rather than
  // reset on every navigation.
  const REMEMBERS_ITS_VIEW: [string, string][] = [
    ['settings/tags-panel.tsx', "useOfferingView('tags')"],
    ['achievements/achievements-manager.tsx', "useOfferingView('achievements')"],
    ['library/library-categories.tsx', "useOfferingView('library')"],
  ]

  it.each(REMEMBERS_ITS_VIEW)('%s remembers its view', (file, call) => {
    expect(read(file)).toContain(call)
  })
})
