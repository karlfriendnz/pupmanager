import { SectionLabel } from '@/components/shared/flat-list'
import { LibraryTree } from './library-tree'
import type { TreeType } from './library-data'

/**
 * The two-column Library frame: the tree on the left, the open thing on the right.
 *
 * Responsive behaviour lives HERE rather than inside the tree (AGENTS.md: let
 * the container be responsive, keep the component fixed):
 *
 *   • ≥ md — a sticky left column holding the tree, beside the detail pane.
 *     The column has no overflow of its own, so it grows with its content and
 *     only the PAGE scrolls. Never two scrollbars.
 *   • < md — no rail at all. The tree is the index page (/templates); a detail
 *     screen is the whole width with Back in the header, which is how every
 *     other phone screen in the app behaves.
 */
export function LibraryShell({
  tree,
  activeTypeId,
  activeThemeId,
  activeItemId,
  children,
}: {
  tree: TreeType[]
  activeTypeId?: string
  activeThemeId?: string
  activeItemId?: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-8">
      <div className="md:grid md:grid-cols-[17rem_minmax(0,1fr)] md:items-start md:gap-8">
        <aside className="hidden self-start md:sticky md:top-4 md:block">
          <SectionLabel>Library</SectionLabel>
          <LibraryTree
            tree={tree}
            activeTypeId={activeTypeId}
            activeThemeId={activeThemeId}
            activeItemId={activeItemId}
          />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
