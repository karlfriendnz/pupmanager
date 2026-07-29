// GENERATED — do not edit here.
//
// Copied from the shared review-core package (resolvers.ts, v0.1.1) by
// scripts/sync-review-core.mjs. fm-events reads the same source, so a fix made
// HERE is a fix that only PupManager gets. Change it in review-core:
//   https://github.com/karlfriendnz/review-core
// then re-run `node scripts/sync-review-core.mjs` and commit the result.

/**
 * Component resolvers — the ONE part of the capture that must know a framework.
 *
 * Vue tags DOM nodes with `__vueParentComponent`, React with `__reactFiber$…`, and
 * neither exists in a production build. Both live here rather than in each app so
 * the knowledge is written down once; an app imports the one it needs and passes it
 * to `configureReviewTarget({ resolveComponents })`.
 *
 * Absence is expected and is never an error — a comment with no component name is
 * still a comment with a field, a section and a selector.
 */
import type { ComponentResolver } from './types'

const MAX_CLIMB = 14

const EMPTY = { name: null, file: null, chain: [] as string[] }

/**
 * Vue 3. `__vueParentComponent` is set in dev builds; `type.__file` is the source
 * path the vite plugin stamps on.
 */
export const vueComponentResolver: ComponentResolver = (el: Element) => {
  try {
    let instance: any = null
    let cur: any = el
    for (let i = 0; cur && i < MAX_CLIMB; i++) {
      if (cur.__vueParentComponent) { instance = cur.__vueParentComponent; break }
      cur = cur.parentElement
    }
    if (!instance) return EMPTY

    const chain: string[] = []
    let name: string | null = null
    let file: string | null = null
    let node: any = instance
    for (let i = 0; node && i < 12; i++) {
      const type = node.type || {}
      const rawFile: string | undefined = type.__file
      const short = rawFile
        ? rawFile.replace(/^.*?\/(components|pages|layouts|app|src)\//, '$1/')
        : undefined
      const label: string | null = type.__name || type.name
        || (short ? short.split('/').pop()!.replace(/\.vue$/, '') : null)
      if (label && chain[chain.length - 1] !== label) chain.push(label)
      if (!name && label) { name = label; file = short ?? null }
      // First component with a real FILE wins as the actionable one — an anonymous
      // inline wrapper is not somewhere anyone can go and edit.
      if (!file && short) file = short
      node = node.parent
    }
    return { name, file, chain: chain.slice(0, 6) }
  } catch {
    return EMPTY
  }
}

/**
 * React 18/19. Walks the fiber `return` chain for named components.
 *
 * Names only: React 19 dropped `_debugSource`, so there is no file path to report.
 * The selector, label and section are what actually address the element anyway —
 * the chain is for orientation.
 */
export const reactComponentResolver: ComponentResolver = (el: Element) => {
  try {
    let fiber: any = null
    let cur: Element | null = el
    for (let i = 0; cur && i < MAX_CLIMB; i++) {
      const key = Object.keys(cur).find(k => k.startsWith('__reactFiber$'))
      if (key) { fiber = (cur as any)[key]; break }
      cur = cur.parentElement
    }
    if (!fiber) return EMPTY

    const chain: string[] = []
    let node: any = fiber
    for (let i = 0; node && i < 30; i++) {
      const type = node.type
      const label: string | null = typeof type === 'function' || (type && typeof type === 'object')
        ? (type.displayName || type.name || null)
        : null
      // Skip host elements and React's own wrappers — nobody edits a Provider.
      if (label && !/^(_|Fragment|Suspense|Provider|Consumer|StrictMode)/.test(label)
        && chain[chain.length - 1] !== label) {
        chain.push(label)
      }
      node = node.return
    }
    return { name: chain[0] ?? null, file: null, chain: chain.slice(0, 6) }
  } catch {
    return EMPTY
  }
}
