'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
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

/** A small uppercase caption above a block. */
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
  className?: string
}

/** One row inside a FlatBlock. */
export function FlatRow({ icon: Icon, label, sub, href, onClick, trailing, accent, className }: RowProps) {
  const inner = (
    <>
      {Icon && (
        <Icon
          className="h-[18px] w-[18px] flex-shrink-0 text-slate-700"
          style={iconStyle(accent)}
          strokeWidth={1.75}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{label}</span>
        {sub && <span className="mt-0.5 block truncate text-[13px] text-slate-500">{sub}</span>}
      </span>
      {trailing ?? ((href || onClick) && <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />)}
    </>
  )
  const cls = cn('flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50', className)

  if (href) return <Link href={href} className={cls}>{inner}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>
  return <div className={cls}>{inner}</div>
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
}: {
  icon: LucideIcon
  label: string
  sub?: string
  href?: string
  onClick?: () => void
  accent?: string
}) {
  const inner = (
    <>
      <Icon className="h-[22px] w-[22px] text-slate-700" style={iconStyle(accent)} strokeWidth={1.75} />
      <span className="mt-2.5 block text-[15px] font-semibold leading-tight text-slate-900">{label}</span>
      {sub && <span className="mt-1 block text-[13px] leading-tight text-slate-500">{sub}</span>}
    </>
  )
  const cls = 'flex min-h-[104px] flex-col items-start justify-center px-4 py-4 text-left active:bg-slate-50'

  if (href) return <Link href={href} className={cls}>{inner}</Link>
  return <button type="button" onClick={onClick} className={cls}>{inner}</button>
}
