import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Tags moved out of the top-level menu and into Settings → Tags
 * (Karl, 2026-08-06: "please move tags to settings area").
 *
 * Three things have to hold for a move like this to be a move rather than a
 * disappearance, and each has already gone wrong somewhere in this codebase:
 *
 *   1. the old url still lands somewhere — it was a menu item, so it is in
 *      bookmarks and histories, and a 404 is the worst version of moving a
 *      screen that still exists;
 *   2. nothing still points at the place it left; and
 *   3. the tab is gated on the same question its API asks, so a viewer is never
 *      shown a list they'd be 403'd on the moment they changed something.
 */

const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }))
vi.mock('next/navigation', () => ({ redirect }))

const src = (rel: string) => readFileSync(resolve(__dirname, '../../src/', rel), 'utf8')

describe('the old tags url still gets you there', () => {
  // Braces, not a bare arrow: a beforeEach that RETURNS something callable is
  // taken as the teardown and run after the test — which would call the mock
  // with no arguments and throw REDIRECT:undefined out of an unrelated case.
  beforeEach(() => { redirect.mockClear() })

  it('/offerings/tags redirects to the settings tab', async () => {
    const mod = await import('@/app/(trainer)/offerings/tags/page')
    expect(() => mod.default()).toThrow(/REDIRECT/)
    expect(redirect).toHaveBeenCalledWith('/settings?tab=tags')
  })

  // The per-tag screen is a detail screen about one tag's contents, not a
  // settings surface — it stays where it is, and the list still links to it.
  it('the per-tag screen is left where it was', () => {
    expect(src('app/(trainer)/settings/tags-panel.tsx')).toContain('/offerings/tags/${t.id}')
  })
})

describe('nothing still points at the menu row that went', () => {
  it('the sidebar no longer lists a Tags row', () => {
    const shell = src('components/shared/app-shell.tsx')
    expect(shell).not.toMatch(/^\s*\{\s*href:\s*'\/offerings\/tags'/m)
  })

  // NAV_LABEL_CATALOG mirrors the real menu and tests/unit/nav-labels.test.ts
  // fails on a stale row — asserted here too, because the failure that test
  // gives ("lists nothing that isn't in the menu") doesn't say why the row went.
  it('the rename catalogue dropped it with the menu row', async () => {
    const { NAV_LABEL_CATALOG } = await import('@/lib/nav-labels')
    expect(NAV_LABEL_CATALOG.some(e => e.key === '/offerings/tags')).toBe(false)
  })

  it('the Offerings hub links straight at the tab, not through the redirect', () => {
    expect(src('app/(trainer)/offerings/page.tsx')).toContain("href: '/settings?tab=tags'")
  })

  it('the per-tag screen goes back to the tab', () => {
    expect(src('app/(trainer)/offerings/tags/[tagId]/page.tsx')).toContain("href: '/settings?tab=tags'")
  })

  // The menu row appeared only once a tag existed, which needed a relation count
  // on the query the shell runs on EVERY navigation. No row, no count.
  it('the layout stopped counting tags on every page load', () => {
    const layout = src('app/(trainer)/layout.tsx')
    expect(layout).not.toContain('_count: { select: { tags: true } }')
    expect(layout).not.toContain("hiddenNavHrefs.push('/offerings/tags')")
  })
})

describe('the tab is offered to exactly who may change a tag', () => {
  it('takes either catalogue permission, like the API', async () => {
    const { canSeeTags } = await import('@/app/(trainer)/settings/tags-tab')
    expect(canSeeTags('OWNER', {})).toBe(true)
    expect(canSeeTags('STAFF', { 'packages.manage': true, 'products.manage': false })).toBe(true)
    expect(canSeeTags('STAFF', { 'packages.manage': false, 'products.manage': true })).toBe(true)
    expect(canSeeTags('STAFF', { 'packages.manage': false, 'products.manage': false })).toBe(false)
  })

  // The gate is only worth anything if the page actually asks it.
  it('the settings page renders the tab behind that gate', () => {
    const page = src('app/(trainer)/settings/page.tsx')
    expect(page).toContain('canSeeTags(ctx.role, ctx.permissions) ? <TagsTab')
  })

  // Same question the three routes this screen writes to ask. If one of them
  // ever loosens or tightens, this is the line that says the tab has to follow.
  //
  // /api/tags/assign is deliberately NOT in the list: it puts a tag ON a thing,
  // so it is gated per-target (packages.manage for an offering, products.manage
  // for a product) and it is called from those editors, never from here.
  it('matches the guard on the tag routes this screen writes to', () => {
    for (const route of ['route.ts', '[tagId]/route.ts', 'reorder/route.ts']) {
      expect(src(`app/api/tags/${route}`), route)
        .toContain("guardAnyPermission('packages.manage', 'products.manage')")
    }
  })
})

describe('it is the same tags UI, in a new place', () => {
  const panel = () => src('app/(trainer)/settings/tags-panel.tsx')

  it('writes to the same four routes it always did', () => {
    const p = panel()
    expect(p).toContain("fetch('/api/tags'")
    expect(p).toContain('fetch(`/api/tags/${id}`')
    expect(p).toContain("fetch('/api/tags/reorder'")
  })

  // Every settings tab says which one a review pin was made on, or every tab of
  // this screen piles onto one indistinguishable page key (AGENTS.md).
  it('names its tab for the review widget', () => {
    expect(panel()).toContain('data-review-scope="Tab: Tags"')
  })

  // The settings content column pads itself; a second p-8 inside it double-pads.
  it('leaves the padding to the settings column', () => {
    expect(panel()).not.toContain('w-full p-4 md:p-8')
  })

  it('has intro copy, like every other tab', async () => {
    const { TAB_INTRO } = await import('@/app/(trainer)/settings/tab-intro')
    expect(TAB_INTRO.tags?.title).toBe('Tags')
    expect(TAB_INTRO.tags?.steps.length).toBeGreaterThan(1)
  })
})
