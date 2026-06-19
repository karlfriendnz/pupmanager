'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { User, Pencil, Bell, Users, CreditCard, Wallet } from 'lucide-react'
import { useIsNative } from '@/lib/native'

const ALL_TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'forms', label: 'Forms', icon: Pencil },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'billing', label: 'Billing', icon: CreditCard },
] as const

type TabId = typeof ALL_TABS[number]['id']

export function SettingsTabs({
  profile,
  notifications,
  forms,
  team,
  payments,
  billing,
}: {
  // Each tab renders only when its node is provided, so the page can hide tabs
  // a member lacks permission for (e.g. staff don't get Profile/Forms).
  // Notifications are per-user and always available.
  profile?: React.ReactNode
  notifications: React.ReactNode
  forms?: React.ReactNode
  team?: React.ReactNode
  payments?: React.ReactNode
  billing?: React.ReactNode
}) {
  const native = useIsNative()
  const present: Record<TabId, React.ReactNode> = { profile, notifications, forms, team, payments, billing }
  // Hide Billing inside the native app — subscription billing is handled on
  // the web (Apple Guideline 3.1.1: no in-app pricing / purchase surfaces).
  const tabs = ALL_TABS.filter((t) => present[t.id] != null && !(t.id === 'billing' && native))
  const tabIds = tabs.map((t) => t.id) as readonly TabId[]

  function readHashTab(): TabId | null {
    if (typeof window === 'undefined') return null
    const h = window.location.hash.replace(/^#/, '')
    return (tabIds as readonly string[]).includes(h) ? (h as TabId) : null
  }

  const searchParams = useSearchParams()
  // Search param wins over hash because Next.js soft navigation can strip the
  // hash before client-side code reads it. ?tab=team is the reliable path.
  const queryTab = searchParams.get('tab')
  const firstTab = tabIds[0] ?? 'notifications'
  const initialTab = (tabIds as readonly string[]).includes(queryTab ?? '')
    ? (queryTab as TabId)
    : firstTab
  const [tab, setTab] = useState<TabId>(initialTab)

  useEffect(() => {
    const fromHash = readHashTab()
    if (fromHash) setTab(fromHash)
    function onHashChange() {
      const t = readHashTab()
      if (t) setTab(t)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectTab(id: TabId) {
    setTab(id)
    if (typeof window !== 'undefined' && window.location.hash !== `#${id}`) {
      history.replaceState(null, '', `#${id}`)
    }
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto overflow-y-hidden -mx-4 md:-mx-8 px-4 md:px-8">
        {tabs.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                active ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {active && (
                <span className="absolute -bottom-px left-3 right-3 h-0.5 bg-blue-600 rounded-full" />
              )}
            </button>
          )
        })}
      </div>

      <div>
        {profile != null && <div className={tab === 'profile' ? '' : 'hidden'}>{profile}</div>}
        <div className={tab === 'notifications' ? '' : 'hidden'}>{notifications}</div>
        {forms != null && <div className={tab === 'forms' ? '' : 'hidden'}>{forms}</div>}
        {team != null && <div className={tab === 'team' ? '' : 'hidden'}>{team}</div>}
        {payments != null && <div className={tab === 'payments' ? '' : 'hidden'}>{payments}</div>}
        {billing != null && !native && <div className={tab === 'billing' ? '' : 'hidden'}>{billing}</div>}
      </div>
    </div>
  )
}
