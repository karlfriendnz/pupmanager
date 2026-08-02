'use client'

import { useState, type ReactNode } from 'react'
import { Plus, Tag } from 'lucide-react'
import { closestCenter, useDroppable, useSensor, useSensors, KeyboardSensor, PointerSensor, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'

import { DndArea } from '@/components/shared/dnd-area'
import { SectionHeader } from '@/components/shared/flat-list'
import { SortableOfferingCard } from '@/components/shared/offering-card'

/**
 * The list of shelves: on the left of /products on a desktop, and the whole of
 * /products/categories on a phone.
 *
 * One component for both so the two can't drift — the same rows, the same drag
 * handles, the same "New category" button, wherever you are looking at them.
 */

export interface RailCategory {
  id: string
  name: string
  products: number
}

/** The Uncategorised shelf is not a row in the database — it is "everything with no shelf". */
export const NONE = '__none__'

export function CategoryRail({
  categories,
  total,
  uncategorised,
  selected,
  onSelect,
  onReorder,
  onCreated,
  onError,
  over,
  droppable,
  ownDragContext = false,
}: {
  categories: RailCategory[]
  /** How many products there are altogether — the "All products" count. */
  total: number
  uncategorised: number
  /** null = All products, NONE = Uncategorised, otherwise a category id. */
  selected: string | null
  onSelect: (id: string | null) => void
  onReorder: (ids: string[]) => void
  onCreated: (category: RailCategory) => void
  onError: (message: string) => void
  /** The id currently under the cursor, when the page is running its own drag. */
  over?: string | null
  /** Whether the thing being dragged can land on a shelf. */
  droppable?: boolean
  /**
   * Bring a drag context of its own. /products already has one wrapped around
   * both columns (so a product can be dropped onto a shelf); the standalone
   * categories page has nothing else to drag, so it needs its own.
   */
  ownDragContext?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const ids = categories.map(c => c.id)

  async function createCategory() {
    const name = newName.trim()
    if (!name) return
    const res = await fetch('/api/products/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { onError(typeof body.error === 'string' ? body.error : 'Could not add that category.'); return }
    onCreated({ id: body.id, name: body.name, products: 0 })
    setNewName('')
    setAdding(false)
  }

  const list = (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
      <ShelfRow label="All products" count={total} active={selected == null} onClick={() => onSelect(null)} />
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        {categories.map(c => (
          <SortableOfferingCard key={c.id} id={c.id}>
            {handle => (
              <ShelfRow
                label={c.name}
                count={c.products}
                active={selected === c.id}
                dropping={!!droppable && over === c.id}
                onClick={() => onSelect(c.id)}
                dragHandle={handle}
              />
            )}
          </SortableOfferingCard>
        ))}
      </SortableContext>
      {/* Always a target, even when it is empty — it is how a product comes
          back OFF a shelf. */}
      <UncategorisedRow
        count={uncategorised}
        active={selected === NONE}
        dropping={!!droppable && over === NONE}
        onClick={() => onSelect(NONE)}
      />
    </div>
  )

  return (
    <>
      <SectionHeader>Categories</SectionHeader>

      {ownDragContext ? <OwnDragContext ids={ids} onReorder={onReorder}>{list}</OwnDragContext> : list}

      {/* Adding a shelf belongs beside the shelves, not over with the things
          on them. */}
      {adding ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void createCategory()
              if (e.key === 'Escape') { setAdding(false); setNewName('') }
            }}
            placeholder="Category name (e.g. Treats)"
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-600)]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void createCategory()}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-[var(--pm-brand-600)] px-3 text-sm font-semibold text-white hover:bg-[var(--pm-brand-700)]"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setNewName('') }}
              className="inline-flex h-10 items-center justify-center rounded-xl px-3 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--pm-brand-600)] px-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--pm-brand-700)]"
        >
          <Plus className="h-4 w-4 flex-shrink-0" strokeWidth={2.25} /> New category
        </button>
      )}
    </>
  )
}

/** Reorder-only drag, for when the rail is the whole page. */
function OwnDragContext({ ids, onReorder, children }: { ids: string[]; onReorder: (ids: string[]) => void; children: ReactNode }) {
  const sensors = useSensors(
    // A small distance threshold so a tap-to-open on a phone isn't read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(ids, from, to))
  }
  return <DndArea sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>{children}</DndArea>
}

export function ShelfRow({
  label,
  count,
  active,
  dropping,
  onClick,
  dragHandle,
  rowRef,
}: {
  label: string
  count: number
  active: boolean
  dropping?: boolean
  onClick: () => void
  /** The rendered grip, handed over by SortableOfferingCard. */
  dragHandle?: ReactNode
  rowRef?: (el: HTMLElement | null) => void
}) {
  return (
    <div
      ref={rowRef}
      className={`flex items-center gap-1 transition-colors ${
        dropping
          ? 'bg-[color-mix(in_srgb,var(--pm-brand-600)_12%,white)] ring-2 ring-inset ring-[var(--pm-brand-600)]'
          : active
            ? 'bg-slate-50'
            : ''
      }`}
    >
      {dragHandle ? (
        <span className="pl-1.5">{dragHandle}</span>
      ) : (
        <span className="px-1.5 py-3" aria-hidden />
      )}
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-3 pr-3 text-left"
      >
        <Tag className={`h-4 w-4 flex-shrink-0 ${active ? 'text-[var(--pm-brand-600)]' : 'text-slate-400'}`} strokeWidth={1.75} />
        <span className={`min-w-0 flex-1 truncate text-sm ${active ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{label}</span>
        <span className="flex-shrink-0 text-xs text-slate-400">{count}</span>
      </button>
    </div>
  )
}

/**
 * Uncategorised takes drops but is not sortable — there is no row to reorder,
 * it is simply where the products with no category show up — so it registers
 * as a plain droppable rather than going through SortableOfferingCard.
 */
function UncategorisedRow({
  count,
  active,
  dropping,
  onClick,
}: {
  count: number
  active: boolean
  dropping: boolean
  onClick: () => void
}) {
  const { setNodeRef } = useDroppable({ id: NONE })
  return <ShelfRow rowRef={setNodeRef} label="Uncategorised" count={count} active={active} dropping={dropping} onClick={onClick} />
}
