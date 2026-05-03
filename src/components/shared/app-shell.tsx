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
} from 'lucide-react'

const SIDEBAR_COLLAPSED_KEY = 'k9.trainerSidebarCollapsed'

const TRAINER_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/schedule', label: 'Schedule', icon: Calendar },
  { href: '/packages', label: 'Packages', icon: Package },
  { href: '/templates', label: 'Library', icon: Layers },
  { href: '/products', label: 'Products', icon: ShoppingBag },
  { href: '/achievements', label: 'Achievements', icon: Trophy },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/help', label: 'Help', icon: HelpCircle },
]

const CLIENT_NAV = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/my-sessions', label: 'Sessions', icon: Calendar },
  { href: '/my-availability', label: 'Available', icon: CalendarClock },
  { href: '/my-shop', label: 'Shop', icon: ShoppingBag },
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
        {/* Top brand header */}
        <header
          className="sticky top-0 z-40 flex items-center gap-3 px-5 lg:px-8 h-14 lg:h-16 bg-white/80 backdrop-blur border-b border-slate-100"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          {trainerLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={trainerLogo} alt={businessName ?? 'Logo'} className="h-9 w-9 lg:h-10 lg:w-10 rounded-xl object-cover" />
          ) : (
            <div className="flex h-9 w-9 lg:h-10 lg:w-10 items-center justify-center rounded-xl bg-blue-600 text-white text-sm">
              🐾
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm lg:text-base font-semibold text-slate-900 truncate leading-tight">{businessName ?? 'PupManager'}</p>
            <p className="text-[11px] text-slate-400 leading-tight lg:hidden">Your training home</p>
          </div>

          {/* Desktop: inline tab nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {CLIENT_NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                    active ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="p-2 -mr-2 lg:ml-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </header>

        {/* Main content */}
        <main className="flex-1 pb-24 lg:pb-8">
          {children}
        </main>

        {/* Mobile/iPad: bottom tab nav */}
        <nav
          className="lg:hidden sticky bottom-0 z-40 bg-white/95 backdrop-blur border-t border-slate-100"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex">
            {CLIENT_NAV.map((item) => {
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
// Original layout: desktop sidebar + mobile bottom nav.

function TrainerShell({
  children,
  userName,
  userEmail,
  trainerLogo,
  businessName,
}: AppShellProps) {
  const pathname = usePathname()
  const [showEmail, setShowEmail] = useState(false)
  // Default to collapsed on tablet (md→lg), expanded on lg+. The user-toggled
  // value is persisted so the choice sticks across navigation.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    // Hydrate the user's saved preference once on mount; fall back to
    // collapsed-by-default on tablets (md…lg) so the bigger nav doesn't eat
    // the screen there.
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) : null
    let next = false
    if (stored === '1') next = true
    else if (stored === '0') next = false
    else if (typeof window !== 'undefined' && window.innerWidth < 1024) next = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(next)
  }, [])
  function toggleCollapsed() {
    setCollapsed(v => {
      const next = !v
      try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  const sidebarWidth = collapsed ? 'md:w-16' : 'md:w-64'
  const mainOffset = collapsed ? 'md:ml-16' : 'md:ml-64'

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className={cn('hidden md:flex md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-100 transition-all duration-200', sidebarWidth)}>
        <div className={cn('flex h-16 items-center border-b border-slate-100', collapsed ? 'justify-center px-2' : 'gap-3 px-5')}>
          {trainerLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={trainerLogo} alt={businessName} className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white text-sm">
              🐾
            </div>
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

      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-100 z-50">
        <div className="flex">
          {TRAINER_NAV.slice(0, 5).map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex-1 flex flex-col items-center gap-0.5 py-3 text-xs font-medium transition-colors',
                  active ? 'text-blue-600' : 'text-slate-500'
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px]">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      <main className={cn('flex-1 pb-20 md:pb-0 transition-all duration-200', mainOffset)}>
        {children}
      </main>
    </div>
  )
}
