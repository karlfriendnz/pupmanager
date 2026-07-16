'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, User, Pencil, Bell, Users, CreditCard, Wallet, ShieldCheck, Globe, Puzzle, Landmark } from 'lucide-react'
import { useIsNative } from '@/lib/native'
import { TabIntro } from './tab-intro'

// Settings is the only left menu on screen in here (the app's own sidebar is
// hidden), so it wears the same clothes: identical row shape, active state,
// icon size and section headers as the main nav — see app-shell.tsx.
type Section = 'account' | 'business' | 'money' | 'system'

const SECTION_LABEL: Record<Section, string | null> = {
  account: null,
  business: 'Business',
  money: 'Money',
  system: null,
}

const ALL_TABS = [
  { id: 'profile', label: 'Profile', icon: User, section: 'account' },
  { id: 'notifications', label: 'Notifications', icon: Bell, section: 'account' },
  { id: 'addons', label: 'Add-ons', icon: Puzzle, section: 'business' },
  { id: 'forms', label: 'Fields & forms', icon: Pencil, section: 'business' },
  { id: 'integration', label: 'Connect Website', icon: Globe, section: 'business' },
  { id: 'team', label: 'Team', icon: Users, section: 'business' },
  { id: 'payments', label: 'Payments', icon: Wallet, section: 'money' },
  { id: 'xero', label: 'Xero', icon: Landmark, section: 'money' },
  { id: 'billing', label: 'Billing', icon: CreditCard, section: 'money' },
  { id: 'activity', label: 'Activity', icon: ShieldCheck, section: 'system' },
] as const

type TabId = typeof ALL_TABS[number]['id']

export function SettingsTabs({
  profile,
  notifications,
  forms,
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
  integration?: React.ReactNode
  addons?: React.ReactNode
  team?: React.ReactNode
  payments?: React.ReactNode
  xero?: React.ReactNode
  billing?: React.ReactNode
  activity?: React.ReactNode
}) {
  const native = useIsNative()
  const present: Record<TabId, React.ReactNode> = { profile, notifications, forms, integration, addons, team, payments, xero, billing, activity }
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
      {/* Tab rail — the app's left menu, wearing the same clothes. On md+ it's a
          fixed full-height rail flush to the left edge, matching the main app's
          sidebar (top-14 → bottom, white panel, right border). On mobile it's a
          horizontal scroll row (where the real nav is a bottom bar). */}
      <nav className="md:fixed md:top-14 md:bottom-0 md:left-0 md:z-30 md:flex md:w-64 md:flex-col md:bg-white md:border-r md:border-slate-100">
        <div className="flex md:flex-col md:flex-1 gap-1 overflow-x-auto overflow-y-hidden md:overflow-x-hidden md:overflow-y-auto -mx-4 px-4 md:mx-0 md:px-3 md:py-4 border-b border-slate-200 md:border-b-0 mb-6 md:mb-0">
          {/* Settings hides the app's main nav, so the rail is the only way back
              out — lead with an explicit exit to the dashboard. */}
          <Link
            href="/dashboard"
            className="relative shrink-0 md:shrink flex items-center gap-3 px-3 py-2.5 text-sm font-medium whitespace-nowrap rounded-xl transition-colors text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:mb-1 md:border-b md:border-slate-100 md:pb-3 md:rounded-b-none"
          >
            <ArrowLeft className="h-5 w-5 flex-shrink-0" />
            Back to app
          </Link>
          {tabs.map((t, idx, arr) => {
            const Icon = t.icon
            const active = tab === t.id
            const sectionChanged = idx === 0 || arr[idx - 1].section !== t.section
            const header = sectionChanged ? SECTION_LABEL[t.section] : null
            return (
              <Fragment key={t.id}>
                {header && (
                  <p className="hidden md:block px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {header}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => selectTab(t.id)}
                  className={`relative shrink-0 md:shrink flex items-center gap-3 px-3 py-2.5 text-sm font-medium whitespace-nowrap rounded-xl transition-colors ${
                    active
                      ? 'text-blue-700 md:bg-blue-50'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {t.label}
                  {/* Underline on mobile, where rows sit in a scroll strip. */}
                  {active && (
                    <span className="absolute -bottom-px left-3 right-3 h-0.5 bg-blue-600 rounded-full md:hidden" />
                  )}
                </button>
              </Fragment>
            )
          })}
        </div>
      </nav>

      {/* Content. Single-column forms get a readable cap (max-w-2xl); wide
          master-detail panels (Forms, Email templates) use the full width.
          md:ml-64 clears the fixed left rail (which is out of flow). */}
      <div className="min-w-0 flex-1 md:ml-64">
        {/* What this tab is for, and how to get it working — every tab, same shape. */}
        <TabIntro tab={tab} />
        {profile != null && <div className={tab === 'profile' ? 'max-w-2xl' : 'hidden'}>{profile}</div>}
        <div className={tab === 'notifications' ? 'max-w-2xl' : 'hidden'}>{notifications}</div>
        {forms != null && <div className={tab === 'forms' ? '' : 'hidden'}>{forms}</div>}
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
