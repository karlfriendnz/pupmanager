'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, Calendar, Layers, Package,
  MessageSquare, Settings, HelpCircle, User, Trophy,
  Home, LogOut, ShoppingBag,
  MoreHorizontal, X, Inbox, GraduationCap,
} from 'lucide-react'
import { stepKeyForLocation } from '@/lib/onboarding/path-step'
import { UnreadBadgeSync } from './unread-badge-sync'

const SIDEBAR_COLLAPSED_KEY = 'k9.trainerSidebarCollapsed'

const TRAINER_NAV = [
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/clients',      label: 'Clients',      icon: Users },
  { href: '/schedule',     label: 'Schedule',     icon: Calendar },
  { href: '/packages',     label: 'Packages',     icon: Package },
  { href: '/classes',      label: 'Classes',      icon: GraduationCap },
  { href: '/templates',    label: 'Library',      icon: Layers },
  { href: '/products',     label: 'Products',     icon: ShoppingBag },
  { href: '/achievements', label: 'Achievements', icon: Trophy },
  { href: '/enquiries',    label: 'Enquiries',    icon: Inbox },
  { href: '/messages',     label: 'Messages',     icon: MessageSquare },
  { href: '/settings',     label: 'Settings',     icon: Settings },
  { href: '/help',         label: 'Help',         icon: HelpCircle },
]

// On phones the bottom tab bar is limited to four primary destinations plus
// a "More" tab — anything not in this list lives in the More sheet.
const TRAINER_MOBILE_PRIMARY_HREFS = new Set([
  '/dashboard', '/clients', '/schedule', '/messages',
])

const CLIENT_NAV = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/my-sessions', label: 'Sessions', icon: Calendar },
  { href: '/my-classes', label: 'Classes', icon: GraduationCap },
  { href: '/my-messages', label: 'Messages', icon: MessageSquare },
  { href: '/my-profile', label: 'Profile', icon: User },
]

interface AppShellProps {
  role: 'TRAINER' | 'CLIENT'
  children: React.ReactNode
  userName?: string
  userEmail?: string
  trainerLogo?: string | null
  businessName?: string
  /**
   * If set to a TRAINER_NAV href, that menu item gets a small pulsing dot
   * pinned beside its label/icon — used during onboarding to point at the
   * page the trainer should click next. The dot only renders when the
   * trainer's current page step is itself completed (so the cue fires
   * AFTER they've finished a step, not while they're still working on
   * it). See `completedStepKeys` below.
   */
  highlightMenuHref?: string | null
  /**
   * Client-side equivalent: when true, every CLIENT_NAV item (sidebar +
   * mobile bottom bar) gets an indigo pulsing dot. Used by the trainer's
   * /preview-as flow during onboarding so the trainer can see at a glance
   * which sections their client has access to.
   */
  clientNavHints?: boolean
  /**
   * Keys of every onboarding step the trainer has completed. AppShell
   * resolves the trainer's current pathname to a step and only shows the
   * highlight dot when that step is in this list.
   */
  completedStepKeys?: string[]
  /**
   * Per-href badge counts to render on nav items (sidebar + mobile tabs).
   * Currently used for unread message counts on the Messages nav item
   * (trainer) and on Home (client, while the Messages tab is still hidden
   * from the mobile bottom bar). Missing or zero values render no badge.
   */
  unreadCounts?: Record<string, number>
  /**
   * Aggregate unread count for browser-tab title + OS Badging API.
   * Decoupled from unreadCounts because we may surface the same number
   * under multiple nav hrefs (e.g. /home and /my-messages on the client
   * side) and naïvely summing those keys would double-count.
   */
  unreadTotal?: number
}

export function AppShell(props: AppShellProps) {
  return (
    <>
      <UnreadBadgeSync total={props.unreadTotal ?? 0} />
      {props.role === 'CLIENT' ? <ClientShell {...props} /> : <TrainerShell {...props} />}
    </>
  )
}

// ─── Client shell ────────────────────────────────────────────────────────────
// Mobile-app-style layout: no sidebar on any viewport. Sticky brand header
// on top, sticky bottom tab nav, centered narrow column on desktop.

