import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Five tabs do not fit on a 394px line.
 *
 * The package builder's — Details · Included · Appearance · Who it's for ·
 * Automation — were an underlined rail that ran off the right edge, with
 * "Automation" simply not on screen (Karl: "bit messy"). An even split does not
 * save them either: five columns of 70px break "Who it's for" across three
 * lines. Past four, the strip scrolls.
 *
 * And a strip that scrolls has a second failure that is quieter than the first:
 * opening on a tab that starts off-screen shows a row that does not contain the
 * thing you are looking at, with nothing to say it moves.
 */
const src = (rel: string) => readFileSync(resolve(__dirname, '../../src/', rel), 'utf8')

const tabs = src('components/shared/offering-tabs.tsx')
const editScreen = src('components/shared/edit-screen.tsx')

describe('the strip scrolls rather than squeezing', () => {
  it('decides on the COUNT, not on a flag the caller has to know to pass', () => {
    expect(tabs).toMatch(/const scrolls = tabs\.length > 4/)
  })

  it('swaps the even split for fixed-width tabs once it scrolls', () => {
    expect(tabs).toMatch(/scrolls \? 'shrink-0 basis-\[5\.5rem\]' : 'flex-1 min-w-\[4\.5rem\]'/)
  })

  it('can scroll even in the even-split mode, because the box may be narrow', () => {
    // The split is only even if the box is as wide as the screen. On the
    // offering detail screen this strip shares a row with a tab's own actions,
    // which squeezed it to 239px and clipped "Homework" and "Automation"
    // INSIDE their columns — a four-tab strip, so the count rule never fired.
    // A minimum width per tab plus somewhere to scroll survives any container.
    expect(tabs).toMatch(/sm:hidden flex gap-1 p-1 bg-slate-100 rounded-2xl overflow-x-auto no-scrollbar/)
  })

  it('hides the rail — a bar here would be the second one on screen', () => {
    // Karl's standing rule. Both strips, not just the phone one.
    expect(tabs.match(/no-scrollbar/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('the active tab is brought into view', () => {
  it('scrolls the strip, never the page', () => {
    // scrollIntoView would walk up and move the document too. This moves the
    // one box.
    expect(tabs).toContain('box.scrollTo({ left:')
    expect(tabs).not.toContain('scrollIntoView')
  })

  it('skips the strip that is display:none at this width', () => {
    // One of the two is always hidden; it has no geometry, and scrolling it
    // would be scrolling the row nobody can see.
    expect(tabs).toMatch(/if \(!box \|\| box\.clientWidth === 0\) continue/)
  })

  it('does nothing when there is nothing to scroll', () => {
    expect(tabs).toMatch(/if \(box\.scrollWidth <= box\.clientWidth\) continue/)
  })

  it('re-runs when the tab changes', () => {
    expect(tabs).toMatch(/\}, \[value\]\)/)
  })
})

describe('the tabs announce themselves as tabs', () => {
  it('is a tablist of tabs, not a set of current links', () => {
    // aria-current="page" means "this is the page you are on" in a set of
    // LINKS. These switch a panel in place — and role=tab is what the specs
    // already reach for on every other strip in the app.
    expect(tabs).toContain('role="tablist"')
    // Two strips, one for each width. (The count skips the comment above them
    // by requiring the JSX indentation.)
    expect(tabs.match(/\n\s+role="tab"\n/g)?.length).toBe(2)
    expect(tabs.match(/aria-selected=\{active\}/g)?.length).toBe(2)
    // As an attribute — the word still appears in the comment explaining why.
    expect(tabs).not.toMatch(/aria-current=\{/)
  })
})

describe('a pinned bar needs a floor to sit on', () => {
  it('holds a screenful even when the tab is nearly empty', () => {
    // Sticky settles at the end of the content when there is no more of it, so
    // a one-sentence tab left the bar floating two thirds of the way down.
    expect(editScreen).toMatch(/min-h-\[calc\(100dvh-5\.5rem\)\]/)
    expect(editScreen).toMatch(/md:min-h-\[calc\(100dvh-7\.5rem\)\]/)
  })

  it('gives the content the slack so the bar keeps the bottom', () => {
    expect(editScreen).toMatch(/<div className="flex flex-1 flex-col gap-6">\{children\}<\/div>/)
  })
})
