'use client'

import { type ReactNode, type HTMLAttributes, useCallback, useSyncExternalStore } from 'react'
import { richTextToPlain, isRichTextEmpty } from '@/lib/rich-text'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { Plus, GripVertical, LayoutGrid, List as ListIcon } from 'lucide-react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// One card design for everything a trainer sells — 1:1 packages, group classes,
// drop-in classes and events. They were four hand-rolled layouts that had
// drifted apart (different tiles, different meta formats, only one of them with
// edit buttons), so a trainer moving between the pages had to relearn the list
// each time.
//
// The rule these encode: everything you need to judge an offering is ON the
// card — when, where, what it costs, how full it is — and every card can be
// edited from where you are, without opening it first.

export type FactTone = 'default' | 'good' | 'warn' | 'bad'

export type OfferingFact = {
  icon: ReactNode
  label: string
  tone?: FactTone
}

export type OfferingBadge = {
  label: string
  tone?: 'accent' | 'good' | 'warn' | 'bad' | 'muted'
  /** The old price beside a special one — struck, so it reads as "was". */
  strike?: boolean
}

export type OfferingAction = {
  icon: ReactNode
  label: string
  onClick: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}

const FACT_TONE: Record<FactTone, string> = {
  default: 'text-slate-500',
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-rose-500',
}

const BADGE_TONE: Record<NonNullable<OfferingBadge['tone']>, string> = {
  accent: 'bg-blue-50 text-blue-700',
  good: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-rose-50 text-rose-600',
  muted: 'bg-slate-100 text-slate-600',
}

/**
 * A single offering. `href` makes the body a link to the detail page; the
 * actions sit OUTSIDE it (a button inside an anchor is invalid HTML and breaks
 * keyboard use), which is why the layout splits the way it does.
 */
export function OfferingCard({
  href,
  onOpen,
  title,
  tile,
  imageUrl,
  badges = [],
  description,
  facts = [],
  actions = [],
  note,
  dragHandle,
  dimmed = false,
}: {
  href?: string
  /** For a card with no detail page — memberships open their builder in place. */
  onOpen?: () => void
  title: string
  /** Coloured icon tile, when there's no cover photo. */
  tile?: { icon: ReactNode; className?: string }
  imageUrl?: string | null
  badges?: OfferingBadge[]
  description?: string | null
  facts?: OfferingFact[]
  actions?: OfferingAction[]
  /** A single line that needs to stand out — "No sessions left", say. */
  note?: { label: string; tone?: FactTone } | null
  dragHandle?: ReactNode
  /** Past / cancelled things read quieter without disappearing. */
  dimmed?: boolean
}) {
  const body = (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Photo across the top when there is one. Without one, a small mark
          beside the title — a 128px block of flat colour was a lot of card
          spent saying "this is a package". */}
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="mb-3 h-32 w-full rounded-xl object-cover" />
      )}

      <div className="flex min-w-0 items-start gap-3">
        {!imageUrl && tile && (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tile.className ?? 'bg-blue-50 text-blue-600'}`}>
            {tile.icon}
          </div>
        )}

        <div className={cn('min-w-0 flex-1', actions.length > 0 && !imageUrl && 'pr-24')}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-semibold text-slate-900 break-words">{title}</p>
            {badges.map((b, i) => (
              <span
                key={i}
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_TONE[b.tone ?? 'muted']} ${b.strike ? 'line-through opacity-70' : ''}`}
              >
                {b.label}
              </span>
            ))}
          </div>

          {!isRichTextEmpty(description) && (
            <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{richTextToPlain(description)}</p>
          )}

          {/* The facts sit in the text column, aligned under the title — from
              the card edge they started left of everything else and read as a
              separate, misaligned strip. Chips rather than a "·"-joined string
              so each keeps its icon and its own colour; each is
              whitespace-nowrap so a chip wraps whole instead of a word at a
              time. */}
          {facts.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {facts.map((f, i) => (
                <span key={i} className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${FACT_TONE[f.tone ?? 'default']}`}>
                  <span className="shrink-0 opacity-70">{f.icon}</span>
                  {f.label}
                </span>
              ))}
            </div>
          )}

          {note && <p className={`mt-1.5 text-xs font-medium ${FACT_TONE[note.tone ?? 'warn']}`}>{note.label}</p>}
        </div>
      </div>
    </div>
  )

  const actionBar = actions.length > 0 && (
    // Always visible on touch (there's no hover to reveal them), and the
    // buttons are 36px so they're tappable.
    <div className="flex shrink-0 items-center gap-0.5">
      {actions.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={a.onClick}
          disabled={a.disabled}
          aria-label={a.label}
          title={a.label}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors disabled:opacity-40 ${
            a.tone === 'danger' ? 'hover:bg-rose-50 hover:text-rose-500' : 'hover:bg-blue-50 hover:text-blue-600'
          }`}
        >
          {a.icon}
        </button>
      ))}
    </div>
  )

  // One card, at every width. The drag handle and the actions share a row
  // across the top and everything below it opens the offering — which is what
  // stops the actions (three 36px buttons) from eating the width the title
  // needs on a phone.
  return (
    <div
      className={cn(
        'group relative flex h-full flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_8px_rgba(15,31,36,0.04)] transition-colors hover:border-blue-200',
        // Room for the absolutely-placed grip on the left.
        dragHandle && 'pl-9',
        dimmed && 'opacity-60',
      )}
    >
      {/* Actions float top-right and the content starts at the top beside them,
          rather than the buttons taking a row of their own and leaving that
          space empty. The title block reserves room so text stops short of
          them instead of running underneath. */}
      {actions.length > 0 && (
        <div className="absolute right-3 top-3 z-10">{actionBar}</div>
      )}
      {/* Grip sits beside the content, not on a row above it — that row left
          the whole width next to it empty. */}
      {dragHandle && <div className="absolute left-3 top-4">{dragHandle}</div>}
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 flex-col">{body}</Link>
      ) : onOpen ? (
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col text-left">{body}</button>
      ) : body}
    </div>
  )
}

