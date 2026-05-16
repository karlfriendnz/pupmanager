'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Package, Database, ClipboardList } from 'lucide-react'

const TABS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/trainers', label: 'Trainers', icon: Users },
  { href: '/admin/plans', label: 'Plans', icon: Package },
  { href: '/admin/demo', label: 'Demo data', icon: Database },
  { href: '/admin/status', label: 'Status', icon: ClipboardList },
] as const

export function AdminTabNav() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1">
      {TABS.map(tab => {
        const active = tab.href === '/admin'
          ? pathname === '/admin'
          : pathname === tab.href || pathname.startsWith(tab.href + '/')
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-slate-700/60 text-white'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/30'
            }`}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
            {active && (
              <span className="absolute -bottom-[15px] left-3 right-3 h-0.5 bg-blue-500 rounded-full" />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