function ClientShell({ children, trainerLogo, businessName, clientNavHints, unreadCounts = {} }: AppShellProps) {
  const pathname = usePathname()

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <div className="mx-auto w-full max-w-md md:max-w-2xl lg:max-w-6xl bg-slate-50 min-h-[100dvh] flex flex-col relative">
        {/* Top brand header — sticky background spans the page, but the
            inner row is constrained to the same max-w-3xl as the feed below
            so logo/menu align with the content column. */}
        <header
          className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-slate-100"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="max-w-3xl mx-auto w-full flex items-center gap-3 px-5 lg:px-8 h-14 lg:h-16">
            {/* Logo always routes back to /home — acts as the client app's
                home button regardless of which page they're on. */}
            <Link href="/home" aria-label="Home" className="flex items-center min-w-0">
              {trainerLogo ? (
                // Don't crop or round — the trainer's logo can be any
                // aspect ratio (a horizontal wordmark, a non-square
                // brand mark) and forcing it into a square with
                // object-cover hacked off useful parts. object-contain
                // preserves the full mark; we just bound the height.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={trainerLogo} alt={businessName ?? 'Logo'} className="h-9 lg:h-10 w-auto max-w-[180px] object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/logo.png" alt={businessName ?? 'PupManager'} className="h-9 w-9 lg:h-10 lg:w-10 rounded-xl" />
              )}
            </Link>

            {/* Tablet+desktop: nav on the right with icon-on-top,
                label-underneath. Phone: nav lives in the bottom tab bar so
                this row only shows the sign-out icon. */}
            <nav className="hidden md:flex items-center gap-1 ml-auto">
              {CLIENT_NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                const Icon = item.icon
                const unread = unreadCounts[item.href] ?? 0
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] font-medium transition-colors',
                      active
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                    {unread > 0 && (
                      <span
                        aria-label={`${unread} unread`}
                        className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white tabular-nums ring-2 ring-white"
                      >
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                    {clientNavHints && !active && unread === 0 && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-indigo-500 animate-pm-menu-dot ring-2 ring-white"
                      />
                    )}
                  </Link>
                )
              })}
            </nav>

            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="p-2 -mr-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors md:ml-2 ml-auto"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Main content — flex column so chat-style routes can grow a
            single child to fill the available height (flex-1 + min-h-0)
            and pin a composer at the bottom without needing a brittle
            100dvh-minus-chrome height calc. */}
        <main className="flex-1 flex flex-col min-h-0 pb-24 md:pb-8">
          {children}
        </main>

        {/* Phone-only bottom tab nav. Tablet+desktop use the sticky top nav
            inside the header instead. */}
        <nav
          className="md:hidden sticky bottom-0 z-40 bg-white/95 backdrop-blur border-t border-slate-100"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex">
            {CLIENT_NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              const Icon = item.icon
              const unread = unreadCounts[item.href] ?? 0
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors',
                    active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
                  )}
                >
                  <Icon className={cn('h-5 w-5 transition-transform', active && 'scale-110')} />
                  <span className="text-[10px] font-medium">{item.label}</span>
                  {unread > 0 && (
                    <span
                      aria-label={`${unread} unread`}
                      className="absolute top-1.5 right-[18%] inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white tabular-nums ring-2 ring-white"
                    >
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                  {clientNavHints && !active && unread === 0 && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-1.5 right-[18%] h-2 w-2 rounded-full bg-indigo-500 animate-pm-menu-dot ring-2 ring-white"
                    />
                  )}
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
  )
}

// ─── Trainer shell ───────────────────────────────────────────────────────────
// Desktop: collapsible sidebar. Phone: sticky brand header + 4-tab bottom
// nav with a "More" sheet that holds the secondary destinations and sign-out.

