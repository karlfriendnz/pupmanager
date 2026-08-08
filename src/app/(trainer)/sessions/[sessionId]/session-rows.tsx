import Link from 'next/link'
import { ChevronDown, ChevronRight, MessageSquare, Phone, User } from 'lucide-react'
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

/**
 * The look of the session screen's full-width action buttons — one per row, a
 * line icon and a label. Exported so the client-side buttons (Complete,
 * Invoice, Take payment) render identically to the server-side links beside
 * them: they sit in one stack, so a difference of a pixel reads as two kinds
 * of thing.
 *
 * Height comes from PADDING (Karl: "can we add top and bottom padding to the
 * buttons"), which also lets a button with a subline grow rather than crop it.
 * A fixed 112px was tried first and reverted.
 *
 * Note for whoever changes it next: `min-h-…` does NOTHING here. globals.css
 * sets `button, a { min-height: 44px }` UNLAYERED, and unlayered CSS beats
 * Tailwind's utilities layer — so a min-height utility on these is silently
 * thrown away. Use padding, or a plain height (`h-14`), if you mean it.
 */
export const ACTION_BUTTON =
  'flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-5 text-left text-[15px] font-medium text-slate-900 transition-colors hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60'

/**
 * A full-width action button that goes somewhere. Server-side, because a
 * server component cannot hand a Lucide icon to a client one — the same
 * boundary this file exists for.
 */
export function ActionLinkButton({
  href,
  icon: Icon,
  label,
  sub,
  accent,
}: {
  href: string
  icon: LucideIcon
  label: string
  sub?: string | null
  accent?: string | null
}) {
  return (
    <Link href={href} className={ACTION_BUTTON}>
      <Icon className="h-5 w-5 flex-shrink-0 text-slate-700" style={iconStyle(accent)} strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sub && <span className="mt-0.5 block truncate text-[13px] font-normal text-slate-500">{sub}</span>}
      </span>
    </Link>
  )
}

/**
 * The one action this screen is FOR, as a filled brand button.
 *
 * Six identical white rows had no shape — nothing on the screen said which
 * one you were meant to press (Karl: "I am liking this but it's just not
 * there yet"). One filled button answers that in the only way a glance can
 * read, and it is the only paint on the page: colour is the trainer's and it
 * is rationed (AGENTS.md).
 */
export function PrimaryActionButton({
  href,
  icon: Icon,
  label,
  sub,
}: {
  href: string
  icon: LucideIcon
  label: string
  sub?: string | null
}) {
  return (
    <Link
      href={href}
      className="flex w-full items-center gap-3 rounded-xl bg-[var(--pm-brand-600)] px-4 py-5 text-left text-[15px] font-semibold text-white transition-colors hover:bg-[var(--pm-brand-700)] active:bg-[var(--pm-brand-700)]"
    >
      <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sub && <span className="mt-0.5 block truncate text-[13px] font-normal text-white/80">{sub}</span>}
      </span>
    </Link>
  )
}

/**
 * Message, call, profile — the three ways to reach the person whose dog this
 * is (Karl: "I think we need to have the contact controls on here").
 *
 * A divided strip under the identity row, because they belong to the PERSON
 * named above them, not to the session's list of jobs. Call only appears when
 * there is a number: a `tel:` link to nothing is a dead end wearing a phone
 * icon (the same rule the calendar popover used).
 */
export function ContactStrip({
  clientId,
  phone,
  accent,
}: {
  clientId: string
  phone?: string | null
  accent?: string | null
}) {
  const cell =
    'flex min-h-[52px] flex-col items-center justify-center gap-1 px-2 py-2.5 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100'
  return (
    <div className={`grid ${phone ? 'grid-cols-3' : 'grid-cols-2'} divide-x divide-slate-200 border-t border-slate-200`}>
      <Link href={`/messages?client=${clientId}`} className={cell}>
        <MessageSquare className="h-[18px] w-[18px]" style={iconStyle(accent)} strokeWidth={1.75} />
        <span>Message</span>
      </Link>
      {phone && (
        <a href={`tel:${phone.replace(/\s+/g, '')}`} className={cell}>
          <Phone className="h-[18px] w-[18px]" style={iconStyle(accent)} strokeWidth={1.75} />
          <span>Call</span>
        </a>
      )}
      <Link href={`/clients/${clientId}`} className={cell}>
        <User className="h-[18px] w-[18px]" style={iconStyle(accent)} strokeWidth={1.75} />
        <span>Profile</span>
      </Link>
    </div>
  )
}
