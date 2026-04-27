'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/forms', label: 'Embed forms', match: (p: string) => p === '/forms' || p.startsWith('/forms?') },
  { href: '/forms/session', label: 'Session forms', match: (p: string) => p.startsWith('/forms/session') },
]

export function FormsTabs() {
  const pathname = usePathname()
  return (
    <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl mb-6">
      {TABS.map(t => {
        const active = t.match(pathname)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium text-center transition-all duration-150 ${
              active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
