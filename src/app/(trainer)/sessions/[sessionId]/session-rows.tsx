import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Server-side rows for the session screen, in the house style.
 *
 * These deliberately mirror `FlatRow` in shared/flat-list.tsx — same paddings,
 * same 18px line icon tinted with the trainer's accent via color-mix toward
 * #0f172a. They exist because that primitive is a CLIENT component, and a
 * server component can't hand it a Lucide icon (React refuses to serialise a
 * component across the boundary), nor can it hold children. This page is a
 * server component, so it needs row shapes it can render itself. Anything
 * structural should still change in flat-list.tsx first.
 */

function iconStyle(accent?: string | null) {
  return accent ? { color: `color-mix(in srgb, ${accent} 78%, #0f172a)` } : undefined
}

const ROW = 'flex w-full items-center gap-3 px-4 py-3.5 text-left'

function RowBody({
  icon: Icon,
  label,
  sub,
  accent,
  trailing,
}: {
  icon: LucideIcon
  label: ReactNode
  sub?: ReactNode
  accent?: string | null
  trailing?: ReactNode
}) {
  return (
    <>
      <Icon
        className="h-[18px] w-[18px] flex-shrink-0 text-slate-700"
        style={iconStyle(accent)}
        strokeWidth={1.75}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{label}</span>
        {sub && <span className="mt-0.5 block truncate text-[13px] text-slate-500">{sub}</span>}
      </span>
      {trailing}
    </>
  )
}

/** A fact — date, time, where. Reads, doesn't act. */
export function FactRow(props: {
  icon: LucideIcon
  label: ReactNode
  sub?: ReactNode
  accent?: string | null
}) {
  return <div className={ROW}><RowBody {...props} /></div>
}

/** A row that goes somewhere. `external` opens in a new tab. */
export function LinkRow({
  href,
  external,
  trailingLabel,
  ...rest
}: {
  icon: LucideIcon
  label: ReactNode
  sub?: ReactNode
  accent?: string | null
  href: string
  external?: boolean
  /** Replaces the chevron — e.g. "Join" on a virtual-session link. */
  trailingLabel?: string
}) {
  const trailing = trailingLabel
    ? <span className="flex-shrink-0 text-[13px] text-slate-500">{trailingLabel}</span>
    : <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`${ROW} active:bg-slate-50`}>
        <RowBody {...rest} trailing={trailing} />
      </a>
    )
  }
  return (
    <Link href={href} className={`${ROW} active:bg-slate-50`}>
      <RowBody {...rest} trailing={trailing} />
    </Link>
  )
}

/**
 * A row that opens.
 *
 * An empty section must cost ONE row, not a whole bordered card with a heading
 * and padding (AGENTS.md: aggregate, don't fragment). So every secondary
 * section of the session screen — photos, homework, time, previous notes —
 * renders as a row inside the same block, carrying its own count in the
 * subline, and only unfolds when there's something to see or the trainer taps.
 *
 * Plain <details>, so it costs no JavaScript and works before hydration.
 */
export function DisclosureRow({
  icon: Icon,
  label,
  sub,
  accent,
  defaultOpen = false,
  children,
}: {
  icon: LucideIcon
  label: string
  sub?: ReactNode
  accent?: string | null
  /** Sections that already hold something open themselves; empty ones stay shut. */
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 active:bg-slate-50">
        <Icon
          className="h-[18px] w-[18px] flex-shrink-0 text-slate-700"
          style={iconStyle(accent)}
          strokeWidth={1.75}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900">{label}</span>
          {sub && <span className="mt-0.5 block truncate text-[13px] text-slate-500">{sub}</span>}
        </span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-200 px-4 py-4">{children}</div>
    </details>
  )
}
