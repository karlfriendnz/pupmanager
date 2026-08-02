'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Children, Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The house style, as components.
 *
 * Every screen kept re-deriving the same border/divider classes and drifting —
 * one would grow a shadow, another a tinted icon chip, and the app stopped
 * looking like one product. These are the shapes that survived Karl's review of
 * the phone home screen:
 *
 *   • one bordered block, hairline dividers between rows — not a stack of
 *     floating cards
 *   • plain line icons, no coloured tile behind them
 *   • the trainer's brand colour on icons only, everything else neutral
 *
 * See AGENTS.md "Mobile-first look".
 */

/** Icon tone for a row/tile. Pass the trainer's accent to tint; omit for slate. */
function iconStyle(accent?: string) {
  return accent
    ? { color: `color-mix(in srgb, ${accent} 78%, #0f172a)` }
    : undefined
}

/**
 * Turns a list of rows into ONE block on phones, with hairline dividers, and
 * dissolves on desktop so the rows keep whatever card styling they had.
 *
 * This is the app's most-repeated mobile shape — clients, messages, threads,
 * sessions. Hand-rolled, it kept coming out as a stack of floating "chips",
 * each with its own border, shadow and gap.
 *
 * The dividers are real 1px elements rather than border utilities on purpose:
 * a row's own `border-0` cancels a `border-b` (same specificity, later rule
 * wins), and a wrapper's `border-t` gets painted over by a child card sitting
 * flush against it. An element can't be swallowed by either.
 */
export function PhoneRowList({ children, className }: { children: ReactNode; className?: string }) {
  const rows = Children.toArray(children)
  return (
    <div className={cn(
      'overflow-hidden rounded-xl border border-slate-200 bg-white',
      'md:contents md:rounded-none md:border-0',
      className,
    )}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 && <div className="h-px bg-slate-200 md:hidden" aria-hidden />}
          {row}
        </Fragment>
      ))}
    </div>
  )
}

/** A small uppercase caption above a block. */
/**
 * A section heading with its action on the SAME line.
 *
 * Without this the action sits in a row of its own above the heading, which
 * pushes that column's content down — and in a two-column screen like the
 * Library the two sides then start at different heights for no reason a reader
 * can see.
 */
export function SectionHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex h-9 items-center justify-between gap-3">
      <p className="px-1 text-xs font-medium uppercase tracking-wide text-slate-400">{children}</p>
      {action}
    </div>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
      {children}
    </p>
  )
}

/**
 * One bordered block. Children are separated by hairlines automatically, so
 * callers just render rows.
 */
export function FlatBlock({
  children,
  className,
  tone,
}: {
  children: ReactNode
  className?: string
  /** 'accent' tints the block for a "needs you" strip. Pass the brand colour. */
  tone?: { accent: string }
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-white',
        tone ? '' : 'border-slate-200',
        '[&>*+*]:border-t [&>*+*]:border-slate-200',
        className,
      )}
      style={tone ? {
        background: `color-mix(in srgb, ${tone.accent} 7%, #ffffff)`,
        borderColor: `color-mix(in srgb, ${tone.accent} 22%, #ffffff)`,
      } : undefined}
    >
      {children}
    </div>
  )
}

type RowProps = {
  icon?: LucideIcon
  label: ReactNode
  /** Second line — a count, a hint, whatever the row is worth knowing for. */
  sub?: ReactNode
  href?: string
  onClick?: () => void
  /** Right-hand side. Defaults to a chevron when the row navigates. */
  trailing?: ReactNode
  /** The trainer's brand colour, for the icon. */
  accent?: string
  /** Marks where you already are — used by the menu. */
  active?: boolean
  /** Greyed and inert, with a "Soon" tag. */
  comingSoon?: boolean
  className?: string
  /**
   * The grip a reorderable row is dragged by, in a gutter down its LEFT edge.
   * Rendered as a SIBLING of the row's link — a button inside an anchor is
   * invalid markup, and the browser hands the drag's pointer events to the
   * navigation.
   */
  dragHandle?: ReactNode
}

