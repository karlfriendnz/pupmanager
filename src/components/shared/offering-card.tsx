'use client'

import { type ReactNode } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'

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
    <div className="flex min-w-0 flex-1 items-start gap-3">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
      ) : tile ? (
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tile.className ?? 'bg-blue-50 text-blue-600'}`}>
          {tile.icon}
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
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

        {description && (
          <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{description}</p>
        )}

        {/* The facts. Chips rather than a "·"-joined string so each one keeps
            its icon and can carry its own colour (full / spaces left). They
            wrap individually, which is what makes this read on a phone. */}
        {facts.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {facts.map((f, i) => (
              <span key={i} className={`inline-flex items-center gap-1.5 text-xs ${FACT_TONE[f.tone ?? 'default']}`}>
                <span className="shrink-0 opacity-70">{f.icon}</span>
                {f.label}
              </span>
            ))}
          </div>
        )}

        {note && <p className={`mt-1.5 text-xs font-medium ${FACT_TONE[note.tone ?? 'warn']}`}>{note.label}</p>}
      </div>
    </div>
  )

  return (
    <div
      className={`group flex items-start gap-2 rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_8px_rgba(15,31,36,0.04)] transition-colors hover:border-blue-200 ${dimmed ? 'opacity-60' : ''}`}
    >
      {dragHandle}
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-start gap-3">{body}</Link>
      ) : (
        body
      )}

      {actions.length > 0 && (
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
      )}
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
    <div className="mb-1.5 flex gap-1 rounded-2xl bg-slate-100 p-1 sm:inline-flex sm:self-start">
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
            value === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
          <span
            className={`min-w-5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
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

/** The dashed "add" affordance that closes every offering list. */
export function AddOfferingLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-3.5 text-sm font-medium text-slate-500 transition-colors hover:border-blue-300 hover:text-blue-600"
    >
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
  action?: { href: string; label: string }
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_8px_rgba(15,31,36,0.04)]">
      <div className="flex flex-col items-center px-4 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">{icon}</div>
        <p className="mt-4 font-medium text-slate-700">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-slate-400">{body}</p>
        {action && (
          <Link
            href={action.href}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> {action.label}
          </Link>
        )}
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

/** The page's content column — same width and padding on all four lists. */
export function OfferingPage({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:max-w-5xl md:p-8 xl:max-w-7xl">
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  )
}
