import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Five tabs do not fit on a 394px line.
 *
 * The package builder's — Details · Included · Appearance · Who it's for ·
 * Automation — ran off the right edge with "Automation" simply not on screen
 * (Karl: "bit messy"). And a strip that scrolls has a quieter second failure:
 * opening on a tab that starts off-screen shows a row that doesn't contain the
 * thing you're looking at, with nothing to say it moves.
 *
 * REWRITTEN 2026-08-07. There were two tab designs — a grey pill track on ten
 * detail screens, a flat underline on To do / Messages / Alerts. Karl asked for
 * one; he chose the underline. OfferingTabs now renders PageTabs, so the
 * behaviour these tests protect moved there with it.
 *
 * Two assertions are deliberately GONE rather than ported, because the design
 * they describe is gone: the even-split-until-five rule and the "skip the strip
 * that is display:none" guard both existed to manage TWO strips (a phone one
 * and a wide one). There is one strip now, it always scrolls, and neither
 * failure can occur.
 */
const src = (rel: string) => readFileSync(resolve(__dirname, '../../src/', rel), 'utf8')

const pageTabs = src('components/shared/page-tabs.tsx')
const offeringTabs = src('components/shared/offering-tabs.tsx')
const editScreen = src('components/shared/edit-screen.tsx')

describe('one tab design, not two', () => {
  it('OfferingTabs renders PageTabs rather than its own markup', () => {
    // The whole point: ten detail screens and three list screens draw the same
    // strip. If this ever grows its own <button> again the app has two designs
    // back, which is exactly what Karl reported.
    expect(offeringTabs).toContain('<PageTabs')
    expect(offeringTabs).not.toMatch(/<button/)
  })

  it('keeps its generic tab ids, so a screen cannot pass a tab that does not exist', () => {
    expect(offeringTabs).toMatch(/export function OfferingTabs<T extends string>/)
  })

  it('has no pill track left anywhere', () => {
    // The grey rounded track with white pills. Its colour was also the one
    // strip in the app not using the trainer's accent.
    expect(offeringTabs).not.toContain('bg-slate-100 rounded-2xl')
    expect(pageTabs).not.toContain('bg-slate-100 rounded-2xl')
  })
})

describe('the strip scrolls rather than squeezing', () => {
  it('scrolls sideways instead of wrapping to a second row', () => {
    expect(pageTabs).toContain('overflow-x-auto')
  })

  it('hides the rail — a bar here would be the second one on screen', () => {
    // Karl's standing rule.
    expect(pageTabs).toContain('no-scrollbar')
  })

  it('does not let a long label wrap mid-tab', () => {
    expect(pageTabs).toContain('whitespace-nowrap')
  })
})

describe('the active tab is brought into view', () => {
  it('scrolls the strip, never the page', () => {
    // scrollIntoView would walk up and move the document too. This moves the
    // one box.
    expect(pageTabs).toContain('el.scrollTo({ left:')
    expect(pageTabs).not.toContain('scrollIntoView')
  })

  it('does nothing when there is nothing to scroll', () => {
    expect(pageTabs).toMatch(/if \(!el \|\| el\.scrollWidth <= el\.clientWidth\) return/)
  })

  it('re-runs when the tab changes', () => {
    expect(pageTabs).toMatch(/\}, \[active\]\)/)
  })
})

describe('the tabs announce themselves correctly', () => {
  it('panel-switching tabs are a real tablist', () => {
    // These switch a panel in place, so role=tab + aria-selected — which is
    // also what the specs reach for.
    expect(pageTabs).toContain('role="tablist"')
    expect(pageTabs).toContain('role="tab"')
    expect(pageTabs).toContain('aria-selected={isActive}')
  })

  it('link tabs stay links, and never claim role=tab', () => {
    // A tab with an href is navigation. role="tab" would override the implicit
    // link role — breaking screen readers AND every getByRole('link') aimed at
    // one. The link branch marks itself with aria-current instead.
    expect(pageTabs).toContain("aria-current={isActive ? 'page' : undefined}")
    // The <nav> wrapper, not a tablist, when the tabs are links. ([\s\S] not
    // [^>]: the ref's generic type contains a '>' of its own.)
    expect(pageTabs).toMatch(/<nav[\s\S]*?aria-label=\{label\}/)
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