/** One row inside a FlatBlock. */
export function FlatRow({ icon: Icon, label, sub, href, onClick, trailing, accent, active, comingSoon, className, dragHandle }: RowProps) {
  const inner = (
    <>
      {Icon && (
        <Icon
          className={cn(
            'h-[18px] w-[18px] flex-shrink-0',
            comingSoon ? 'text-slate-300' : active ? 'text-blue-600' : 'text-slate-700',
          )}
          style={active || comingSoon ? undefined : iconStyle(accent)}
          strokeWidth={1.75}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn(
          'block truncate text-sm font-medium',
          comingSoon ? 'text-slate-400' : active ? 'text-blue-700' : 'text-slate-900',
        )}>
          {label}
        </span>
        {sub && <span className="mt-0.5 block truncate text-[13px] text-slate-500">{sub}</span>}
      </span>
      {comingSoon
        ? <span className="flex-shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">Soon</span>
        : trailing ?? ((href || onClick) && <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />)}
    </>
  )

  if (comingSoon) {
    return <div className={cn('flex w-full items-center gap-3 px-4 py-3.5', className)}>{inner}</div>
  }
  const cls = cn(
    'flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50',
    // The grip already supplies the row's left inset.
    dragHandle && 'pl-1',
    className,
  )

  const row = href
    ? <Link href={href} className={cls}>{inner}</Link>
    : onClick
      ? <button type="button" onClick={onClick} className={cls}>{inner}</button>
      : <div className={cls}>{inner}</div>

  if (!dragHandle) return row
  return (
    <div className="flex items-center">
      <span className="flex-shrink-0 pl-2">{dragHandle}</span>
      <span className="min-w-0 flex-1">{row}</span>
    </div>
  )
}

/**
 * Two-up grid of COMPACT rows (icon beside label, not above it) in one block.
 *
 * For menus long enough that one column scrolls — twenty destinations at row
 * height, two across, keeps the sections visible without turning each entry
 * into a tile.
 */
export function FlatRowGrid({ children, count }: { children: ReactNode; count: number }) {
  return (
    <div className={cn(
      'grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white',
      '[&>*]:border-b [&>*]:border-r [&>*]:border-slate-200',
      '[&>*:nth-child(2n)]:border-r-0',
      count % 2 === 0 ? '[&>*:nth-last-child(-n+2)]:border-b-0' : '[&>*:last-child]:border-b-0',
    )}>
      {children}
    </div>
  )
}

/**
 * Two-up button grid in one block — the phone home's six, the settings menu.
 * The nth-child rules drop the outer edges so only internal lines show.
 */
export function FlatTileGrid({ children, count }: { children: ReactNode; count: number }) {
  return (
    <div className={cn(
      'grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white',
      '[&>*]:border-b [&>*]:border-r [&>*]:border-slate-200',
      '[&>*:nth-child(2n)]:border-r-0',
      // Last row keeps no bottom edge — one cell or two, depending on the count.
      count % 2 === 0 ? '[&>*:nth-last-child(-n+2)]:border-b-0' : '[&>*:last-child]:border-b-0',
    )}>
      {children}
    </div>
  )
}

/** One button in a FlatTileGrid. */
export function FlatTile({
  icon: Icon,
  label,
  sub,
  href,
  onClick,
  accent,
  dragHandle,
}: {
  icon: LucideIcon
  label: string
  sub?: string
  href?: string
  onClick?: () => void
  accent?: string
  /**
   * The grip a reorderable tile is dragged by. Given one, the tile grows a
   * gutter down its LEFT edge for it — a tile is one target from edge to edge,
   * so the grip needs room of its own rather than a corner it shares with the
   * icon.
   */
  dragHandle?: ReactNode
}) {
  const inner = (
    <>
      <Icon className="h-[22px] w-[22px] text-slate-700" style={iconStyle(accent)} strokeWidth={1.75} />
      <span className="mt-2.5 block text-[15px] font-semibold leading-tight text-slate-900">{label}</span>
      {sub && <span className="mt-1 block text-[13px] leading-tight text-slate-500">{sub}</span>}
    </>
  )
  const cls = cn(
    'flex min-h-[104px] flex-col items-start justify-center px-4 py-4 text-left active:bg-slate-50',
    dragHandle && 'pl-9',
  )

  const tile = href
    ? <Link href={href} className={cls}>{inner}</Link>
    : <button type="button" onClick={onClick} className={cls}>{inner}</button>

  if (!dragHandle) return tile
  // The grip sits OUTSIDE the link. A button nested in an anchor is invalid
  // markup, and the browser hands the drag's pointer events to the navigation.
  return (
    <div className="relative">
      <span className="absolute left-1 top-1 z-10">{dragHandle}</span>
      {tile}
    </div>
  )
}