// ─── List chrome: view mode, drag-to-reorder ─────────────────────────────────

export type OfferingView = 'list' | 'grid'

const VIEW_KEY_PREFIX = 'pupmanager:offering-view'

/**
 * The list/grid preference, remembered PER PAGE — memberships can sit in grid
 * while classes stay a list, because the lists are read differently (photos
 * matter more on some than others).
 *
 * Desktop only. A phone is one column either way, so the choice is meaningless
 * there and the toggle is hidden — which is also why the CARD no longer has
 * two layouts. The view now only decides how many cards sit across the page;
 * what's inside one never changes. That's what stopped the old "list" card
 * from crushing its title between a drag handle, an icon and three buttons.
 *
 * Starts as 'list' on the server so the markup matches until the stored choice
 * is read (a mismatch here hydration-errors the whole page).
 */
const viewListeners = new Set<() => void>()

function subscribeView(cb: () => void) {
  viewListeners.add(cb)
  // Another tab switching view should switch this one too.
  window.addEventListener('storage', cb)
  return () => {
    viewListeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

// Read through useSyncExternalStore rather than an effect: localStorage IS an
// external store, and this gives the server 'list' while the client reads the
// real value, with no setState-in-effect cascade.
function readView(key: string): OfferingView {
  try { return window.localStorage.getItem(key) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
}
const serverView = (): OfferingView => 'list'

/** @param page which list this is — its own remembered view ('classes', 'memberships', …). */
export function useOfferingView(page: string): [OfferingView, (v: OfferingView) => void] {
  const key = `${VIEW_KEY_PREFIX}:${page}`
  // Both callbacks have to be stable, or useSyncExternalStore resubscribes on
  // every render and the page spins.
  const subscribe = useCallback((cb: () => void) => subscribeView(cb), [])
  const snapshot = useCallback(() => readView(key), [key])
  const view = useSyncExternalStore(subscribe, snapshot, serverView)
  const choose = useCallback((v: OfferingView) => {
    try { window.localStorage.setItem(key, v) } catch { /* private mode */ }
    viewListeners.forEach(l => l())
  }, [key])
  return [view, choose]
}

/** List / grid switch. Hidden on phones — one column either way there. */
export function OfferingViewToggle({ value, onChange }: { value: OfferingView; onChange: (v: OfferingView) => void }) {
  return (
    <div className="hidden items-center gap-0.5 rounded-xl bg-slate-100 p-1 md:flex">
      {([
        { id: 'list' as const, icon: <ListIcon className="h-4 w-4" />, label: 'List view' },
        { id: 'grid' as const, icon: <LayoutGrid className="h-4 w-4" />, label: 'Grid view' },
      ]).map(v => (
        <button
          key={v.id}
          type="button"
          onClick={() => onChange(v.id)}
          aria-label={v.label}
          title={v.label}
          aria-pressed={value === v.id}
          className={`flex h-8 w-9 items-center justify-center rounded-lg transition-colors ${
            value === v.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          {v.icon}
        </button>
      ))}
    </div>
  )
}

/**
 * The row that carries the tabs (if any) on the left and the view toggle right.
 *
 * Pulled up on md+ so the toggle sits level with the page description instead
 * of taking a row of its own underneath it — the description is short, and the
 * space to its right was empty.
 */
export function OfferingListBar({ children, view, onView }: { children?: ReactNode; view: OfferingView; onView: (v: OfferingView) => void }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 md:-mt-12">
      <div className="min-w-0">{children}</div>
      <OfferingViewToggle value={view} onChange={onView} />
    </div>
  )
}

function SortableOffering({ id, children }: { id: string; children: (handle: HTMLAttributes<HTMLElement>) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{
        // Translate ONLY. CSS.Transform.toString() also emits the scaleX/scaleY
        // dnd-kit measures between two differently-sized cards, and a card
        // scaled 1.14 × 0.83 re-renders its text at a stretched size the font
        // has no hinting for — which is the "the font goes crazy when I drag"
        // report. The card has to look identical picked up and put down, so the
        // size mismatch is absorbed by the gap, not by squashing the card.
        transform: transform ? CSS.Translate.toString(transform) : undefined,
        transition,
        position: 'relative',
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      {children({ ...attributes, ...listeners })}
    </div>
  )
}

/** The grip a card is dragged by. Rendered into OfferingCard's `dragHandle`. */
export function OfferingDragHandle(handle: HTMLAttributes<HTMLElement>) {
  return (
    <button
      type="button"
      {...handle}
      title="Drag to reorder"
      aria-label="Drag to reorder"
      className="mt-0.5 cursor-grab touch-none rounded-lg p-1 text-slate-300 transition-colors hover:bg-slate-50 hover:text-slate-500"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  )
}

/**
 * Drag-to-reorder around any offering list. `items` is the ids in their current
 * order; `onReorder` gets the new order to persist. The order it saves is the
 * one clients see, so this is the trainer arranging their shopfront — which is
 * why it reorders optimistically and only tells you if the save fails.
 */
export function SortableOfferingList({
  ids,
  onReorder,
  children,
}: {
  ids: string[]
  onReorder: (orderedIds: string[]) => void
  children: ReactNode
}) {
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

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      {/* rect, not vertical-list: the cards wrap into columns from sm: up, and
          the vertical strategy assumes a single column. */}
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

/** Wraps one card so it can be dragged; hands back the grip to render. */
export function SortableOfferingCard({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  return <SortableOffering id={id}>{handle => children(<OfferingDragHandle {...handle} />)}</SortableOffering>
}

/**
 * The container the cards sit in. Always one column on a phone; on desktop the
 * trainer's chosen view decides whether cards go full width (list) or two to
 * four across (grid).
 */
export function OfferingItems({ view, children }: { view: OfferingView; children: ReactNode }) {
  return (
    <div className={view === 'grid'
      ? 'grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
      : 'flex flex-col gap-2.5'}
    >
      {children}
    </div>
  )
}

/** Current / Past style pill tabs, shared by classes, drop-ins and events. */
export function OfferingTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count: number }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    // Full width on a phone (thumb-sized targets), its natural width on a
    // desktop — a two-tab bar stretched across 1200px reads as a header.
    //
    // The radii have to agree or the active pill reads as bulging out of its
    // track: track radius (16) = pill radius (10) + the track's padding (6).
    // 4px of padding isn't enough — the active pill's shadow closes the gap.
    <div className="mb-1.5 flex gap-1 rounded-2xl bg-slate-100 p-1.5 sm:inline-flex sm:self-start">
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3.5 py-2 text-sm font-medium transition-all duration-150 ${
            value === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
          <span
            className={`min-w-5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums ${
              value === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {t.count}
          </span>
        </button>
      ))}
    </div>
  )
}

/**
 * The dashed "add" affordance that closes every offering list. Most lists point
 * at a /new page; memberships open their builder in place, so it takes an
 * onClick instead of an href.
 */
export function AddOfferingLink({ href, label, onClick }: { href?: string; label: string; onClick?: () => void }) {
  const className = 'mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-3.5 text-sm font-medium text-slate-500 transition-colors hover:border-blue-300 hover:text-blue-600'
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        <Plus className="h-4 w-4" /> {label}
      </button>
    )
  }
  return (
    <Link href={href ?? '#'} className={className}>
      <Plus className="h-4 w-4" /> {label}
    </Link>
  )
}

/** The first-run empty state: what this page is for, and one way forward. */
export function OfferingEmpty({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode
  title: string
  body: string
  /** Either a link to a /new page, or an in-place handler (memberships). */
  action?: { href: string; label: string; onClick?: never } | { onClick: () => void; label: string; href?: never }
}) {
  const actionClass = 'mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700'
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_8px_rgba(15,31,36,0.04)]">
      <div className="flex flex-col items-center px-4 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">{icon}</div>
        <p className="mt-4 font-medium text-slate-700">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-slate-400">{body}</p>
        {action && (action.href ? (
          <Link href={action.href} className={actionClass}>
            <Plus className="h-4 w-4" /> {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className={actionClass}>
            <Plus className="h-4 w-4" /> {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** "Nothing in this tab" — quieter than the first-run empty state. */
export function OfferingTabEmpty({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_8px_rgba(15,31,36,0.04)]">
      <div className="px-4 py-10 text-center">
        <div className="mx-auto mb-3 text-slate-300">{icon}</div>
        <p className="font-medium text-slate-600">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">{body}</p>
      </div>
    </div>
  )
}

/**
 * The page's content column — same width and padding on every offering list.
 * Full width (no max cap): grid view wants every column a wide screen can give
 * it, and the list cards read fine full-bleed because their content is
 * left-aligned.
 */
export function OfferingPage({ children }: { children: ReactNode }) {
  return (
    <div className="w-full p-4 md:p-8">
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  )
}
