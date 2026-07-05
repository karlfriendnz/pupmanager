'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { User, Pencil, Bell, Users, CreditCard, Wallet, ShieldCheck, Globe, Puzzle, Landmark, Tags } from 'lucide-react'
import { useIsNative } from '@/lib/native'

const ALL_TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'forms', label: 'Forms', icon: Pencil },
  { id: 'customfields', label: 'Custom fields', icon: Tags },
  { id: 'integration', label: 'Integrations', icon: Globe },
  { id: 'addons', label: 'Add-ons', icon: Puzzle },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'xero', label: 'Xero', icon: Landmark },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'activity', label: 'Activity', icon: ShieldCheck },
] as const

type TabId = typeof ALL_TABS[number]['id']

export function SettingsTabs({
  profile,
  notifications,
  forms,
  customfields,
  integration,
  addons,
  team,
  payments,
  xero,
  billing,
  activity,
}: {
  // Each tab renders only when its node is provided, so the page can hide tabs
  // a member lacks permission for (e.g. staff don't get Profile/Forms).
  // Notifications are per-user and always available.
  profile?: React.ReactNode
  notifications: React.ReactNode
  forms?: React.ReactNode
  customfields?: React.ReactNode
  integration?: React.ReactNode
  addons?: React.ReactNode
  team?: React.ReactNode
  payments?: React.ReactNode
  xero?: React.ReactNode
  billing?: React.ReactNode
  activity?: React.ReactNode
}) {
  const native = useIsNative()
  const present: Record<TabId, React.ReactNode> = { profile, notifications, forms, customfields, integration, addons, team, payments, xero, billing, activity }
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

  // React to ?tab= changing without a remount — e.g. the Add-ons page's
  // "Manage" action does router.push('/settings?tab=xero') while already on
  // /settings, so the state must follow the new query param.
  useEffect(() => {
    if (queryTab && (tabIds as readonly string[]).includes(queryTab)) {
      setTab(queryTab as TabId)
    }
    // Only react to the query param changing — tabIds is stable in content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryTab])

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
    // Keep the URL on the canonical ?tab= form and clear any stale hash, so the
    // query (the source of truth) never disagrees with the shown tab — e.g.
    // avoid ?tab=xero#addons after arriving via a ?tab= link then clicking away.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', id)
      url.hash = ''
      history.replaceState(null, '', `${url.pathname}${url.search}`)
    }
  }

  return (
    <div className="flex flex-col md:flex-row md:gap-8">
      {/* Tab rail — vertical on md+, a horizontal scroll row on mobile. */}
      <nav className="md:w-56 md:flex-shrink-0">
        <div className="flex md:flex-col gap-1 overflow-x-auto overflow-y-hidden -mx-4 px-4 md:mx-0 md:px-0 border-b border-slate-200 md:border-b-0 mb-6 md:mb-0 md:sticky md:top-4">
          {tabs.map(t => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTab(t.id)}
                className={`relative shrink-0 md:shrink flex items-center gap-2 px-4 md:px-3 py-2.5 text-sm font-medium whitespace-nowrap rounded-xl transition-colors ${
                  active
                    ? 'text-blue-600 md:bg-blue-50'
                    : 'text-slate-500 hover:text-slate-700 md:hover:bg-slate-50'
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {t.label}
                {/* Underline on mobile, left bar on the desktop rail. */}
                {active && (
                  <span className="absolute -bottom-px left-3 right-3 h-0.5 bg-blue-600 rounded-full md:hidden" />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Content. Single-column forms get a readable cap (max-w-2xl); wide
          master-detail panels (Forms, Email templates) use the full width. */}
      <div className="min-w-0 flex-1">
        {profile != null && <div className={tab === 'profile' ? 'max-w-2xl' : 'hidden'}>{profile}</div>}
        <div className={tab === 'notifications' ? 'max-w-2xl' : 'hidden'}>{notifications}</div>
        {forms != null && <div className={tab === 'forms' ? '' : 'hidden'}>{forms}</div>}
        {customfields != null && <div className={tab === 'customfields' ? '' : 'hidden'}>{customfields}</div>}
        {integration != null && <div className={tab === 'integration' ? '' : 'hidden'}>{integration}</div>}
        {addons != null && <div className={tab === 'addons' ? '' : 'hidden'}>{addons}</div>}
        {team != null && <div className={tab === 'team' ? 'max-w-2xl' : 'hidden'}>{team}</div>}
        {payments != null && <div className={tab === 'payments' ? 'max-w-2xl' : 'hidden'}>{payments}</div>}
        {xero != null && <div className={tab === 'xero' ? 'max-w-2xl' : 'hidden'}>{xero}</div>}
        {billing != null && !native && <div className={tab === 'billing' ? 'max-w-2xl' : 'hidden'}>{billing}</div>}
        {activity != null && <div className={tab === 'activity' ? '' : 'hidden'}>{activity}</div>}
      </div>
    </div>
  )
}
