'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ListChecks, Mail, BarChart3 } from 'lucide-react'

// Secondary nav shared by the three onboarding admin pages (Steps / Emails /
// Funnel). The top-level admin nav highlights "Onboarding" for any of these via
// its /admin/onboarding prefix match; this row picks the section.
const TABS = [
  { href: '/admin/onboarding-steps', label: 'Steps', icon: ListChecks },
  { href: '/admin/onboarding-emails', label: 'Emails', icon: Mail },
  { href: '/admin/onboarding-funnel', label: 'Funnel', icon: BarChart3 },
] as const

export function OnboardingSubNav() {
  const pathname = usePathname()
  return (
    <div className="mb-6 inline-flex items-center gap-1 rounded-xl bg-slate-800/60 p-1 border border-slate-700">
      {TABS.map(tab => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700/40'
            }`}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
