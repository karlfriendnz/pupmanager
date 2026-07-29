'use client'

import Link from 'next/link'
import type { ClientView } from '@/lib/client-activity'

/**
 * The clients list's tab strip: ONE flat block split by hairlines — the house
 * pattern (see schedule/reschedule-banner.tsx, and AGENTS.md: "related things
 * live in ONE bordered block split by 1px lines").
 *
 * Deliberately NOT OfferingTabs. That component is the grey pill strip the
 * offering detail screens wear, and bending it into this shape took a
 * `fullWidth` flag, a `stackedAlways` flag and a rewrite of its badge — three
 * switches only one caller would ever set, on a component shared by five
 * screens. Two honest shapes beat one component with a mode for each.
 *
 * What that detour taught, and what this keeps:
 *   • the row splits evenly, so the longest label can't set the width of the
 *     rest — "In class now  18" wrapping onto two lines is what started this;
 *   • the count is a plain number, not a tinted chip. Four coloured pills on
 *     four tabs is four pieces of decoration competing with the labels;
 *   • every tab is on screen at 390px, and nothing scrolls sideways.
 *
 * Real links, not buttons: each view is its own server render, so the URL is
 * the state and a middle-click opens one in a tab like anything else.
 */
export function ClientViewTabs({
  tabs,
  value,
  className = '',
}: {
  tabs: { id: ClientView; label: string; href: string }[]
  value: ClientView
  className?: string
}) {
  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 bg-white ${className}`}>
      <div className="flex items-stretch text-sm font-medium [&>*+*]:border-l [&>*+*]:border-slate-200">
        {tabs.map(t => {
          const active = t.id === value
          return (
            <Link
              key={t.id}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={[
                'min-h-11 flex-1 min-w-0 px-2 py-2.5 flex items-center justify-center gap-1.5 text-center transition-colors',
                active
                  // The trainer's own colour, spent on the one thing that needs it.
                  ? 'text-[var(--pm-brand-700)] bg-[var(--pm-brand-50)]/50'
                  : 'text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              {/* No count. The number beside a tab is a fact about a list you
                  aren't looking at, and four of them turned the row into an
                  arithmetic problem. The list itself says how many there are. */}
              <span className="leading-tight">{t.label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
