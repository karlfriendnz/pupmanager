import { SectionHeader } from '@/components/shared/flat-list'
import { BrowseShell } from '@/components/shared/browse-shell'
import { LibraryTree } from './library-tree'
import { AddCategory } from './library-index-actions'
import type { TreeType } from './library-shape'

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
    <BrowseShell
      navLabel="Library"
      navHref="/library"
      nav={
        <>
          {/* SectionHeader, not SectionLabel — the right column's heading sits
              in a 36px row so its action can share the line, and a plain label
              here would ride higher than it. Both columns start level. */}
          <SectionHeader>Library</SectionHeader>
          <LibraryTree tree={tree} />
          {/* Same shape as the shop's rail: the list, then the one thing you
              can add to it, full width underneath. */}
          <AddCategory fullWidth />
        </>
      }
    >
      {children}
    </BrowseShell>
  )
}
