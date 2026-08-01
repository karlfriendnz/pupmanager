import { SectionHeader } from '@/components/shared/flat-list'
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
 *   • < md — no rail at all. The whole width is the screen you opened, with
 *     Back in the header, and you move around by drilling in from the index
 *     grid — which is how every other phone screen in the app behaves.
 *
 * Which row of the tree is highlighted comes from the URL, so pages pass
 * nothing but the tree itself.
 */
export function LibraryShell({
  tree,
  children,
}: {
  tree: TreeType[]
  children: React.ReactNode
}) {
  return (
    // Full width, like the offering lists. The library is a two-column browser
    // — tree on the left, cards on the right — and capping it at 72rem squeezed
    // the cards into three columns on a screen with room for five.
    <div className="w-full p-4 md:p-8">
      <div className="md:grid md:grid-cols-[17rem_minmax(0,1fr)] md:items-start md:gap-8">
        <aside className="hidden self-start md:sticky md:top-4 md:block">
          {/* SectionHeader, not SectionLabel — the right column's heading sits
              in a 36px row so its action can share the line, and a plain label
              here would ride higher than it. Both columns start level. */}
          <SectionHeader>Library</SectionHeader>
          <LibraryTree tree={tree} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
