'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { signOutWithPush } from '@/lib/sign-out'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, Calendar, Layers, Package,
  MessageSquare, Settings, HelpCircle, User, Trophy,
  Home, LogOut, ShoppingBag,
  MoreHorizontal, X, Inbox, GraduationCap, Flame,
  Dog, Menu as MenuIcon, Globe, Phone, Mail, ChevronRight, ArrowLeftRight,
} from 'lucide-react'
import { stepKeyForLocation } from '@/lib/onboarding/path-step'
import { UnreadBadgeSync } from './unread-badge-sync'
import { VersionGuard } from './version-guard'

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

// Mobile bottom tabs (4 primary + a Menu hamburger added in the shell).
const CLIENT_TABS = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/my-sessions', label: 'Sessions', icon: Calendar },
  { href: '/my-classes', label: 'Classes', icon: GraduationCap },
  { href: '/my-messages', label: 'Messages', icon: MessageSquare },
]
// Everything a client can reach — the full-screen menu (mobile).
const CLIENT_MENU = [
  { href: '/my-sessions', label: 'Sessions', icon: Calendar },
  { href: '/my-classes', label: 'Classes', icon: GraduationCap },
  { href: '/my-messages', label: 'Messages', icon: MessageSquare },
  { href: '/my-shop', label: 'Shop', icon: ShoppingBag },
  { href: '/my-achievements', label: 'Achievements', icon: Trophy },
  { href: '/my-dogs', label: 'My dogs', icon: Dog },
  { href: '/my-profile', label: 'My details', icon: User },
]
// Desktop sidebar = Home + everything in the menu.
const CLIENT_SIDEBAR = [{ href: '/home', label: 'Home', icon: Home }, ...CLIENT_MENU]

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
  /**
   * Trainer engagement streak summary, surfaced as an always-visible
   * pill at the bottom of the trainer sidebar. Computed in the trainer
   * layout (server) each navigation. Omitted for the client shell.
   */
  streak?: { current: number } | null
  /**
   * Trainer nav hrefs to hide for this user, based on their company role +
   * permissions (computed in the trainer layout). Owners/managers see
   * everything; staff only see what they can act on. Empty = show all.
   */
  hiddenNavHrefs?: string[]
  /**
   * Client shell only: the trainer's public contact details, surfaced as
   * icon links in the full-screen menu header. Any null/missing value is
   * simply not rendered.
   */
  trainerContact?: { website?: string | null; phone?: string | null; email?: string | null }
  /** Client shell only: show a "Switch trainer" entry (client has 2+ trainers). */
  showTrainerSwitcher?: boolean
  /**
   * Client shell only: when set (the trainer's demo/preview), "Sign out"
   * navigates here instead of actually signing out — so a previewing trainer
   * lands back on their dashboard without having to log in again.
   */
  previewExitHref?: string | null
}

export function AppShell(props: AppShellProps) {
  return (
    <>
      <VersionGuard />
      <UnreadBadgeSync total={props.unreadTotal ?? 0} />
      {props.role === 'CLIENT' ? <ClientShell {...props} /> : <TrainerShell {...props} />}
    </>
  )
}

// ─── Client shell ────────────────────────────────────────────────────────────
// PupManager-branded client app. Mobile: full-bleed pages + bottom tab bar +
// a full-screen pull-down Menu. Desktop (md+): left sidebar, content fills.

