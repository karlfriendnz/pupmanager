// GENERATED — do not edit here.
//
// Copied from the shared review-core package (page-key.ts, v0.1.1) by
// scripts/sync-review-core.mjs. fm-events reads the same source, so a fix made
// HERE is a fix that only PupManager gets. Change it in review-core:
//   https://github.com/karlfriendnz/review-core
// then re-run `node scripts/sync-review-core.mjs` and commit the result.

/**
 * The key a comment is stored against.
 *
 * A pin left on one client's screen is a note about THAT SCREEN, not about that
 * client — so record ids come out of the path. Query strings go too, except the
 * ones that select which VIEW you are looking at: a tab is part of a screen's
 * identity, and folding two tabs into one key piles their comments together.
 */
export interface PageKeyOptions {
  /**
   * Query params that select a view and therefore belong in the key. Order is
   * preserved, so the key is stable however the browser ordered the URL.
   * Default: ['tab'].
   */
  viewParams?: string[]
}

const ID_PATTERNS: [RegExp, string][] = [
  // cuid / cuid2 — 'c' then 20+ alphanumerics.
  [/\/c[a-z0-9]{20,}(?=\/|$)/gi, '/:id'],
  // uuid v4 and friends.
  [/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id'],
  // Bare numeric ids.
  [/\/\d+(?=\/|$)/g, '/:id'],
]

export function pageKeyFor(href: string, opts: PageKeyOptions = {}): string {
  const viewParams = opts.viewParams ?? ['tab']
  try {
    // The base is a throwaway — it only exists so a relative href parses.
    const u = new URL(href, 'http://key.local')
    let path = u.pathname
    for (const [re, to] of ID_PATTERNS) path = path.replace(re, to)
    path = path.replace(/\/+$/, '') || '/'

    const kept = viewParams
      .map(p => [p, u.searchParams.get(p)] as const)
      .filter((pair): pair is readonly [string, string] => pair[1] != null && pair[1] !== '')
      .map(([p, v]) => `${p}=${v}`)

    return kept.length ? `${path}?${kept.join('&')}` : path
  } catch {
    return href
  }
}
