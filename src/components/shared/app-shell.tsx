'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, Calendar, CalendarClock, Layers, Package,
  MessageSquare, Settings, HelpCircle, User, Trophy,
  Home, LogOut, ShoppingBag, ChevronsLeft, ChevronsRight,
  MoreHorizontal, X, Inbox,
} from 'lucide-react'

const SIDEBAR_COLLAPSED_KEY = 'k9.trainerSidebarCollapsed'

const TRAINER_NAV = [
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/clients',      label: 'Clients',      icon: Users },
  { href: '/schedule',     label: 'Schedule',     icon: Calendar },
  { href: '/packages',     label: 'Packages',     icon: Package },
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
  { href: '/my-availability', label: 'Available', icon: CalendarClock },
  { href: '/my-shop', label: 'Shop', icon: ShoppingBag },
  // Messaging tab hidden for now — route still works for direct deep links.
  // { href: '/my-messages', label: 'Messages', icon: MessageSquare },
  { href: '/my-profile', label: 'Profile', icon: User },
]

interface AppShellProps {
  role: 'TRAINER' | 'CLIENT'
  children: React.ReactNode
  userName?: string
  userEmail?: string
  trainerLogo?: string | null
  businessName?: string
}

export function AppShell(props: AppShellProps) {
  if (props.role === 'CLIENT') return <ClientShell {...props} />
  return <TrainerShell {...props} />
}

// ─── Client shell ────────────────────────────────────────────────────────────
// Mobile-app-style layout: no sidebar on any viewport. Sticky brand header
// on top, sticky bottom tab nav, centered narrow column on desktop.

function ClientShell({ children, trainerLogo, businessName }: AppShellProps) {
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
            <Link href="/home" aria-label="Home" className="flex items-center min-w-0 rounded-xl">
              {trainerLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={trainerLogo} alt={businessName ?? 'Logo'} className="h-9 w-9 lg:h-10 lg:w-10 rounded-xl object-cover" />
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
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] font-medium transition-colors',
                      active
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
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

        {/* Main content */}
        <main className="flex-1 pb-24 md:pb-8">
          {children}
        </main>

        {/* Phone-only bottom tab nav. Tablet+desktop use the sticky top nav
            inside the header instead. */}
        <nav
          className="md:hidden sticky bottom-0 z-40 bg-white/95 backdrop-blur border-t border-slate-100"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex">
            {/* Home is omitted from the mobile tab bar — the trainer logo
                in the header is the home affordance on mobile. */}
            {CLIENT_NAV.filter(item => item.href !== '/home').map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors',
                    active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
                  )}
                >
                  <Icon className={cn('h-5 w-5 transition-transform', active && 'scale-110')} />
                  <span className="text-[10px] font-medium">{item.label}</span>
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

function TrainerShell({
  children,
  userName,
  userEmail,
  trainerLogo,
  businessName,
}: AppShellProps) {
  const pathname = usePathname()
  const [showEmail, setShowEmail] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

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
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center rounded-xl text-sm font-medium transition-colors',
                  collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5',
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && item.label}
              </Link>
            )
          })}
        </nav>

        <div className={cn('border-t border-slate-100', collapsed ? 'p-2 flex flex-col items-center gap-2' : 'p-4')}>
          {collapsed ? (
            <>
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600"
                title={userName ?? undefined}
              >
                {userName?.[0]?.toUpperCase() ?? '?'}
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
              <button
                onClick={toggleCollapsed}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowEmail(v => !v)}
                className="flex items-center gap-3 w-full text-left mb-2 rounded-lg hover:bg-slate-50 px-1 py-1 -mx-1 transition-colors"
                aria-expanded={showEmail}
                aria-label={showEmail ? 'Hide email address' : 'Show email address'}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 flex-shrink-0">
                  {userName?.[0]?.toUpperCase() ?? '?'}
                </div>
                <span className="text-sm font-medium text-slate-700 truncate">{userName}</span>
              </button>
              {showEmail && userEmail && (
                <p className="text-xs text-slate-500 truncate mb-2 px-1" title={userEmail}>
                  {userEmail}
                </p>
              )}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Sign out
                </button>
                <button
                  onClick={toggleCollapsed}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* No mobile header on the trainer side: the avatar wasn't actionable
          and showing the trainer their own logo on every screen burnt the
          top-of-fold real estate. Bottom tab bar + More sheet cover all nav
          and account actions. Page content gets the safe-area-inset-top
          padding via the main element below so the first row of content
          (page heading, etc.) sits cleanly under the notch. */}

      {/* Mobile bottom tab bar — 4 primary destinations + More */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-slate-100 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {mobilePrimary.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors',
                  active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
                )}
              >
                <Icon className={cn('h-5 w-5 transition-transform', active && 'scale-110')} />
                <span className="text-[10px] font-medium">{item.label}</span>
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
        className={cn('flex-1 pb-20 md:pb-0 transition-all duration-200', mainOffset)}
        // Capped safe-area pad on mobile: the iOS Capacitor WebView reports
        // a large env(safe-area-inset-top) that, when added to each page's
        // own p-4, produced a ~120px blank strip above every heading. Cap
        // at 1rem so the status bar text (Style.Dark, light bg) clears the
        // page heading without burning vertical real estate.
        style={{ paddingTop: 'min(env(safe-area-inset-top, 0px), 1rem)' }}
      >
        {children}
      </main>
    </div>
  )
}
