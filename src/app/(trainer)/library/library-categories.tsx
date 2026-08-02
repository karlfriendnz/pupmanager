'use client'

import { Layers } from 'lucide-react'

import { FlatTile, FlatTileGrid, SectionHeader } from '@/components/shared/flat-list'
import { OfferingViewToggle, useOfferingView } from '@/components/shared/offering-card'

// The Library index's categories, with the same list/grid switch every other
// list in the app has.
//
// A client component because the switch is state and the Lucide icon has to be
// imported on this side of the boundary — handing `icon={Layers}` from a Server
// Component throws "Only plain objects can be passed to Client Components".
// The page passes plain data; the icon stays here.

export interface CategoryTile {
  id: string
  name: string
  themes: number
  items: number
}

export function LibraryCategories({ categories }: { categories: CategoryTile[] }) {
  const [view, setView] = useOfferingView('library')

  const tiles = categories.map(c => (
    <FlatTile
      key={c.id}
      icon={Layers}
      label={c.name}
      sub={`${c.themes} theme${c.themes === 1 ? '' : 's'} · ${c.items} item${c.items === 1 ? '' : 's'}`}
      href={`/library/type/${c.id}`}
    />
  ))

  return (
    <>
      {/* Heading and view switch on ONE line — the same 36px row the tree's
          heading uses, so the two columns start level.

          No "New category" here: it lives on the rail, under the list it adds
          to, exactly as the shop's does. Two of the same button on one screen
          is a question about which one to press. */}
      <SectionHeader action={<OfferingViewToggle value={view} onChange={setView} />}>
        Categories
      </SectionHeader>

      {/* Both views keep the CARD. FlatTile is only ever a cell — the border,
          the white and the dividers come from its container — so dropping it
          into a bare grid leaves the rows floating on the page background,
          which is what "untidy" looked like. */}
      {view === 'grid' ? (
        <FlatTileGrid count={categories.length}>{tiles}</FlatTileGrid>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
          {tiles}
        </div>
      )}
    </>
  )
}