function ClientShell({ children, trainerLogo, businessName, clientNavHints, unreadCounts = {}, trainerContact, showTrainerSwitcher, previewExitHref }: AppShellProps) {
  const handleSignOut = () => {
    if (previewExitHref) { window.location.href = previewExitHref; return }
    signOutWithPush()
  }
  const pathname = usePathname()
  // Append a "Switch trainer" entry when the client works with 2+ trainers.
  const switchItem = { href: '/switch-trainer', label: 'Switch trainer', icon: ArrowLeftRight }
  const menuItems = showTrainerSwitcher ? [...CLIENT_MENU, switchItem] : CLIENT_MENU
  const sidebarItems = showTrainerSwitcher ? [...CLIENT_SIDEBAR, switchItem] : CLIENT_SIDEBAR
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragY, setDragY] = useState(0)
  const dragStart = useRef<number | null>(null)
  const moved = useRef(false)

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  // Close the menu on navigation.
  useEffect(() => { setMenuOpen(false) }, [pathname])
  // Lock background scroll while the full-screen menu is open.
  useEffect(() => {
    if (!menuOpen) { setDragY(0); return }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [menuOpen])

  // Pull-down-to-dismiss for the full-screen menu.
  const onDragDown = (e: React.PointerEvent) => { dragStart.current = e.clientY; moved.current = false; e.currentTarget.setPointerCapture(e.pointerId) }
  const onDragMove = (e: React.PointerEvent) => { if (dragStart.current == null) return; const dy = e.clientY - dragStart.current; if (dy > 5) moved.current = true; setDragY(dy > 0 ? dy : 0) }
  const onDragUp = () => { const past = dragY > 110; dragStart.current = null; setDragY(0); if (past) setMenuOpen(false) }

  // Translucent fills derived from the font colour so they read on any accent.
  const chip = 'color-mix(in srgb, var(--accent-fg) 16%, transparent)'
  const divider = 'color-mix(in srgb, var(--accent-fg) 15%, transparent)'

  const contacts = [
    trainerContact?.website ? { icon: Globe, href: trainerContact.website.startsWith('http') ? trainerContact.website : `https://${trainerContact.website}`, label: 'Website' } : null,
    trainerContact?.phone ? { icon: Phone, href: `tel:${trainerContact.phone.replace(/\s/g, '')}`, label: 'Call' } : null,
    trainerContact?.email ? { icon: Mail, href: `mailto:${trainerContact.email}`, label: 'Email' } : null,
  ].filter(Boolean) as { icon: typeof Globe; href: string; label: string }[]

  return (
    <div className="min-h-[100dvh] bg-surface md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:w-64 bg-white border-r border-slate-100 z-30">
        <Link href="/home" className="flex h-16 items-center gap-3 px-5 border-b border-slate-100">
          {trainerLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={trainerLogo} alt={businessName ?? 'Logo'} className="h-9 w-auto max-w-[170px] object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/logo.png" alt="PupManager" className="h-9 w-9 rounded-xl" />
          )}
        </Link>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {sidebarItems.map((item) => {
            const active = isActive(item.href)
            const Icon = item.icon
            const unread = unreadCounts[item.href] ?? 0
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                  active ? 'bg-accent-soft text-accent' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />{item.label}
                {unread > 0 && (
                  <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white tabular-nums">{unread > 9 ? '9+' : unread}</span>
                )}
                {clientNavHints && !active && unread === 0 && (
                  <span aria-hidden className="ml-auto h-2 w-2 rounded-full bg-indigo-500 animate-pm-menu-dot" />
                )}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <button onClick={handleSignOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors">
            <LogOut className="h-5 w-5" />Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 md:ml-64 min-h-[100dvh] flex flex-col">
        <main className="flex-1 flex flex-col min-h-0 pb-24 md:pb-0">{children}</main>
      </div>

      {/* Mobile bottom tabs */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-100"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {CLIENT_TABS.map((item) => {
            const active = isActive(item.href) && !menuOpen
            const Icon = item.icon
            const unread = unreadCounts[item.href] ?? 0
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn('relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors', active ? 'text-accent' : 'text-slate-400 hover:text-slate-600')}
              >
                <Icon className={cn('h-[22px] w-[22px] transition-transform', active && 'scale-110')} strokeWidth={active ? 2.4 : 2} />
                <span className="text-[10px] font-medium">{item.label}</span>
                {unread > 0 && (
                  <span className="absolute top-1.5 right-[18%] inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white tabular-nums ring-2 ring-white">{unread > 9 ? '9+' : unread}</span>
                )}
                {clientNavHints && !active && unread === 0 && (
                  <span aria-hidden className="pointer-events-none absolute top-1.5 right-[18%] h-2 w-2 rounded-full bg-indigo-500 animate-pm-menu-dot ring-2 ring-white" />
                )}
              </Link>
            )
          })}
          <button onClick={() => setMenuOpen(o => !o)} className={cn('flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors', menuOpen ? 'text-accent' : 'text-slate-400 hover:text-slate-600')}>
            <MenuIcon className="h-[22px] w-[22px]" strokeWidth={menuOpen ? 2.4 : 2} />
            <span className="text-[10px] font-medium">Menu</span>
          </button>
        </div>
      </nav>

      {/* Full-screen menu (mobile) */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 flex flex-col animate-pm-fade"
          style={{
            backgroundColor: 'var(--accent)', color: 'var(--accent-fg)',
            transform: `translateY(${dragY}px)`,
            opacity: 1 - Math.min(dragY / 700, 0.35),
            transition: dragStart.current == null ? 'transform 240ms cubic-bezier(0.16,1,0.3,1), opacity 240ms' : 'none',
          }}
        >
          <div
            onPointerDown={onDragDown} onPointerMove={onDragMove} onPointerUp={onDragUp}
            onClick={() => { if (!moved.current) setMenuOpen(false) }}
            className="flex justify-center pb-2 cursor-grab active:cursor-grabbing"
            style={{ touchAction: 'none', paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}
          >
            <span className="h-1.5 w-12 rounded-full" style={{ backgroundColor: chip }} />
          </div>

          <div className="px-5 pb-6 text-center">
            {trainerLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={trainerLogo} alt={businessName ?? ''} className="h-10 w-auto max-w-[200px] object-contain mx-auto" />
            ) : (
              <p className="font-display text-2xl font-extrabold">{businessName ?? 'PupManager'}</p>
            )}
            {contacts.length > 0 && (
              <div className="mt-4 flex items-center justify-center gap-3">
                {contacts.map(c => (
                  <a key={c.label} href={c.href} target="_blank" rel="noreferrer" aria-label={c.label} className="flex h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: chip }}>
                    <c.icon className="h-5 w-5" />
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-10">
            <div className="rounded-2xl overflow-hidden">
              {menuItems.map((item, i) => {
                const Icon = item.icon
                return (
                  <Link key={item.href} href={item.href} className="w-full flex items-center gap-4 px-3 py-3.5 text-left" style={i > 0 ? { borderTop: `1px solid ${divider}` } : undefined}>
                    <span className="flex h-9 w-9 items-center justify-center shrink-0"><Icon className="h-5 w-5" /></span>
                    <span className="text-[15px] font-semibold flex-1">{item.label}</span>
                    <ChevronRight className="h-4 w-4 shrink-0" style={{ opacity: 0.5 }} />
                  </Link>
                )
              })}
            </div>
            <div className="mt-4 rounded-2xl overflow-hidden" style={{ borderTop: `1px solid ${divider}` }}>
              <button onClick={handleSignOut} className="w-full flex items-center gap-4 px-3 py-3.5 text-left">
                <span className="flex h-9 w-9 items-center justify-center shrink-0"><LogOut className="h-5 w-5" /></span>
                <span className="text-[15px] font-medium flex-1">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      )}
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
  streak,
  hiddenNavHrefs = [],
}: AppShellProps) {
  const pathname = usePathname()
  // Nav filtered to what this user's role/permissions allow.
  const trainerNav = TRAINER_NAV.filter(i => !hiddenNavHrefs.includes(i.href))
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

  const sidebarWidth = collapsed ? 'md:w-16' : 'md:w-64'
  const mainOffset = collapsed ? 'md:ml-16' : 'md:ml-64'

  const mobilePrimary = trainerNav.filter(i => TRAINER_MOBILE_PRIMARY_HREFS.has(i.href))
  const mobileSecondary = trainerNav.filter(i => !TRAINER_MOBILE_PRIMARY_HREFS.has(i.href))
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
          {trainerNav.map((item) => {
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

        {/* Always-visible engagement streak. The flex-1 <nav> above
            pushes this + the user block to the bottom of the sidebar.
            Clicking opens the full awards page. */}
        {streak && (
          <Link
            href="/awards"
            title={
              streak.current > 0
                ? `${streak.current}-training-day streak`
                : 'Start a streak — finish your notes on a training day'
            }
            className={cn(
              'animate-pm-pop mx-3 mb-2 flex items-center rounded-xl text-white transition-colors',
              streak.current > 0
                ? 'bg-orange-500 hover:bg-orange-600'
                : 'bg-slate-700 hover:bg-slate-800',
              collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2',
            )}
          >
            <Flame className="h-4 w-4 flex-shrink-0 text-white" />
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-tight">
                  {streak.current > 0
                    ? `${streak.current}-day streak`
                    : 'Start a streak'}
                </span>
                <span className="block text-[11px] text-white/80 leading-tight">
                  {streak.current > 0
                    ? 'Training days with notes done'
                    : 'Finish notes on a training day'}
                </span>
              </span>
            )}
            {collapsed && streak.current > 0 && (
              <span className="sr-only">{streak.current}-day streak</span>
            )}
          </Link>
        )}

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
                  onClick={() => signOutWithPush()}
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
                onClick={() => signOutWithPush()}
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
