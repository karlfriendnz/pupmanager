'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ADMIN_TABS, isAdminTabActive } from './admin-tab-nav'

// Fixed, app-style bottom tab bar for mobile. Mirrors the trainer/client app's
// mobile navigation (see app-shell.tsx) but adapted to the dark admin theme.
// Hidden at md+, where the top bar's AdminTabNav takes over.
export function AdminBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-700 bg-slate-800/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex">
        {ADMIN_TABS.map(tab => {
          const active = isAdminTabActive(tab, pathname)
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2 transition-colors',
                active ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-blue-500" />
              )}
              <Icon className={cn('h-5 w-5 shrink-0 transition-transform', active && 'scale-110')} strokeWidth={active ? 2.4 : 2} />
              <span className="w-full truncate px-0.5 text-center text-[10px] font-medium leading-none">
                {tab.short ?? tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
