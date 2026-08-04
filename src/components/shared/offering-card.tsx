'use client'

import { type ReactNode, type HTMLAttributes, useCallback, useSyncExternalStore } from 'react'
import { richTextToPlain, isRichTextEmpty } from '@/lib/rich-text'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { Plus, GripVertical, LayoutGrid, List as ListIcon, Tag as TagIcon } from 'lucide-react'
import { closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { DndArea } from './dnd-area'
import { SortableContext, sortableKeyboardCoordinates, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { usePathname } from 'next/navigation'
import { groupOfferingsByTag, type TagRef } from '@/lib/offering-grouping'
import { prePickedOfferingHref } from '@/lib/offering-create'

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

// How much of the title row the floating action buttons eat, by how many there
// are. Measured from the card's CONTENT box: 36px a button + 2px between them
// + the 12px inset, less the card's own 16px of padding — so three buttons
// need 108px and one needs 32px, rounded up to the nearest step for air. A
// flat reserve was 32px too generous for one button and 16px short for three,
// and on a 358px phone card every one of those pixels is title.
// Listed, not computed: Tailwind only ships class names it can see in source.
const TITLE_RESERVE = ['', 'pr-12', 'pr-20', 'pr-28']

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
    // Content left, cover photo right — the photo used to be a banner across
    // the top, which pushed everything that tells you what the offering IS
    // below the fold of the card and put the buttons on top of the picture.
    //
    // Below @sm it stacks instead, photo last. A phone card is ~300px of
    // content; splitting that two ways crushes the title into a column too
    // narrow to read, which is the exact failure this card was rewritten to
    // end. The breakpoint is a CONTAINER query, not a viewport one: the same
    // card is full width in list view and a third of the width in grid view on
    // the same screen, so only the card's own width can decide.
    <div className="flex min-w-0 flex-1 flex-col gap-3 @sm/card:flex-row @sm/card:items-stretch">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {!imageUrl && tile && (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tile.className ?? 'bg-blue-50 text-blue-600'}`}>
            {tile.icon}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Only the TITLE row keeps clear of the floating actions — the
              description and the facts start below them and had no reason to
              give up the width. The reserve is sized to the buttons that are
              actually there (36px each, 2px apart, 12px inset); a flat pr-24
              was too much for one button and too little for three, and three
              is what a package card has. */}
          <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', TITLE_RESERVE[Math.min(actions.length, 3)])}>
            {/* Never clamped, never truncated, never ellipsised: the name of
                the thing is the one line on the card that has to be readable
                at every width. It wraps — onto three lines if that's what the
                trainer called it. */}
            <p className="min-w-0 break-words font-semibold text-slate-900">{title}</p>
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
                <span
                  key={i}
                  className={cn(
                    'inline-flex max-w-full items-start gap-1.5 text-xs',
                    // A long one wraps onto its own lines instead of running
                    // off the card: "17 Russley Drive, Mount Maunganui 3116,
                    // New Zealand" is 50 characters and a phone card has room
                    // for about 40, so nowrap sent the country over the edge
                    // where it couldn't be read at all.
                    f.label.length > 36 ? '[overflow-wrap:anywhere]' : 'whitespace-nowrap',
                    FACT_TONE[f.tone ?? 'default'],
                  )}
                >
                  <span className="mt-px shrink-0 opacity-70">{f.icon}</span>
                  {f.label}
                </span>
              ))}
            </div>
          )}

          {note && <p className={`mt-1.5 text-xs font-medium ${FACT_TONE[note.tone ?? 'warn']}`}>{note.label}</p>}
        </div>
      </div>

      {/* The photo. object-cover throughout, so a portrait shot of a dog is
          cropped, never squashed. Side by side it's a fixed 160px column that
          takes the card's full height; stacked it's a 128px band under the
          text. Fixed rather than a fraction because the action buttons have to
          know exactly how far to step left of it (see below) — and because a
          photo that grows with a 1400px-wide list card would be the loudest
          thing on the page. */}
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="h-32 w-full shrink-0 rounded-xl object-cover @sm/card:h-auto @sm/card:min-h-24 @sm/card:w-40"
        />
      )}
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

  // One card, at every width — the CARD decides how it lays out from its own
  // width (@container), never from the viewport's, because list view and grid
  // view show the same component at very different widths on one screen.
  return (
    <div
      className={cn(
        '@container/card group relative flex h-full flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_8px_rgba(15,31,36,0.04)] transition-colors hover:border-blue-200',
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
        <div
          className={cn(
            'absolute right-3 top-3 z-10',
            // Once the photo has the right-hand column, the buttons step left
            // of it rather than sitting on it: 160px of photo + the 12px gap +
            // the card's 16px padding = 188px. Buttons over a photo are hard
            // to see and they swallow the taps meant for the picture.
            imageUrl && '@sm/card:right-[11.75rem]',
          )}
        >
          {actionBar}
        </div>
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

const GROUP_KEY_PREFIX = 'pupmanager:offering-group'

function readGroup(key: string): boolean {
  try { return window.localStorage.getItem(key) === '1' } catch { return false }
}
const serverGroup = () => false

/**
 * "Group this page by tag", remembered per page like the view is.
 *
 * Shares `viewListeners`, so switching it in one tab moves every list control
 * in the others too — one store, one subscription, no second `storage`
 * listener doing the same job.
 *
 * Off on the server, for the same reason the view starts as 'list': the markup
 * has to match until the stored choice is read, or the page hydration-errors.
 */
export function useOfferingGrouping(page: string): [boolean, (v: boolean) => void] {
  const key = `${GROUP_KEY_PREFIX}:${page}`
  const subscribe = useCallback((cb: () => void) => subscribeView(cb), [])
  const snapshot = useCallback(() => readGroup(key), [key])
  const grouped = useSyncExternalStore(subscribe, snapshot, serverGroup)
  const choose = useCallback((v: boolean) => {
    try { window.localStorage.setItem(key, v ? '1' : '0') } catch { /* private mode */ }
    viewListeners.forEach(l => l())
  }, [key])
  return [grouped, choose]
}

/**
 * Group-by-tag switch, between the "new one of these" button and the view
 * toggle.
 *
 * Visible on phones, unlike the view toggle. The view is meaningless on one
 * column; grouping is arguably worth MORE there, because a phone shows four
 * cards at a time and headings are how you find your place in forty.
 */
export function OfferingGroupToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const label = value ? 'Grouped by tag — tap to ungroup' : 'Group by tag'
  return (
    // No VERTICAL padding, and that is the fix rather than an oversight.
    // globals.css forces every button to a 44px minimum tap target, so the
    // `h-8` below is silently ignored and the button is 44 tall whatever it
    // says — which made this track 44 + 8 = 52px beside a 44px add button, and
    // three controls at three heights is what made the bar look assembled
    // rather than designed. The 2px inset stays on the sides, where nothing
    // overrides it and the track still reads as a track.
    <div className="flex items-center rounded-xl bg-slate-100 px-0.5">
      <button
        type="button"
        onClick={() => onChange(!value)}
        aria-label={label}
        aria-pressed={value}
        title={label}
        className={`flex h-8 w-9 items-center justify-center rounded-lg transition-colors ${
          value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
        }`}
      >
        <TagIcon className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  )
}

/**
 * The heading above one tag's run of cards.
 *
 * A hairline and a quiet label, not a card or a coloured chip — the cards below
 * are the content, and a heavy heading would compete with them. The count is
 * there because a tag's whole job is to answer "how much is in this?".
 */
export function OfferingGroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2 border-b border-slate-200 pb-1.5">
      <h2 className="text-sm font-semibold text-slate-900">{label}</h2>
      <span className="text-xs text-slate-400" aria-hidden="true">{count}</span>
      <span className="sr-only">{count === 1 ? '1 offering' : `${count} offerings`}</span>
    </div>
  )
}

/** List / grid switch. Hidden on phones — one column either way there. */
export function OfferingViewToggle({ value, onChange }: { value: OfferingView; onChange: (v: OfferingView) => void }) {
  return (
    <div className="hidden items-center gap-0.5 rounded-xl bg-slate-100 px-0.5 md:flex">
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
 * This used to be pulled up 48px on md+ (`md:-mt-12`) to sit the view toggle
 * level with the page description, which was empty to its right. But the bar is
 * one justify-between row, so the TABS were dragged up by the same 48px — and
 * they're left-aligned, directly over the description, whose `bg-slate-100`
 * pill track then painted out the sentence. It was worst on /classes, whose
 * subtitle is the longest and wraps to two lines, and it fired even with page
 * descriptions switched off, because the offset was unconditional.
 *
 * Now it's an ordinary row in the flow: tabs left, toggle right, on the shared
 * hairline the underline tabs sit on. Nothing overlaps at any width.
 */
export function OfferingListBar({ children, view, onView, action, grouped, onGrouped }: {
  children?: ReactNode
  /**
   * The chosen view. OPTIONAL, and omitting it hides the toggle — for a list
   * where a grid would be a worse way to read the same thing. The waitlist is
   * the case: it is a queue the trainer has dragged into the order they mean
   * to work it, and a grid wraps that order left-to-right across columns,
   * which is precisely how you lose "who is next". A control with nothing
   * useful behind it is worse than no control.
   */
  view?: OfferingView
  onView?: (v: OfferingView) => void
  /** The "new one of these" action, sat beside the view toggle. */
  action?: ReactNode
  /**
   * Group-by-tag state. Both must be supplied for the control to appear, and
   * a page passes them only when there is at least one tag on the list — see
   * `canGroupByTag`. Memberships never pass them: tags reach packages and
   * products, and a membership is neither, so the switch could only ever
   * produce a single heading reading "No tag".
   */
  grouped?: boolean
  onGrouped?: (v: boolean) => void
}) {
  const canGroup = grouped !== undefined && onGrouped !== undefined
  // On a phone the create circle in the bottom-right corner already makes the
  // thing this list holds — but only on the pages where it can pre-pick the
  // kind. Tags, the waitlist, lead magnets, achievements and memberships are
  // not among them, and on those this button is the ONLY way to make one, so it
  // stays at every width. Hiding it everywhere would have been a tidier rule
  // and would have stranded five screens.
  const pathname = usePathname()
  const duplicatedByCreateButton = prePickedOfferingHref(pathname) !== null
  return (
    <div className={`mb-3 flex items-end justify-between gap-3 ${children ? 'border-b border-slate-200' : ''}`}>
      <div className="min-w-0">{children}</div>
      <div className={`flex flex-shrink-0 items-center gap-2 ${children ? 'pb-1.5' : ''}`}>
        {action && (duplicatedByCreateButton
          ? <span className="hidden md:inline-flex">{action}</span>
          : action)}
        {canGroup && <OfferingGroupToggle value={grouped} onChange={onGrouped} />}
        {view !== undefined && onView !== undefined && <OfferingViewToggle value={view} onChange={onView} />}
      </div>
    </div>
  )
}

/**
 * "New <thing>" as a real button, at the top of the list beside the view
 * toggle — rather than a dashed row under the last card.
 *
 * The dashed row reads as an empty slot in the list: at a glance it is another
 * card that has not loaded yet. Up here it is unambiguously an action, and it
 * is in the same place whether the list has one item or forty, so it does not
 * move further away the more you have.
 */
export function AddOfferingButton({ href, label, onClick }: { href?: string; label: string; onClick?: () => void }) {
  const className = 'inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--pm-brand-600)] px-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--pm-brand-700)]'
  const inner = <><Plus className="h-4 w-4 flex-shrink-0" strokeWidth={2.25} /> {label}</>
  return onClick
    ? <button type="button" onClick={onClick} className={className}>{inner}</button>
    : <Link href={href ?? '#'} className={className}>{inner}</Link>
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
    <DndArea sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      {/* rect, not vertical-list: the cards wrap into columns from sm: up, and
          the vertical strategy assumes a single column. */}
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        {children}
      </SortableContext>
    </DndArea>
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
export function OfferingItems({
  view,
  columns = 3,
  children,
}: {
  view: OfferingView
  /**
   * How wide the grid gets at its widest. Offerings are wordy cards and stop at
   * 3; product tiles are a picture and a price, so the shop asks for 4.
   *
   * Written out in full because Tailwind reads the source for class names — a
   * built-up `xl:grid-cols-${n}` is never in the stylesheet.
   */
  columns?: 3 | 4
  children: ReactNode
}) {
  // The 4-across variant is only ever used inside BrowseShell, which IS a
  // query container — so it can size itself against the column it sits in
  // rather than the window, which is 17rem wider. The 3-across default is used
  // on pages with no such container, where `@` variants would never match, so
  // it stays on window widths.
  const grid = columns === 4
    ? 'grid grid-cols-1 gap-2.5 @sm:grid-cols-2 @xl:grid-cols-3 @3xl:grid-cols-4'
    : 'grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
  return <div className={view === 'grid' ? grid : 'flex flex-col gap-2.5'}>{children}</div>
}

/**
 * The list, cut into a run of cards per tag.
 *
 * DRAGGING IS OFF IN HERE, and that is the point rather than an omission. The
 * saved order is ONE arrangement of the whole list, and it is what clients see
 * in the booking flow. Inside a section, "move this above that" has no single
 * answer — the two cards may be pages apart in the real order, and a row
 * carrying two tags appears in two sections at once, so a drag in one of them
 * would silently reposition it in the other. Rather than write an order the
 * trainer did not mean, grouping is a way of READING the list and the grips
 * come back the moment it is switched off.
 */
export function OfferingGroups<T>({ rows, tagsOf, tagOrder = [], view, columns, children }: {
  rows: readonly T[]
  tagsOf: (row: T) => readonly TagRef[] | undefined
  /** Tag ids in the trainer's own arrangement, so headings match their tag screen. */
  tagOrder?: readonly string[]
  view: OfferingView
  columns?: 3 | 4
  /** Renders one card. No drag handle is passed — see the note above. */
  children: (row: T) => ReactNode
}) {
  const groups = groupOfferingsByTag(rows, tagsOf, tagOrder)
  return (
    <div className="flex flex-col gap-6">
      {groups.map(group => (
        <section key={group.key}>
          <OfferingGroupHeading label={group.label} count={group.items.length} />
          <OfferingItems view={view} columns={columns}>
            {group.items.map(children)}
          </OfferingItems>
        </section>
      ))}
    </div>
  )
}

/**
 * Current / Past tabs, shared by classes, drop-ins, packages and events.
 *
 * Flat underline tabs, not a pill track. Two reasons: the house style has no
 * chip controls, and the opaque `bg-slate-100` track was the thing that made
 * the description underneath unreadable — a transparent 36px row can't hide
 * anything even if something above it moves. This is the same treatment their
 * own detail screens already use, so a class list and a class now match.
 */
export function OfferingTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  /**
   * `count` is OPTIONAL. It is there for the tabs that filter one list — Current
   * and Past over the same offerings, or the waitlist's four statuses — where
   * "how many are behind this tab?" is the question the trainer is asking.
   *
   * Timesheets' tabs are not that: they are WHOSE timesheets you are looking at,
   * and every one of them has its own list on the other side of a fetch. A
   * number there would either be a lie or a query per team member to print a
   * figure nobody wants.
   */
  tabs: { id: T; label: string; count?: number }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    // The hairline these sit on belongs to OfferingListBar, so the view toggle
    // shares it; `-mb-px` laps the active underline over it.
    //
    // Scrolls sideways rather than running under the add button beside it. Two
    // tabs and a button fit a 390px phone; the waitlist's four do not, and the
    // ones that did not fit were simply invisible underneath it. `no-scrollbar`
    // because a rail here would be the second one on screen.
    <div className="flex gap-5 overflow-x-auto no-scrollbar">
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
          className={`-mb-px shrink-0 border-b-2 py-2 text-sm font-medium transition-colors ${
            value === t.id
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 text-[11px] font-normal tabular-nums text-slate-400">{t.count}</span>
          )}
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
