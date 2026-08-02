'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Layers } from 'lucide-react'

import { useIsDesktop } from '@/components/shared/browse-shell'
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
// List view is a TABLE, the same one the shop's products use — a grip column,
// the name, and the counts under headings that say what the numbers are. The
// two screens are the same idea (things, in shelves, in an order you choose),
// so they read the same way. No column picker: three columns is not a choice
// worth offering.
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

/**
 * The frame the table's header and rows share.
 *
 * Two templates, picked by a CONTAINER query: in a column too narrow for them
 * the counts drop out rather than landing on top of the name. Container, not
 * window — this sits beside a 17rem rail, so a wide window is not a wide table.
 */
const ROW = 'grid items-center gap-x-3 px-3 [grid-template-columns:1.5rem_1.75rem_minmax(0,1fr)] @lg:[grid-template-columns:1.5rem_1.75rem_minmax(0,1fr)_5rem_5rem]'
const OPTIONAL_CELL = 'hidden @lg:block'

export function LibraryCategories({ categories }: { categories: CategoryTile[] }) {
  const [view, setView] = useOfferingView('library')
  const isDesktop = useIsDesktop()
  const router = useRouter()

  // A phone always gets the tiles. The list/grid switch is desktop-only, so a
  // trainer who left the switch on "list" at their desk would otherwise open
  // the app on their phone to a table too narrow for its own columns, with no
  // control on screen to get out of it.
  const asTable = isDesktop && view === 'list'
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
        // So the tree in the rail moves with the list rather than waiting for
        // the next navigation.
        router.refresh()
      } catch {
        revert()
      }
    })()
  }

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

      {/* A named region, so "the categories" is one addressable thing rather
          than whichever view happens to be rendering them. */}
      <section aria-label="Categories">
        <SortableOfferingList ids={items.map(c => c.id)} onReorder={reorder}>
          {!asTable ? (
            <FlatTileGrid count={items.length}>
              {items.map(c => (
                <SortableOfferingCard key={c.id} id={c.id}>
                  {handle => (
                    <FlatTile
                      icon={Layers}
                      label={c.name}
                      sub={`${c.themes} theme${c.themes === 1 ? '' : 's'} · ${c.items} item${c.items === 1 ? '' : 's'}`}
                      href={`/library/type/${c.id}`}
                      dragHandle={handle}
                    />
                  )}
                </SortableOfferingCard>
              ))}
            </FlatTileGrid>
          ) : (
            // One bordered box with hairlines between the rows — a table only
            // reads as a table when its columns run the whole way down it.
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <CategoryTableHead />
              <div className="[&>*+*]:border-t [&>*+*]:border-slate-100">
                {items.map(c => (
                  <SortableOfferingCard key={c.id} id={c.id}>
                    {handle => <CategoryRow category={c} dragHandle={handle} />}
                  </SortableOfferingCard>
                ))}
              </div>
            </div>
          )}
        </SortableOfferingList>
      </section>
    </>
  )
}

/** The column names, on the same grid the rows use. */
function CategoryTableHead() {
  const cell = 'text-[11px] font-semibold uppercase tracking-wide text-slate-400'
  return (
    <div className={`${ROW} h-9 border-b border-slate-200 bg-slate-50/70`}>
      <span aria-hidden />
      <span aria-hidden />
      <span className={cell}>Category</span>
      <span className={`${OPTIONAL_CELL} ${cell} text-right`}>Themes</span>
      <span className={`${OPTIONAL_CELL} ${cell} text-right`}>Items</span>
    </div>
  )
}

function CategoryRow({ category, dragHandle }: { category: CategoryTile; dragHandle: ReactNode }) {
  return (
    <div className={`${ROW} h-14 transition-colors hover:bg-slate-50`}>
      {dragHandle}
      <Layers className="h-4 w-4 text-slate-400" strokeWidth={1.75} />

      {/* The link CENTRES ITS OWN TEXT, and the truncation moves to a span
          inside it. globals.css gives every <a> a 44px minimum touch target, so
          this cell is a 44px box in a 56px row while the counts beside it are
          20px line boxes. All three are centred as grid items — but the text
          inside a 44px block sits at the TOP of it, which put the name a dozen
          pixels above the numbers it is meant to line up with. Centring inside
          the link is what actually lines the TEXT up.

          Truncation has to go on the inner span: `text-overflow` does nothing
          on a flex container, whose text is an anonymous flex item. */}
      <Link
        href={`/library/type/${category.id}`}
        className="flex min-w-0 items-center text-sm font-medium text-slate-900 hover:underline"
      >
        <span className="truncate">{category.name}</span>
      </Link>

      {/* Just the figures. "2 themes · 1 item" is a phrase for a tile, where
          there is no heading to say which number is which; down a column the
          heading already said it. */}
      <span className={`${OPTIONAL_CELL} text-right text-sm tabular-nums text-slate-500`}>{category.themes}</span>
      <span className={`${OPTIONAL_CELL} text-right text-sm tabular-nums text-slate-500`}>{category.items}</span>
    </div>
  )
}
