'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ADMIN_TABS, isAdminTabActive } from './admin-tab-nav'

// Fixed, app-style bottom tab bar for mobile. Mirrors the trainer/client app's
// mobile navigation (see app-shell.tsx) but adapted to the dark admin theme.
// Hidden at md+, where the top bar's AdminTabNav takes over.
//
// Only three destinations are pinned so each tap target is wide and reliable;
// everything else lives behind "More". Kept as hrefs so ADMIN_TABS stays the
// single source of truth for both nav renderers.
const PRIMARY_HREFS = ['/admin', '/admin/trainers', '/admin/promo-codes']

export function AdminBottomNav() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  // Selecting a sheet item navigates (client-side), so close on route change.
  useEffect(() => { setMoreOpen(false) }, [pathname])

  const primary = PRIMARY_HREFS
    .map(h => ADMIN_TABS.find(t => t.href === h))
    .filter((t): t is (typeof ADMIN_TABS)[number] => Boolean(t))
  const overflow = ADMIN_TABS.filter(t => !PRIMARY_HREFS.includes(t.href))
  const overflowActive = overflow.some(t => isAdminTabActive(t, pathname))

  return (
    <>
      {/* "More" overflow sheet + tap-to-dismiss backdrop */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setMoreOpen(false)} />
      )}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-x-0 z-50 rounded-t-2xl border-t border-slate-700 bg-slate-800 p-2 shadow-2xl"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 3.5rem)' }}
        >
          {overflow.map(tab => {
            const active = isAdminTabActive(tab, pathname)
            const Icon = tab.icon
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors',
                  active ? 'bg-slate-700/70 text-white' : 'text-slate-300 hover:bg-slate-700/40',
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {tab.label}
              </Link>
            )
          })}
        </div>
      )}

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-slate-700 bg-slate-800/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {primary.map(tab => {
            // Dim the pinned active state while the sheet is open so "More" reads
            // as the current context.
            const active = isAdminTabActive(tab, pathname) && !moreOpen
            const Icon = tab.icon
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'relative flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors',
                  active ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200',
                )}
              >
                {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-blue-500" />}
                <Icon className={cn('h-6 w-6 shrink-0 transition-transform', active && 'scale-110')} strokeWidth={active ? 2.4 : 2} />
                <span className="text-[11px] font-medium leading-none">{tab.short ?? tab.label}</span>
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(o => !o)}
            aria-expanded={moreOpen}
            className={cn(
              'relative flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors',
              moreOpen || overflowActive ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200',
            )}
          >
            {overflowActive && !moreOpen && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-blue-500" />
            )}
            <MoreHorizontal className={cn('h-6 w-6 shrink-0 transition-transform', moreOpen && 'scale-110')} strokeWidth={moreOpen ? 2.4 : 2} />
            <span className="text-[11px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
