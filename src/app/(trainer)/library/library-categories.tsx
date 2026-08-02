'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Layers } from 'lucide-react'

import { FlatTile, FlatTileGrid, SectionHeader } from '@/components/shared/flat-list'
import {
  OfferingViewToggle,
  SortableOfferingCard,
  SortableOfferingList,
  useOfferingView,
} from '@/components/shared/offering-card'

// The Library index's categories, with the same list/grid switch every other
// list in the app has — and, like the shop's shelves, dragged into whatever
// order the trainer wants.
//
// That order is not decoration: getLibraryTree reads `order`, so it sets the
// navigation tree, the drill-down on a phone, and every picker that offers a
// category. A trainer who runs puppy classes wants Puppy first, not whichever
// category they happened to type first.
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
  const router = useRouter()
  const [items, setItems] = useState(categories)
  const [error, setError] = useState<string | null>(null)

  // Adjust state when the server sends a different list — adding a category on
  // the rail refreshes this page, and state seeded once from props would ignore
  // the new one. Order-sensitive on purpose: after a drag the server comes back
  // agreeing with us, so this is a no-op; if the save didn't land, the server's
  // order wins, which is the honest answer.
  const signature = categories.map(c => c.id).join(',')
  const [synced, setSynced] = useState(signature)
  if (signature !== synced) {
    setSynced(signature)
    setItems(categories)
  }

  function reorder(ids: string[]) {
    const before = items
    setItems(ids.map(id => before.find(c => c.id === id)!).filter(Boolean))
    setSynced(ids.join(','))
    setError(null)
    void (async () => {
      const revert = () => {
        setItems(before)
        setSynced(before.map(c => c.id).join(','))
        setError('Could not save that order.')
      }
      try {
        const res = await fetch('/api/library/types/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        })
        if (!res.ok) { revert(); return }
        // So the tree in the rail moves with the grid rather than waiting for
        // the next navigation.
        router.refresh()
      } catch {
        revert()
      }
    })()
  }

  const tiles = items.map(c => (
    <SortableOfferingCard key={c.id} id={c.id}>
      {handle => (
        <>
          <FlatTile
            icon={Layers}
            label={c.name}
            sub={`${c.themes} theme${c.themes === 1 ? '' : 's'} · ${c.items} item${c.items === 1 ? '' : 's'}`}
            href={`/library/type/${c.id}`}
          />
          {/* Over the tile's top-right rather than inline: the tile is one tap
              target from edge to edge, and a grip sharing that row would either
              shrink the name or swallow the tap that opens the category. */}
          <span className="absolute right-1 top-1">{handle}</span>
        </>
      )}
    </SortableOfferingCard>
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

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {/* Both views keep the CARD. FlatTile is only ever a cell — the border,
          the white and the dividers come from its container — so dropping it
          into a bare grid leaves the rows floating on the page background,
          which is what "untidy" looked like. */}
      {/* A named region, so "the categories" is one addressable thing rather
          than whichever div the current view happens to render. */}
      <section aria-label="Categories">
        <SortableOfferingList ids={items.map(c => c.id)} onReorder={reorder}>
          {view === 'grid' ? (
            <FlatTileGrid count={items.length}>{tiles}</FlatTileGrid>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
              {tiles}
            </div>
          )}
        </SortableOfferingList>
      </section>
    </>
  )
}