// Small numeric badge rendered on a nav item when the corresponding
// unreadCounts[href] is > 0. Caps at 99+ so it doesn't blow the layout.
function NavBadge({ count, variant = 'pill' }: { count: number; variant?: 'pill' | 'dot' }) {
  if (!count) return null
  if (variant === 'dot') {
    return (
      <span
        aria-label={`${count} unread`}
        className="absolute top-1 right-[22%] h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white"
      />
    )
  }
  return (
    <span
      aria-label={`${count} unread`}
      className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold tabular-nums text-white"
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function TrainerShell({
  children,
  userName,
  userEmail,
  trainerLogo,
  businessName,
  highlightMenuHref,
  completedStepKeys = [],
  unreadCounts = {},
}: AppShellProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  // Close the popout menu when the trainer clicks elsewhere or hits Escape —
  // standard dropdown ergonomics. The ref wraps both the trigger and the
  // floating panel, so clicks inside either count as "in the menu".
  useEffect(() => {
    if (!userMenuOpen) return
    function onPointer(ev: MouseEvent | TouchEvent) {
      if (!userMenuRef.current) return
      if (!userMenuRef.current.contains(ev.target as Node)) setUserMenuOpen(false)
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [userMenuOpen])

  // Close on route change so the menu doesn't survive a navigation.
  useEffect(() => { setUserMenuOpen(false) }, [pathname])

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) : null
    let next = false
    if (stored === '1') next = true
    else if (stored === '0') next = false
    else if (typeof window !== 'undefined' && window.innerWidth < 1024) next = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(next)
  }, [])

  // Lock background scroll while the More sheet is open.
  useEffect(() => {
    if (!moreOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [moreOpen])

  // Close the sheet when route changes.
  useEffect(() => { setMoreOpen(false) }, [pathname])

  function toggleCollapsed() {
    setCollapsed(v => {
      const next = !v
      try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  const sidebarWidth = collapsed ? 'md:w-16' : 'md:w-64'
  const mainOffset = collapsed ? 'md:ml-16' : 'md:ml-64'

  const mobilePrimary = TRAINER_NAV.filter(i => TRAINER_MOBILE_PRIMARY_HREFS.has(i.href))
  const mobileSecondary = TRAINER_NAV.filter(i => !TRAINER_MOBILE_PRIMARY_HREFS.has(i.href))
  const isOnSecondary = mobileSecondary.some(i => pathname === i.href || pathname.startsWith(i.href + '/'))

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className={cn('hidden md:flex md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-100 transition-all duration-200', sidebarWidth)}>
        <div className={cn('flex h-16 items-center border-b border-slate-100', collapsed ? 'justify-center px-2' : 'gap-3 px-5')}>
          {trainerLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={trainerLogo} alt={businessName} className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/logo.png" alt={businessName ?? 'PupManager'} className="h-8 w-8 rounded-lg" />
          )}
          {!collapsed && (
            <span className="font-semibold text-slate-900 truncate">
              {businessName ?? 'PupManager'}
            </span>
          )}
        </div>

        <nav className={cn('flex-1 overflow-y-auto py-4 space-y-1', collapsed ? 'px-2' : 'px-3')}>
          {TRAINER_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            // The pulsing dot guides the trainer to their next step, but it
            // should NOT fire while they're mid-step on the page they're on.
            // Two cases hide the dot:
            //   • current page = a step page AND that step is still pending
            //     (trainer is working on it; don't distract)
            //   • current page IS the highlighted menu (already there)
            // On non-step pages (e.g. /dashboard, /messages) the dot still
            // shows so it can pull the trainer into their next task.
            const currentStepKey = stepKeyForLocation(pathname)
            const onIncompleteStepPage = !!currentStepKey && !completedStepKeys.includes(currentStepKey)
            const onHighlightedMenu = !!highlightMenuHref && (pathname === highlightMenuHref || pathname.startsWith(highlightMenuHref + '/'))
            const highlighted =
              !!highlightMenuHref &&
              !onIncompleteStepPage &&
              !onHighlightedMenu &&
              item.href === highlightMenuHref
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'relative flex items-center rounded-xl text-sm font-medium transition-colors',
                  collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5',
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && item.label}
                {!collapsed && <NavBadge count={unreadCounts[item.href] ?? 0} />}
                {/* Collapsed-sidebar mode hides the pill — use the dot
                    variant overlaid on the icon corner instead. */}
                {collapsed && (unreadCounts[item.href] ?? 0) > 0 && (
                  <span
                    aria-hidden
                    className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white"
                  />
                )}
                {highlighted && (
                  <span
                    aria-hidden
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-indigo-500 animate-pm-menu-dot"
                  />
                )}
              </Link>
            )
          })}
        </nav>

        <div className={cn('border-t border-slate-100 relative', collapsed ? 'p-2 flex flex-col items-center gap-2' : 'p-4')}>
          {/* User menu trigger — clicking the avatar/name pops a small
              floating panel out to the right of the sidebar with email
              + sign-out. Same component for collapsed and expanded; the
              trigger just shows more or less in each mode. */}
          <div ref={userMenuRef} className={cn('relative', collapsed ? '' : 'w-full mb-2')}>
            <button
              type="button"
              onClick={() => setUserMenuOpen(v => !v)}
              className={cn(
                'flex items-center rounded-lg transition-colors',
                collapsed
                  ? 'h-9 w-9 justify-center bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-600'
                  : 'gap-3 w-full text-left px-1 py-1 -mx-1 hover:bg-slate-50'
              )}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              title={collapsed ? userName ?? undefined : undefined}
            >
              {collapsed ? (
                userName?.[0]?.toUpperCase() ?? '?'
              ) : (
                <>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 flex-shrink-0">
                    {userName?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <span className="text-sm font-medium text-slate-700 truncate">{userName}</span>
                </>
              )}
            </button>

            {userMenuOpen && (
              <div
                role="menu"
                className={cn(
                  'absolute z-50 w-64 rounded-2xl bg-white shadow-[0_18px_45px_-12px_rgba(15,23,42,0.25)] border border-slate-100 overflow-hidden',
                  // Pop to the right of the sidebar, pinned to the bottom
                  // of the trigger so the corners line up with the avatar.
                  collapsed
                    ? 'left-full ml-2 bottom-0'
                    : 'left-full ml-3 bottom-0'
                )}
              >
                <div className="px-4 py-3 bg-gradient-to-br from-slate-50 to-white border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 text-white text-sm font-semibold flex-shrink-0">
                      {userName?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{userName ?? 'You'}</p>
                      {userEmail && <p className="text-xs text-slate-500 truncate">{userEmail}</p>}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="flex items-center gap-2 w-full px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  role="menuitem"
                >
                  <LogOut className="h-4 w-4 text-slate-400" />
                  Sign out
                </button>
              </div>
            )}
          </div>

        </div>
      </aside>

      {/* No mobile header on the trainer side. The bottom tab bar covers
          nav, and per-page sticky bars (e.g. session detail) own their
          own safe-area-inset-top. Pages without a sticky bar fall back
          to the <main> safe-area pad below. */}

      {/* Mobile bottom tab bar — 4 primary destinations + More */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-slate-100 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {mobilePrimary.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon
            const unread = unreadCounts[item.href] ?? 0
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors',
                  active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
                )}
              >
                <Icon className={cn('h-5 w-5 transition-transform', active && 'scale-110')} />
                <span className="text-[10px] font-medium">{item.label}</span>
                {unread > 0 && (
                  <span
                    aria-label={`${unread} unread`}
                    className="absolute top-1.5 right-[22%] inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white tabular-nums ring-2 ring-white"
                  >
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors cursor-pointer',
              isOnSecondary ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
            )}
          >
            <MoreHorizontal className={cn('h-5 w-5 transition-transform', isOnSecondary && 'scale-110')} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* Mobile More sheet */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="More menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] cursor-default"
          />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
          >
            <div className="sticky top-0 bg-white pt-2 pb-1 z-10">
              <div className="mx-auto h-1 w-10 rounded-full bg-slate-200" />
            </div>

            <div className="px-4 pb-3 flex items-center gap-3 border-b border-slate-100">
              <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-base font-semibold text-slate-600 flex-shrink-0">
                {userName?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 truncate">{userName ?? 'You'}</p>
                {userEmail && <p className="text-xs text-slate-500 truncate">{userEmail}</p>}
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="-mr-1 p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3">
              {mobileSecondary.map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                      active
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                    )}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    {item.label}
                  </Link>
                )
              })}
            </div>

            <div className="px-3 pt-1">
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <main
        className={cn('flex-1 flex flex-col min-h-0 pb-20 md:pb-0 transition-all duration-200', mainOffset)}
        // Capped safe-area pad on mobile: pages without their own sticky
        // top bar get a small clearance below iOS chrome. Pages that
        // own a sticky bar can break out via negative margin and handle
        // safe-area themselves.
        style={{ paddingTop: 'min(env(safe-area-inset-top, 0px), 1rem)' }}
      >
        {children}
      </main>
    </div>
  )
}
