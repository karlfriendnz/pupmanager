'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Package, Database, ClipboardList, Mail, Ticket, type LucideIcon } from 'lucide-react'

// Shared admin tab list — rendered as a horizontal top bar on desktop
// (AdminTabNav) and as a fixed bottom bar on mobile (AdminBottomNav).
// `match` overrides the active-state prefix: the Onboarding tab spans three
// sibling routes (-steps / -emails / -funnel), so it highlights for the whole
// /admin/onboarding namespace, not just its landing href. `short` is a compact
// label for the narrow mobile bottom bar.
export type AdminTab = {
  href: string
  label: string
  short?: string
  icon: LucideIcon
  match?: string
}

export const ADMIN_TABS: AdminTab[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/trainers', label: 'Trainers', icon: Users },
  { href: '/admin/onboarding-steps', label: 'Onboarding', short: 'Onboard', icon: Mail, match: '/admin/onboarding' },
  { href: '/admin/plans', label: 'Plans', icon: Package },
  { href: '/admin/promo-codes', label: 'Promo codes', short: 'Promos', icon: Ticket },
  { href: '/admin/demo', label: 'Demo data', short: 'Demo', icon: Database },
  { href: '/admin/status', label: 'Status', icon: ClipboardList },
]

// Active-state test shared by both nav renderers.
export function isAdminTabActive(tab: AdminTab, pathname: string): boolean {
  if (tab.match) return pathname.startsWith(tab.match)
  if (tab.href === '/admin') return pathname === '/admin'
  return pathname === tab.href || pathname.startsWith(tab.href + '/')
}

export function AdminTabNav() {
  const pathname = usePathname()

  return (
    // Horizontally scrollable safety net (desktop is wide enough for all seven,
    // but a narrow desktop window shouldn't push Sign out off-screen);
    // scrollbar hidden so it reads as a clean strip.
    <nav className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {ADMIN_TABS.map(tab => {
        const active = isAdminTabActive(tab, pathname)
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
