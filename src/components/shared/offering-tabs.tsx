'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * The tab strip on an offering detail screen — a class run, a one-off event, a
 * 1:1 consult package. All three pages carried a byte-identical copy of this
 * markup, so a fix to one silently left the other two behind; this is that
 * markup, once.
 *
 * PHONE: icon on top, label underneath, the row split evenly. The labels here
 * are long ("Reminders & messages"), and beside a 16px icon they pushed the
 * strip into a sideways scroll at 390px — so the last tab existed with nothing
 * on screen to say so. Stacked, every tab is visible and tappable. This is the
 * same shape the client profile uses for its own strip, deliberately.
 *
 * sm AND UP: the original horizontal strip (icon beside label), which reads
 * better once there's room for it.
 */

export type OfferingTab<T extends string> = {
  id: T
  label: string
  icon: LucideIcon
  /** Count shown on the tab, e.g. how many clients are enrolled. */
  badge?: number
  /**
   * Navigate instead of switching in place. The offering screens swap tabs
   * client-side; the clients list is a server render per view, so its tabs are
   * real links — same strip, same behaviour at 390px, one copy of the markup.
   */
  href?: string
}

export function OfferingTabs<T extends string>({
  tabs,
  value,
  onChange,
  fullWidth = false,
  stackedAlways = false,
  className,
}: {
  tabs: OfferingTab<T>[]
  value: T
  /** Omitted when every tab carries an href — there is nothing to switch. */
  onChange?: (id: T) => void
  /**
   * Stretch the strip to fill its container, splitting the width evenly.
   * The offering screens keep the default — their strips sit above a card and
   * a full-width row of four would leave the labels swimming in space. A list
   * page's tabs ARE the page header, so they span it.
   */
  fullWidth?: boolean
  /**
   * Keep the phone layout — icon on top, label under it, count in the corner —
   * at every size, instead of switching to the horizontal strip at sm.
   *
   * This is the shape the client profile uses, and with only three or four tabs
   * it reads better than a row of prose: the labels stop competing with their
   * counts for the same line, which is what made the clients strip wrap into
   * rubble at 390px.
   */
  stackedAlways?: boolean
  className?: string
}) {
  // One element type for both modes, so the two strips can't drift apart.
  const Tab = ({ t, children, className: cls }: { t: OfferingTab<T>; children: React.ReactNode; className: string }) =>
    t.href ? (
      <Link href={t.href} aria-current={value === t.id ? 'page' : undefined} className={cls}>
        {children}
      </Link>
    ) : (
      <button
        type="button"
        onClick={() => onChange?.(t.id)}
        aria-current={value === t.id ? 'page' : undefined}
        className={cls}
      >
        {children}
      </button>
    )
  return (
    <div className={cn('mb-6', className)}>
      {/* Icon over label, evenly split, nothing off-screen. Always on a phone;
          at every size when the caller asks for it. */}
      <div className={cn('flex gap-1 p-1 bg-slate-100 rounded-2xl', !stackedAlways && 'sm:hidden')}>
        {tabs.map(t => {
          const Icon = t.icon
          const active = value === t.id
          return (
            <Tab
              key={t.id}
              t={t}
              className={cn(
                'relative flex-1 min-w-0 flex flex-col items-center justify-start gap-1 px-1 py-2 rounded-xl transition-all duration-150',
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
            </Tab>
          )
        })}
      </div>

      {/* sm and up — the horizontal strip. Skipped entirely when the stacked
          shape is being kept at every size, or the two would both render. */}
      {!stackedAlways && (
      <div className={cn(
        'hidden sm:block [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // Only a hugging strip can overflow; a full-width one divides the space
        // it already has, so the scroll container would do nothing but hide a
        // rail. (Never two scrollbars on screen.)
        fullWidth ? '' : 'overflow-x-auto',
      )}>
        <div className={cn('gap-1 p-1 bg-slate-100 rounded-2xl', fullWidth ? 'flex' : 'inline-flex')}>
          {tabs.map(t => {
            const Icon = t.icon
            const active = value === t.id
            return (
              <Tab
                key={t.id}
                t={t}
                className={cn(
                  'relative flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-150',
                  fullWidth ? 'flex-1 min-w-0' : 'shrink-0',
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
              </Tab>
            )
          })}
        </div>
      </div>
      )}
    </div>
  )
}
