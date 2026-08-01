'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Columns3, FileDown, Plus, Star, Tag, PackageIcon } from 'lucide-react'
import {
  closestCenter,
  DragOverlay,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  KeyboardSensor,
  PointerSensor,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'

import { BrowseShell } from '@/components/shared/browse-shell'
import { DndArea } from '@/components/shared/dnd-area'
import { SectionHeader } from '@/components/shared/flat-list'
import { OfferingItems, OfferingViewToggle, SortableOfferingCard, useOfferingView } from '@/components/shared/offering-card'
import { ProductPrice, SaleTag } from '@/components/shared/product-price'
import { effectivePriceCents, isOnSale } from '@/lib/product-price'
import { formatMoney } from '@/lib/money'
import { useCurrency } from '@/components/currency-context'
import { inStock, stockLabel } from '@/lib/stock'
import { OPTIONAL_COLUMNS, useProductColumns, type ColumnKey } from './product-columns'

// The shop, browsed the same way the Library is: shelves on the left, what is
// on the shelf on the right.
//
// ── Why this opens its own drag context ─────────────────────────────────────
// Everywhere else in the app a list uses SortableOfferingList, which brings a
// DndContext of its own. Two of those side by side would give the rail and the
// grid a drag context each, and dnd-kit cannot carry a drag ACROSS contexts —
// so a product could be reordered, and a category could be reordered, but a
// product could never be dropped onto a category. One context over both sides
// is what makes that possible, so this screen wires dnd-kit up itself.
//
// Three things can happen, and which one it is comes from what was picked up:
//   • category → category   reorder the shelves
//   • product  → product    reorder that shelf
//   • product  → category   move it to that shelf (or off every shelf, on
//                           "Uncategorised")
// They are separate orders on purpose: dragging within Treats must not
// renumber the categories, and moving a product between shelves must not
// renumber anything.

export interface BrowseProduct {
  id: string
  name: string
  kind: string
  priceCents: number | null
  salePriceCents: number | null
  imageUrl: string | null
  stockCount: number | null
  categoryId: string | null
  featured: boolean
  active: boolean
}

export interface BrowseCategory {
  id: string
  name: string
  products: number
}

/**
 * The table's columns, in the order they appear.
 *
 * `pin: true` means the column is always there — a row with no product and no
 * price is not a row. The rest are the trainer's choice (see product-columns).
 *
 * The template is built from that choice at render time, so it lives in a CSS
 * variable rather than a Tailwind class: the set of combinations is 2^4 and
 * Tailwind can only ship classes it can see in the source.
 */
const TABLE_COLUMNS = [
  { key: 'grip', width: '1.5rem', pin: true },
  { key: 'thumb', width: '2.5rem', pin: true },
  { key: 'product', width: 'minmax(0,1fr)', pin: true },
  { key: 'category', width: '8rem', pin: false },
  { key: 'type', width: '5.5rem', pin: false },
  { key: 'stock', width: '4rem', pin: false },
  // Price sizes to its content so a sale — two prices side by side — stays on
  // one line without spending that room on the rows that don't need it.
  { key: 'price', width: 'minmax(6rem,auto)', pin: true },
  { key: 'status', width: '5.5rem', pin: false },
] as const

/**
 * The frame every row and the header share.
 *
 * Two templates, picked by a CONTAINER query: below @2xl the table is down to
 * product and price whatever the trainer chose, because the alternative in a
 * column that narrow is columns landing on top of one another. Container, not
 * window — the table sits beside a 17rem rail, so a wide window is not a wide
 * table.
 */
const ROW = 'grid items-center gap-x-3 px-3 [grid-template-columns:var(--pm-cols-narrow)] @2xl:[grid-template-columns:var(--pm-cols)]'

function rowVars(chosen: Set<ColumnKey>): React.CSSProperties {
  const template = TABLE_COLUMNS
    .filter(c => c.pin || chosen.has(c.key as ColumnKey))
    .map(c => c.width)
    .join(' ')
  return {
    '--pm-cols': template,
    '--pm-cols-narrow': TABLE_COLUMNS.filter(c => c.pin).map(c => c.width).join(' '),
  } as React.CSSProperties
}

/** Optional cells vanish below @2xl as well as when they are switched off. */
const OPTIONAL_CELL = 'hidden @2xl:block'

/** The Uncategorised shelf is not a row in the database — it is "everything with no shelf". */
const NONE = '__none__'

/**
 * Pointer first, and only fall back to centres when the pointer is over
 * nothing. Dropping a product on a shelf is aimed — the trainer holds it over
 * the row they mean — whereas plain closestCenter would happily snap a product
 * to whichever category row happened to be nearest, including one nowhere near
 * the cursor.
 */
const collisionDetection: CollisionDetection = args => {
  const pointer = pointerWithin(args)
  return pointer.length > 0 ? pointer : closestCenter(args)
}

export function ProductsBrowser({
  categories: initialCategories,
  products: initialProducts,
}: {
  categories: BrowseCategory[]
  products: BrowseProduct[]
}) {
  const router = useRouter()
  const [view, setView] = useOfferingView('products')
  const [chosen, toggleColumn] = useProductColumns()
  const [categories, setCategories] = useState(initialCategories)
  const [products, setProducts] = useState(initialProducts)
  const [selected, setSelected] = useState<string | null>(null)   // null = everything
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<'product' | 'category' | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const sensors = useSensors(
    // A small distance threshold so a tap-to-open on a phone isn't read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const categoryIds = categories.map(c => c.id)
  const uncategorised = products.filter(p => !p.categoryId).length
  const shown = selected == null
    ? products
    : products.filter(p => (p.categoryId ?? NONE) === selected)
  const shownIds = shown.map(p => p.id)

  async function createCategory() {
    const name = newName.trim()
    if (!name) return
    setError(null)
    const res = await fetch('/api/products/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { setError(typeof body.error === 'string' ? body.error : 'Could not add that category.'); return }
    setCategories(prev => [...prev, { id: body.id, name: body.name, products: 0 }])
    setNewName('')
    setAdding(false)
    router.refresh()
  }

  /** Persist a change; put the screen back if the server refuses. */
  async function persist(url: string, method: string, body: unknown, revert: () => void, message: string) {
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { revert(); setError(message) }
    } catch {
      revert()
      setError(message)
    }
  }

  function reorderCategories(ids: string[]) {
    const before = categories
    setCategories(ids.map(id => before.find(c => c.id === id)!).filter(Boolean))
    void persist('/api/products/categories/reorder', 'POST', { ids }, () => setCategories(before), 'Could not save that order.')
  }

  function reorderProducts(ids: string[]) {
    const before = products
    // Only the visible shelf is renumbered, and it is put back into the SLOTS it
    // already occupied — dragging within Treats must not shuffle Treats to the
    // top of All products.
    const moved = ids.map(id => before.find(p => p.id === id)!).filter(Boolean)
    const slots = before.map((p, i) => (ids.includes(p.id) ? i : -1)).filter(i => i >= 0)
    const next = [...before]
    slots.forEach((slot, i) => { next[slot] = moved[i] })
    setProducts(next)
    void persist(
      '/api/products/reorder',
      'POST',
      { ids, categoryId: selected === NONE ? null : selected },
      () => setProducts(before),
      'Could not save that order.',
    )
  }

  /** Move a product to another shelf, or off every shelf. */
  function assign(productId: string, categoryId: string | null) {
    const product = products.find(p => p.id === productId)
    if (!product || product.categoryId === categoryId) return
    const beforeProducts = products
    const beforeCategories = categories

    setProducts(prev => prev.map(p => (p.id === productId ? { ...p, categoryId } : p)))
    // The counts on the rail are the whole point of the rail, so they move now
    // rather than waiting for the refresh.
    setCategories(prev => prev.map(c => {
      if (c.id === product.categoryId) return { ...c, products: Math.max(0, c.products - 1) }
      if (c.id === categoryId) return { ...c, products: c.products + 1 }
      return c
    }))

    void persist(
      `/api/products/${productId}`,
      'PATCH',
      { categoryId },
      () => { setProducts(beforeProducts); setCategories(beforeCategories) },
      'Could not move that product.',
    )
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id)
    setActive(id)
    setDragging(categoryIds.includes(id) ? 'category' : 'product')
  }

  function onDragOver(e: DragOverEvent) {
    setOver(e.over ? String(e.over.id) : null)
  }

  function onDragEnd(e: DragEndEvent) {
    const kind = dragging
    setDragging(null)
    setActive(null)
    setOver(null)

    const { active, over: target } = e
    if (!target || active.id === target.id) return
    const activeId = String(active.id)
    const overId = String(target.id)

    if (kind === 'category') {
      // A category only ever moves among categories; letting it land on a
      // product would be meaningless.
      const from = categoryIds.indexOf(activeId)
      const to = categoryIds.indexOf(overId)
      if (from < 0 || to < 0) return
      reorderCategories(arrayMove(categoryIds, from, to))
      return
    }

    if (overId === NONE || categoryIds.includes(overId)) {
      assign(activeId, overId === NONE ? null : overId)
      return
    }

    const from = shownIds.indexOf(activeId)
    const to = shownIds.indexOf(overId)
    if (from < 0 || to < 0) return
    reorderProducts(arrayMove(shownIds, from, to))
  }

  /** A shelf lights up only while something that can land on it is in the air. */
  const droppable = dragging === 'product'

  return (
    <DndArea
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => { setDragging(null); setActive(null); setOver(null) }}
    >
      <BrowseShell
        nav={
          <>
            <SectionHeader>Categories</SectionHeader>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
              <ShelfRow
                label="All products"
                count={products.length}
                active={selected == null}
                onClick={() => setSelected(null)}
              />
              <SortableContext items={categoryIds} strategy={rectSortingStrategy}>
                {categories.map(c => (
                  <SortableOfferingCard key={c.id} id={c.id}>
                    {handle => (
                      <ShelfRow
                        label={c.name}
                        count={c.products}
                        active={selected === c.id}
                        dropping={droppable && over === c.id}
                        onClick={() => setSelected(c.id)}
                        dragHandle={handle}
                      />
                    )}
                  </SortableOfferingCard>
                ))}
              </SortableContext>
              {/* Always a target, even when it is empty — it is how a product
                  comes back OFF a shelf. */}
              <UncategorisedRow
                count={uncategorised}
                active={selected === NONE}
                dropping={droppable && over === NONE}
                onClick={() => setSelected(NONE)}
              />
            </div>

            {/* Adding a shelf belongs beside the shelves, not over with the
                things on them. */}
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
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-600)]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void createCategory()}
                    className="inline-flex h-9 flex-1 items-center justify-center rounded-xl bg-[var(--pm-brand-600)] px-3 text-sm font-semibold text-white hover:bg-[var(--pm-brand-700)]"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAdding(false); setNewName('') }}
                    className="inline-flex h-9 items-center justify-center rounded-xl px-3 text-sm text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--pm-brand-600)] px-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--pm-brand-700)]"
              >
                <Plus className="h-4 w-4 flex-shrink-0" strokeWidth={2.25} /> New category
              </button>
            )}
          </>
        }
      >
        <SectionHeader
          action={
            <span className="flex items-center gap-2">
              <Link
                href="/products/new"
                className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-xl bg-[var(--pm-brand-600)] px-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--pm-brand-700)]"
              >
                <Plus className="h-4 w-4 flex-shrink-0" strokeWidth={2.25} /> Add product
              </Link>
              {view === 'list' && <ColumnPicker chosen={chosen} onToggle={toggleColumn} />}
              <OfferingViewToggle value={view} onChange={setView} />
            </span>
          }
        >
          {selected == null
            ? 'All products'
            : selected === NONE
              ? 'Uncategorised'
              : categories.find(c => c.id === selected)?.name ?? 'Products'}
        </SectionHeader>

        {error && (
          <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}

        {shown.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center">
            <PackageIcon className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-medium text-slate-600">Nothing on this shelf yet</p>
            <p className="mt-1 text-xs text-slate-500">Drag a product onto a category to put it here.</p>
          </div>
        ) : (
          <SortableContext items={shownIds} strategy={rectSortingStrategy}>
            {view === 'grid' ? (
              <OfferingItems view="grid" columns={4}>
                {shown.map(p => (
                  <SortableOfferingCard key={p.id} id={p.id}>
                    {handle => <ProductTile product={p} view="grid" chosen={chosen} dragHandle={handle} />}
                  </SortableOfferingCard>
                ))}
              </OfferingItems>
            ) : (
              // One bordered box with hairlines between the rows, rather than
              // OfferingItems' stack of separate cards — a table only reads as
              // a table when its columns run the whole way down it.
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <ProductTableHead chosen={chosen} />
                <div className="[&>*+*]:border-t [&>*+*]:border-slate-100">
                  {shown.map(p => (
                    <SortableOfferingCard key={p.id} id={p.id}>
                      {handle => (
                        <ProductTile
                          product={p}
                          view="list"
                          categoryName={categories.find(c => c.id === p.categoryId)?.name ?? null}
                          chosen={chosen}
                          dragHandle={handle}
                        />
                      )}
                    </SortableOfferingCard>
                  ))}
                </div>
              </div>
            )}
          </SortableContext>
        )}
      </BrowseShell>

      {/* What the cursor is carrying. The row left behind stays where it is
          until the drop lands, so the list never looks like it lost something
          on a drag that gets cancelled. */}
      <DragOverlay dropAnimation={null}>
        {active ? (
          <span className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-[0_18px_45px_-12px_rgba(15,23,42,0.35)]">
            {dragging === 'category'
              ? <><Tag className="h-4 w-4 text-slate-400" strokeWidth={1.75} />{categories.find(c => c.id === active)?.name}</>
              : <><PackageIcon className="h-4 w-4 text-slate-400" strokeWidth={1.75} />{products.find(p => p.id === active)?.name}</>}
          </span>
        ) : null}
      </DragOverlay>
    </DndArea>
  )
}

