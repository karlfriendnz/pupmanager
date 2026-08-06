'use client'

import { useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The tab strip on an offering detail screen — a class run, a one-off event, a
 * 1:1 session package. All three pages carried a byte-identical copy of this
 * markup, so a fix to one silently left the other two behind; this is that
 * markup, once.
 *
 * PHONE, up to four tabs: icon on top, label underneath, the row split evenly.
 * The labels here are long ("Reminders & messages"), and beside a 16px icon
 * they pushed the strip into a sideways scroll at 390px — so the last tab
 * existed with nothing on screen to say so. Stacked, every tab is visible and
 * tappable. This is the same shape the client profile uses, deliberately.
 *
 * PHONE, five or more: an even split stops working — the package builder's five
 * ("Details · Included · Appearance · Who it's for · Automation") get 70px each
 * and "Who it's for" breaks across three lines. So past four the strip scrolls
 * sideways instead, each tab at a readable width. It is the COUNT that decides,
 * not the caller: the failure is a function of how many tabs there are, and no
 * screen should have to discover it the way Karl did ("bit messy").
 *
 * sm AND UP: the original horizontal strip (icon beside label), which reads
 * better once there's room for it. It has always scrolled.
 *
 * Either way, the ACTIVE tab is scrolled into view. A strip that scrolls but
 * opens with the current tab off-screen is the version that feels broken —
 * nothing tells you the row moves, and the thing you are looking at is not on
 * it.
 */

export type OfferingTab<T extends string> = {
  id: T
  label: string
  icon: LucideIcon
  /** Count shown on the tab, e.g. how many clients are enrolled. */
  badge?: number
}

export function OfferingTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  label,
}: {
  tabs: OfferingTab<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
  /** Names the tablist for a screen reader, e.g. "Package sections". */
  label?: string
}) {
  const phoneBox = useRef<HTMLDivElement>(null)
  const wideBox = useRef<HTMLDivElement>(null)

  // Past four, an even split is narrower than the words even at full width.
  const scrolls = tabs.length > 4

  useEffect(() => {
    for (const box of [phoneBox.current, wideBox.current]) {
      // One of the two strips is display:none at any width — it has no
      // geometry, and scrolling it would be scrolling the wrong row.
      if (!box || box.clientWidth === 0) continue
      if (box.scrollWidth <= box.clientWidth) continue
      const el = box.querySelector<HTMLElement>('[data-tab-active="true"]')
      if (!el) continue
      // Measured rect-to-rect rather than offsetLeft: the wide strip nests the
      // buttons inside an inline-flex track, so offsetParent is not the box.
      const boxRect = box.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const delta = elRect.left - boxRect.left - (boxRect.width - elRect.width) / 2
      box.scrollTo({ left: Math.max(0, box.scrollLeft + delta), behavior: 'smooth' })
    }
  }, [value])

  return (
    // role="tab", not aria-current: aria-current="page" says "this is the page
    // you are on in a set of LINKS", and these switch a panel in place. It is
    // also what every other tab strip in this app announces, and what the specs
    // reach for.
    <div className={cn('mb-6', className)} role="tablist" aria-label={label}>
      {/* Phone — icon over label. Evenly split up to four, scrolling past that. */}
      <div
        ref={phoneBox}
        // ALWAYS scrollable, even in the even-split mode. The split is only
        // even if the box is as wide as the screen, and it is not always: this
        // strip shares a row with a tab's own actions on the offering detail
        // screen, which squeezed it to 239px and clipped "Homework" and
        // "Automation" inside their own columns. A minimum width per tab plus
        // somewhere to scroll means the words survive the container, whatever
        // the container turns out to be.
        className="sm:hidden flex gap-1 p-1 bg-slate-100 rounded-2xl overflow-x-auto no-scrollbar"
      >
        {tabs.map(t => {
          const Icon = t.icon
          const active = value === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-tab-active={active}
              onClick={() => onChange(t.id)}
              className={cn(
                'relative min-w-0 flex flex-col items-center justify-start gap-1 px-1 py-2 rounded-xl transition-all duration-150',
                scrolls ? 'shrink-0 basis-[5.5rem]' : 'flex-1 min-w-[4.5rem]',
                active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
              <span className="block w-full text-[11px] font-medium leading-tight text-center">
                {t.label}
              </span>
              {/* The count keeps its own corner rather than sitting after a
                  label that may wrap — it has to stay readable either way. */}
              {t.badge != null && (
                <span
                  className={cn(
                    'absolute top-1 right-1 min-w-4 h-4 px-1 text-[10px] font-semibold tabular-nums rounded-full flex items-center justify-center',
                    active ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600',
                  )}
                >
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* sm and up — the horizontal strip. */}
      <div ref={wideBox} className="hidden sm:block overflow-x-auto no-scrollbar">
        <div className="inline-flex gap-1 p-1 bg-slate-100 rounded-2xl">
          {tabs.map(t => {
            const Icon = t.icon
            const active = value === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-tab-active={active}
                onClick={() => onChange(t.id)}
                className={cn(
                  'relative shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150',
                  active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
                {t.label}
                {t.badge != null && (
                  <span
                    className={cn(
                      'min-w-4 h-4 px-1 text-[10px] font-semibold tabular-nums rounded-full flex items-center justify-center',
                      active ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600',
                    )}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
