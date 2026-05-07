'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { User, Pencil, Bell } from 'lucide-react'

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'forms', label: 'Forms', icon: Pencil },
] as const

type TabId = typeof TABS[number]['id']

const TAB_IDS = TABS.map(t => t.id) as readonly TabId[]

function readHashTab(): TabId | null {
  if (typeof window === 'undefined') return null
  const h = window.location.hash.replace(/^#/, '')
  return (TAB_IDS as readonly string[]).includes(h) ? (h as TabId) : null
}

export function SettingsTabs({
  profile,
  notifications,
  forms,
}: {
  profile: React.ReactNode
  notifications: React.ReactNode
  forms: React.ReactNode
}) {
  const searchParams = useSearchParams()
  // Search param wins over hash because Next.js soft navigation can strip the
  // hash before client-side code reads it. ?tab=forms is the reliable path.
  const queryTab = searchParams.get('tab')
  const initialTab = (TAB_IDS as readonly string[]).includes(queryTab ?? '')
    ? (queryTab as TabId)
    : 'profile'
  const [tab, setTab] = useState<TabId>(initialTab)

  // Also support deep-links via #hash for back-compat with anything that
  // already uses the hash form.
  useEffect(() => {
    const fromHash = readHashTab()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromHash) setTab(fromHash)
    function onHashChange() {
      const t = readHashTab()
      if (t) setTab(t)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
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
        {TABS.map(t => {
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
        <div className={tab === 'profile' ? '' : 'hidden'}>{profile}</div>
        <div className={tab === 'notifications' ? '' : 'hidden'}>{notifications}</div>
        <div className={tab === 'forms' ? '' : 'hidden'}>{forms}</div>
      </div>
    </div>
  )
}