function ShelfRow({
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
  dragHandle?: React.ReactNode
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
  return (
    <ShelfRow rowRef={setNodeRef} label="Uncategorised" count={count} active={active} dropping={dropping} onClick={onClick} />
  )
}

/** The column names, on the same grid the rows use. */
function ProductTableHead({ chosen }: { chosen: Set<ColumnKey> }) {
  const cell = 'text-[11px] font-semibold uppercase tracking-wide text-slate-400'
  return (
    <div className={`${ROW} h-9 border-b border-slate-200 bg-slate-50/70`} style={rowVars(chosen)}>
      <span aria-hidden />
      <span aria-hidden />
      <span className={cell}>Product</span>
      {chosen.has('category') && <span className={`${OPTIONAL_CELL} ${cell}`}>Category</span>}
      {chosen.has('type') && <span className={`${OPTIONAL_CELL} ${cell}`}>Type</span>}
      {chosen.has('stock') && <span className={`${OPTIONAL_CELL} ${cell} text-right`}>Stock</span>}
      <span className={`${cell} text-right`}>Price</span>
      {chosen.has('status') && <span className={`${OPTIONAL_CELL} ${cell}`}>Status</span>}
    </div>
  )
}

/** Pick the columns. Only offered in list view — the grid has no columns. */
function ColumnPicker({
  chosen,
  onToggle,
}: {
  chosen: Set<ColumnKey>
  onToggle: (key: ColumnKey, on: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative hidden md:inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title="Choose columns"
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
      >
        <Columns3 className="h-4 w-4" strokeWidth={1.75} /> Columns
      </button>
      {open && (
        <>
          {/* Clicking anywhere else closes it. */}
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <span className="absolute right-0 top-10 z-50 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-[0_18px_45px_-12px_rgba(15,23,42,0.25)]">
            {OPTIONAL_COLUMNS.map(c => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={chosen.has(c.key)}
                  onChange={e => onToggle(c.key, e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[var(--pm-brand-600)] focus:ring-[var(--pm-brand-600)]"
                />
                {c.label}
              </label>
            ))}
          </span>
        </>
      )}
    </span>
  )
}

function ProductTile({
  product,
  view,
  categoryName,
  chosen,
  dragHandle,
}: {
  product: BrowseProduct
  view: 'list' | 'grid'
  /** The shelf it is on, shown in the table's Category column. */
  categoryName?: string | null
  /** Which optional columns are switched on. */
  chosen: Set<ColumnKey>
  dragHandle: React.ReactNode
}) {
  const currency = useCurrency()
  const kind = product.kind === 'DIGITAL' ? 'Digital' : 'Physical'
  const stock = stockLabel(product.stockCount)
  const price = effectivePriceCents(product)
  const onSale = isOnSale(product)

  const thumb = (cls: string, icon: string) =>
    product.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={product.imageUrl} alt="" className={cls} />
    ) : (
      <span className={`${cls} grid place-items-center bg-slate-50 text-slate-300`}>
        {product.kind === 'DIGITAL'
          ? <FileDown className={icon} strokeWidth={1.5} />
          : <PackageIcon className={icon} strokeWidth={1.5} />}
      </span>
    )

  // A grid cell is tall and narrow, so the picture goes on top of the name
  // rather than beside it, and the three things a trainer scans for — Sale,
  // Featured, Hidden — are badged on the picture. The table says the same in
  // its own columns.
  if (view === 'grid') {
    return (
      <div className={`relative h-full overflow-hidden rounded-xl border border-slate-200 bg-white ${product.active ? '' : 'opacity-60'}`}>
        <span className="absolute left-1 top-1 z-10 rounded-lg bg-white/85">{dragHandle}</span>
        <Link href={`/products/${product.id}`} className="flex h-full flex-col">
          <span className="relative block">
            {thumb('aspect-4/3 w-full object-cover', 'h-7 w-7')}
            <span className="absolute bottom-2 left-2 flex flex-wrap items-center gap-1">
              <SaleTag product={product} />
              {product.featured && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-700 backdrop-blur">
                  <Star className="h-3 w-3" strokeWidth={1.75} /> Featured
                </span>
              )}
              {!product.active && (
                <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-slate-700 backdrop-blur">Hidden</span>
              )}
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 border-t border-slate-100 p-3">
            <span className="flex items-start justify-between gap-2">
              <span className="line-clamp-1 text-sm font-medium text-slate-900">{product.name}</span>
              <ProductPrice product={product} currency={currency} className="flex-shrink-0 justify-end" />
            </span>
            <span className="truncate text-xs text-slate-500">
              {kind}
              {stock && <span className={inStock(product.stockCount) ? '' : 'text-red-500'}> · {stock}</span>}
            </span>
          </span>
        </Link>
      </div>
    )
  }

  return (
    <div
      data-testid="product-row"
      data-product={product.id}
      className={`${ROW} h-14 transition-colors hover:bg-slate-50 ${product.active ? '' : 'opacity-60'}`}
      style={rowVars(chosen)}
    >
      {dragHandle}
      {thumb('h-9 w-9 rounded-lg border border-slate-100 object-cover', 'h-4 w-4')}

      <Link
        href={`/products/${product.id}`}
        className="min-w-0 truncate text-sm font-medium text-slate-900 hover:underline"
      >
        {product.name}
      </Link>

      {chosen.has('category') && (
        <span className={`${OPTIONAL_CELL} truncate text-sm text-slate-500`}>{categoryName ?? '—'}</span>
      )}
      {chosen.has('type') && <span className={`${OPTIONAL_CELL} text-sm text-slate-500`}>{kind}</span>}
      {chosen.has('stock') && (
        // Just the number. "Only 3 left" is a shop-front phrase; a trainer
        // reading down a stock column wants figures they can compare.
        <span className={`${OPTIONAL_CELL} text-right text-sm tabular-nums ${
          product.stockCount != null && !inStock(product.stockCount) ? 'text-red-500' : 'text-slate-500'
        }`}>
          {product.stockCount ?? '—'}
        </span>
      )}

      {/* ONE price — what a client would actually pay today, which is the sale
          price when there is one. The struck original, the "% off" and the
          "Sale" flash all belong on a card; down a column they are three extra
          things to read past. A product on special says so by being red. */}
      {price == null ? (
        <span className="text-right text-sm text-slate-400">—</span>
      ) : onSale ? (
        <span
          data-testid="sale-price"
          title={`Was ${formatMoney(product.priceCents as number, currency)}`}
          className="justify-self-end rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold tabular-nums text-white"
        >
          {formatMoney(price, currency)}
        </span>
      ) : (
        <span className="text-right text-sm font-semibold tabular-nums text-slate-900">{formatMoney(price, currency)}</span>
      )}

      {chosen.has('status') && (
        <span className={`${OPTIONAL_CELL} text-sm`}>
          {!product.active ? (
            <span className="text-slate-400">Hidden</span>
          ) : product.featured ? (
            <span className="inline-flex items-center gap-1 text-slate-600"><Star className="h-3.5 w-3.5" strokeWidth={1.75} /> Featured</span>
          ) : (
            <span className="text-slate-400">Live</span>
          )}
        </span>
      )}
    </div>
  )
}
