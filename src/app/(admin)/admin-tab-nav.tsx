'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Package, Database, ClipboardList, Mail, Ticket } from 'lucide-react'

// `match` (optional) overrides the active-state prefix — the Onboarding tab
// spans three sibling routes (-steps / -emails / -funnel), so it highlights for
// the whole /admin/onboarding namespace, not just its landing href.
const TABS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/trainers', label: 'Trainers', icon: Users },
  { href: '/admin/onboarding-steps', label: 'Onboarding', icon: Mail, match: '/admin/onboarding' },
  { href: '/admin/plans', label: 'Plans', icon: Package },
  { href: '/admin/promo-codes', label: 'Promo codes', icon: Ticket },
  { href: '/admin/demo', label: 'Demo data', icon: Database },
  { href: '/admin/status', label: 'Status', icon: ClipboardList },
] as const

export function AdminTabNav() {
  const pathname = usePathname()

  return (
    // Horizontally scrollable on mobile (the seven tabs don't fit a phone
    // width); scrollbar hidden so it reads as a clean swipe strip.
    <nav className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map(tab => {
        const match = 'match' in tab ? (tab as { match?: string }).match : undefined
        const active = match
          ? pathname.startsWith(match)
          : tab.href === '/admin'
            ? pathname === '/admin'
            : pathname === tab.href || pathname.startsWith(tab.href + '/')
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              active
                ? 'bg-slate-700/60 text-white'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/30'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {tab.label}
            {active && (
              // bottom-0 (inside the link box) instead of -bottom-[15px] so the
              // indicator isn't clipped by the nav's horizontal-scroll overflow.
              <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-blue-500 rounded-full" />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
