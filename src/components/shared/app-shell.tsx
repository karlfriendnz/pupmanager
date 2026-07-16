'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, Fragment } from 'react'
import { usePathname } from 'next/navigation'
import { signOutWithPush } from '@/lib/sign-out'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, Calendar, Layers, Package,
  MessageSquare, Settings, HelpCircle, User, Trophy,
  Home, LogOut, ShoppingBag, CalendarPlus,
  MoreHorizontal, X, Inbox, GraduationCap,
  Dog, Menu as MenuIcon, Globe, Phone, Mail, ChevronRight, ChevronLeft, ChevronDown, ArrowLeftRight, Wallet,
  BarChart3, Clock, Navigation, FileText, MessagesSquare, Megaphone, Lock, ClipboardList,
  Download, Receipt,
  type LucideIcon,
} from 'lucide-react'
import { InstagramIcon } from '@/components/icons/instagram-icon'
import { stepKeyForLocation } from '@/lib/onboarding/path-step'
import { UnreadBadgeSync } from './unread-badge-sync'
import { VersionGuard } from './version-guard'
import { NotificationToaster } from './notification-toaster'
import { TopBarControls } from './top-bar-controls'
import { FloatingCreateButton } from './floating-create-button'
import { PageTitleProvider, usePageTitle } from './page-title'

const SIDEBAR_COLLAPSED_KEY = 'k9.trainerSidebarCollapsed'
const NAV_GROUPS_KEY = 'k10.trainerNavGroups'

// Grouped into sections rendered with small headers in the sidebar. A few
// destinations were trimmed from the top level to declutter:
//   • Draft notes lives on the Schedule toolbar
//   • Help + the profile/org switcher moved to the top-right control bar
// `desktopHidden` keeps Help out of the desktop sidebar while still showing it
// in the mobile "More" sheet (mobile has no top-right bar).
type NavSection = 'overview' | 'clients' | 'programs' | 'business' | 'system'
// `child` items render indented under the item above them (a sub-menu off
// their parent, e.g. Route + Notes under Schedule).
// `group: true` marks a non-navigating parent that only toggles its children
// (it has no page of its own). `comingSoon: true` renders a disabled child.
type NavItem = { href: string; label: string; icon: LucideIcon; section: NavSection; desktopHidden?: boolean; child?: boolean; group?: boolean; comingSoon?: boolean }

const TRAINER_NAV: NavItem[] = [
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard, section: 'overview' },

  { href: '/clients',      label: 'Clients',      icon: Users,           section: 'clients' },
  { href: '/sessions/draft-notes', label: 'Notes', icon: FileText,       section: 'clients', child: true },
  { href: '/clients/waitlist', label: 'Waitlist', icon: ClipboardList,   section: 'clients', child: true },
  { href: '/schedule',     label: 'Schedule',     icon: Calendar,        section: 'clients' },
  { href: '/schedule/route',       label: 'Route', icon: Navigation,     section: 'clients', child: true },
  { href: '/communication', label: 'Communication', icon: MessagesSquare, section: 'clients', group: true },
  { href: '/messages',     label: 'Messages',     icon: MessageSquare,   section: 'clients', child: true },
  { href: '/enquiries',    label: 'Enquiries',    icon: Inbox,           section: 'clients', child: true },
  { href: '/marketing',    label: 'Marketing',    icon: Megaphone,       section: 'clients', child: true },
  { href: '/lead-magnets', label: 'Lead magnets', icon: Download,        section: 'clients', child: true },
  { href: '/instagram',    label: 'Instagram link', icon: InstagramIcon as unknown as LucideIcon, section: 'clients', child: true },
  { href: '/email-templates', label: 'Email templates', icon: Mail,       section: 'clients', child: true },

  { href: '/packages',     label: '1:1 Packages', icon: Package,         section: 'programs' },
  { href: '/classes',      label: 'Group Classes', icon: GraduationCap,  section: 'programs' },
  { href: '/templates',    label: 'Library',      icon: Layers,          section: 'programs' },
  { href: '/products',     label: 'Products',     icon: ShoppingBag,     section: 'programs' },
  { href: '/achievements', label: 'Achievements', icon: Trophy,          section: 'programs' },

  { href: '/finances',     label: 'Finances',     icon: Wallet,          section: 'business' },
  { href: '/timesheets',   label: 'Timesheets',   icon: Clock,           section: 'business' },
  { href: '/reports',      label: 'Reports',      icon: BarChart3,       section: 'business' },
  // Add-ons + Integration now live as tabs inside Settings (top-right cog).

  // Settings is desktop-hidden — reachable via the top-bar cog on desktop and
  // the mobile "More" sheet. Help is likewise desktop-hidden (top-bar icon).
  { href: '/settings',     label: 'Settings',     icon: Settings,        section: 'system', desktopHidden: true },
  { href: '/help',         label: 'Help',         icon: HelpCircle,      section: 'system', desktopHidden: true },
]

// Section headers shown in the expanded sidebar (null = no header).
const NAV_SECTION_LABEL: Record<NavSection, string | null> = {
  overview: null,
  clients: 'Clients',
  programs: 'Programs',
  business: 'Business',
  system: null,
}

// On phones the bottom tab bar is limited to four primary destinations plus
// a "More" tab — anything not in this list lives in the More sheet.
const TRAINER_MOBILE_PRIMARY_HREFS = new Set([
  '/dashboard', '/clients', '/schedule', '/messages',
])

// Mobile bottom tabs (4 primary + a Menu hamburger added in the shell).
const CLIENT_TABS = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/my-availability', label: 'Book', icon: CalendarPlus },
  { href: '/my-sessions', label: 'Sessions', icon: Calendar },
  { href: '/my-messages', label: 'Messages', icon: MessageSquare },
]
// Everything a client can reach — the full-screen menu (mobile).
const CLIENT_MENU = [
  { href: '/my-availability', label: 'Book', icon: CalendarPlus },
  { href: '/my-sessions', label: 'Sessions', icon: Calendar },
  { href: '/my-messages', label: 'Messages', icon: MessageSquare },
  { href: '/my-shop', label: 'Shop', icon: ShoppingBag },
  { href: '/my-invoices', label: 'Invoices', icon: Receipt },
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
  /** Square brand mark. Preferred over trainerLogo for the trainer top-bar square. */
  trainerIcon?: string | null
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
   * Whether the top bar's "+" offers "New sale" — the instant-sale add-on is
   * on and this member may raise one. Computed in the trainer layout (server);
   * the API re-checks both, so this only governs whether the option is shown.
   */
  canSell?: boolean
  /** Trainer's payout currency, for money shown in the sale composer. */
  currency?: string
  /**
   * Trainer nav hrefs to hide for this user, based on their company role +
   * permissions (computed in the trainer layout). Owners/managers see
   * everything; staff only see what they can act on. Empty = show all.
   */
  hiddenNavHrefs?: string[]
  /**
   * Trainer nav hrefs whose add-on is currently OFF. These items are NOT
   * hidden — they render disabled with an "Add-on" badge and link to the
   * Add-ons settings tab so the trainer can turn the feature on. Empty = none.
   */
  addonLockedHrefs?: string[]
  /**
   * Client shell only: the trainer's public contact details, surfaced as
   * icon links in the full-screen menu header. Any null/missing value is
   * simply not rendered.
   */
  trainerContact?: { website?: string | null; phone?: string | null; email?: string | null }
  /** Client shell only: show a "Switch trainer" entry (client has 2+ trainers). */
  showTrainerSwitcher?: boolean
  /**
   * Trainer shell only: the organisations this user belongs to (their own +
   * any they're a team member at). When 2+, the sidebar shows an org switcher.
   */
  orgs?: { id: string; name: string; role: string }[]
  /** Trainer shell only: the currently active business id (session.user.trainerId). */
  activeCompanyId?: string | null
  /**
   * Client shell only: when set (the trainer's demo/preview), "Sign out"
   * navigates here instead of actually signing out — so a previewing trainer
   * lands back on their dashboard without having to log in again.
   */
  previewExitHref?: string | null
}

// How often the nav badge re-checks the unread count (also refetches on window
// focus / tab-visible and on the `pm:refresh-unread` event a thread fires when
// it's opened). Cheap: one count query, and only while the tab is visible.
const UNREAD_POLL_MS = 10_000

// Keeps the messages nav badge fresh WITHOUT a full reload. Seeds from the
// server-rendered `initial`, adopts a newer server value on navigation (render-
// time state sync — the endorsed alternative to a set-state-in-effect), then
// polls the lightweight /api/messages/unread-count while the tab is visible.
function useLiveUnreadTotal(initial: number, enabled: boolean, url = '/api/messages/unread-count'): number {
  const [seenInitial, setSeenInitial] = useState(initial)
  const [count, setCount] = useState(initial)
  if (initial !== seenInitial) {
    setSeenInitial(initial)
    setCount(initial)
  }

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const refetch = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && typeof data.count === 'number') setCount(data.count)
      } catch { /* transient — leave the last known count */ }
    }
    const onTrigger = () => { void refetch() }
    const onVisible = () => { if (document.visibilityState === 'visible') void refetch() }
    const id = setInterval(refetch, UNREAD_POLL_MS)
    window.addEventListener('focus', onTrigger)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pm:refresh-unread', onTrigger)
    return () => {
      cancelled = true
      clearInterval(id)
      window.removeEventListener('focus', onTrigger)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pm:refresh-unread', onTrigger)
    }
  }, [enabled, url])

  return count
}

// Instant in-app notification badge via Server-Sent Events — the server pushes
// the unread count the moment it changes (new notification, or the user reading
// them), so there's no poll interval / latency. Seeds from the server-rendered
// `initial` and re-syncs it on navigation (e.g. opening the feed clears to 0).
// EventSource auto-reconnects, so the ~250s server-side stream rotation is
// seamless.
function useLiveNotificationCount(initial: number, enabled: boolean): number {
  const [seenInitial, setSeenInitial] = useState(initial)
  const [count, setCount] = useState(initial)
  if (initial !== seenInitial) {
    setSeenInitial(initial)
    setCount(initial)
  }

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const es = new EventSource('/api/notifications/stream')
    es.addEventListener('count', (ev) => {
      try {
        const d = JSON.parse((ev as MessageEvent).data)
        if (typeof d.count === 'number') setCount(d.count)
      } catch { /* ignore malformed events */ }
    })
    // Re-broadcast fresh arrivals so <NotificationToaster> can pop a toast,
    // reusing this single stream connection.
    es.addEventListener('new', (ev) => {
      try {
        const d = JSON.parse((ev as MessageEvent).data)
        if (d?.id) window.dispatchEvent(new CustomEvent('pm:notification', { detail: d }))
      } catch { /* ignore malformed events */ }
    })
    return () => es.close()
  }, [enabled])

  return count
}

export function AppShell(props: AppShellProps) {
  const messagesHref = props.role === 'CLIENT' ? '/my-messages' : '/messages'
  // Only poll when the user actually has messaging (client always; trainer when
  // the /messages item isn't hidden by role/add-on).
  const messagesVisible = props.role === 'CLIENT' || !(props.hiddenNavHrefs ?? []).includes('/messages')
  const liveTotal = useLiveUnreadTotal(props.unreadTotal ?? 0, messagesVisible)
  // The trainer's in-app notifications bell polls its own count so a client
  // logging a session (etc.) lights the badge without a manual refresh.
  const notificationsVisible = props.role === 'TRAINER'
  const liveNotifs = useLiveNotificationCount(props.unreadCounts?.['/notifications'] ?? 0, notificationsVisible)
  // Override the messages badge (and the client Home hint) + the notifications
  // bell with their live numbers.
  const effectiveCounts = {
    ...props.unreadCounts,
    ...(messagesVisible
      ? { [messagesHref]: liveTotal, ...(props.role === 'CLIENT' ? { '/home': liveTotal } : {}) }
      : {}),
    ...(notificationsVisible ? { '/notifications': liveNotifs } : {}),
  }

  return (
    <>
      <VersionGuard />
      <UnreadBadgeSync total={messagesVisible ? liveTotal : props.unreadTotal ?? 0} />
      {notificationsVisible && <NotificationToaster />}
      {props.role === 'CLIENT'
        ? <ClientShell {...props} unreadCounts={effectiveCounts} />
        : <TrainerShell {...props} unreadCounts={effectiveCounts} />}
    </>
  )
}

// ─── Client shell ────────────────────────────────────────────────────────────
// PupManager-branded client app. Mobile: full-bleed pages + bottom tab bar +
// a full-screen pull-down Menu. Desktop (md+): left sidebar, content fills.

function ClientShell({ children, trainerLogo, businessName, clientNavHints, unreadCounts = {}, trainerContact, showTrainerSwitcher, previewExitHref, hiddenNavHrefs = [] }: AppShellProps) {
  const handleSignOut = () => {
    if (previewExitHref) { window.location.href = previewExitHref; return }
    signOutWithPush()
  }
  const pathname = usePathname()
  // Append a "Switch trainer" entry when the client works with 2+ trainers.
  const switchItem = { href: '/switch-trainer', label: 'Switch trainer', icon: ArrowLeftRight }
  // Hide any nav item the trainer's add-ons disable (e.g. /my-shop when the
  // client-shop add-on is off).
  const shown = <T extends { href: string }>(items: T[]) => items.filter(i => !hiddenNavHrefs.includes(i.href))
  const menuItems = shown(showTrainerSwitcher ? [...CLIENT_MENU, switchItem] : CLIENT_MENU)
  const sidebarItems = shown(showTrainerSwitcher ? [...CLIENT_SIDEBAR, switchItem] : CLIENT_SIDEBAR)
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

// Add-on-locked nav row. Renders a DISABLED-looking entry (greyed text/icon +
// an "Add-on" pill) that still navigates to the Add-ons settings tab so the
// trainer can turn the feature on. Never shows the active/blue state. One
// component covers every render site via the `variant` prop so the locked
// treatment stays consistent (and DRY) across collapsed rail, expanded
// sidebar, hover flyout, and the mobile nav.
const ADDON_SETTINGS_HREF = '/settings?tab=addons'
const ADDON_LOCK_TITLE = 'This is an add-on — turn it on in Add-ons'
function LockedNavRow({
  item,
  variant,
}: {
  item: NavItem
  variant: 'top-collapsed' | 'top-expanded' | 'child-flyout' | 'child-expanded' | 'mobile-grid' | 'mobile-tab'
}) {
  const Icon = item.icon
  // Reuses the rounded-pill styling of the "Soon" badge, reading "Add-on".
  const pill = (cls: string) => (
    <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', cls)}>Add-on</span>
  )
  switch (variant) {
    case 'top-collapsed':
      // Collapsed rail: single centred icon + a small lock overlay, no label.
      return (
        <Link
          href={ADDON_SETTINGS_HREF}
          title={ADDON_LOCK_TITLE}
          className="relative flex items-center justify-center h-10 w-10 mx-auto rounded-xl text-slate-400 hover:bg-slate-50 transition-colors"
        >
          <Icon className="h-5 w-5 flex-shrink-0" />
          <Lock aria-hidden className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 text-slate-400" />
        </Link>
      )
    case 'top-expanded':
      return (
        <Link
          href={ADDON_SETTINGS_HREF}
          title={ADDON_LOCK_TITLE}
          className="relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-slate-50 transition-colors"
        >
          <Icon className="h-5 w-5 flex-shrink-0 text-slate-300" />
          {item.label}
          {pill('ml-auto bg-slate-100 text-slate-400')}
        </Link>
      )
    case 'child-flyout':
      return (
        <Link
          href={ADDON_SETTINGS_HREF}
          title={ADDON_LOCK_TITLE}
          className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-400 hover:bg-slate-50"
        >
          <Icon className="h-4 w-4 text-slate-300" /> {item.label}
          {pill('ml-auto bg-slate-100 text-slate-400')}
        </Link>
      )
    case 'child-expanded':
      return (
        <Link
          href={ADDON_SETTINGS_HREF}
          title={ADDON_LOCK_TITLE}
          className="relative flex items-center gap-3 rounded-xl pl-9 py-2 text-sm font-medium text-slate-400 hover:bg-slate-50 transition-colors"
        >
          <Icon className="h-4 w-4 flex-shrink-0 text-slate-300" />
          {item.label}
          {pill('ml-auto bg-slate-100 text-slate-400')}
        </Link>
      )
    case 'mobile-grid':
      return (
        <Link
          href={ADDON_SETTINGS_HREF}
          title={ADDON_LOCK_TITLE}
          className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium bg-slate-50 text-slate-400"
        >
          <Icon className="h-5 w-5 flex-shrink-0 text-slate-300" />
          {item.label}
          {pill('ml-auto bg-slate-200 text-slate-500')}
        </Link>
      )
    case 'mobile-tab':
      // Bottom-bar primary tab: vertical icon + label, lock overlay on the icon.
      return (
        <Link
          href={ADDON_SETTINGS_HREF}
          title={ADDON_LOCK_TITLE}
          className="relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-slate-300"
        >
          <Icon className="h-5 w-5" />
          <span className="text-[10px] font-medium text-slate-400">{item.label}</span>
          <Lock aria-hidden className="absolute top-1.5 right-[22%] h-3 w-3 text-slate-400 ring-2 ring-white rounded-full bg-white" />
        </Link>
      )
  }
}

// Full-width desktop top bar: [logo + business name | collapse] [page title] …
// [streak · search · settings · account · help]. Consumes the page-title
// context so each page's title shows here. Mobile keeps its own bottom bar.
function TrainerTopBar({
  collapsed,
  onToggle,
  trainerLogo,
  trainerIcon,
  businessName,
  fallbackTitle,
  userName,
  userEmail,
  orgs,
  activeCompanyId,
  streak,
  canSell = false,
  currency = 'nzd',
  notifCount = 0,
}: {
  collapsed: boolean
  onToggle: () => void
  trainerLogo?: string | null
  trainerIcon?: string | null
  businessName?: string | null
  fallbackTitle: string
  userName?: string | null
  userEmail?: string | null
  orgs?: { id: string; name: string; role: string }[]
  activeCompanyId?: string | null
  streak?: { current: number } | null
  canSell?: boolean
  currency?: string
  notifCount?: number
}) {
  const title = usePageTitle() ?? fallbackTitle
  return (
    <header className="hidden md:flex fixed top-0 inset-x-0 z-40 h-14 items-center border-b border-slate-100 bg-white/85 backdrop-blur">
      {/* Logo zone — aligned to the sidebar width so it sits above it. */}
      <div className={cn('flex items-center h-full shrink-0 border-r border-slate-100 transition-all duration-200 overflow-hidden', collapsed ? 'w-16 justify-center px-2' : 'w-64 gap-3 px-5')}>
        {/* Logo fits inside a fixed square box (object-contain, never cropped),
            with the org name beside it when expanded. */}
        {trainerIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          // Icon is a square brand mark (often transparent) — render it clean,
          // no white box / ring behind it.
          <img src={trainerIcon} alt={businessName ?? 'Icon'} className="h-8 w-8 rounded-lg object-contain shrink-0" />
        ) : trainerLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={trainerLogo} alt={businessName ?? 'Logo'} className="h-8 w-8 rounded-lg object-contain bg-white ring-1 ring-slate-100 shrink-0" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/logo.png" alt={businessName ?? 'PupManager'} className="h-8 w-8 rounded-lg shrink-0" />
        )}
        {!collapsed && (
          <span className="font-semibold text-slate-900 truncate">{businessName ?? 'PupManager'}</span>
        )}
      </div>
      {/* Collapse toggle — just past the sidebar border. */}
      <button
        type="button"
        onClick={onToggle}
        title={collapsed ? 'Expand menu' : 'Collapse menu'}
        aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        className="ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
      >
        {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
      </button>
      {/* Back-arrow slot — pages portal a back button here (detail pages). */}
      <div id="pm-topbar-back" className="ml-2 flex items-center empty:hidden" />
      {/* Page title. */}
      <h1 className="ml-2 min-w-0 flex-1 truncate text-base font-semibold text-slate-900">{title}</h1>
      {/* Page-actions slot — pages portal their action buttons here instead of
          a redundant second header row. */}
      <div id="pm-topbar-actions" className="mr-2 flex items-center gap-1.5 empty:hidden" />
      {/* Right-hand controls. */}
      <div className="pr-3 lg:pr-5">
        <TopBarControls userName={userName} userEmail={userEmail} orgs={orgs} activeCompanyId={activeCompanyId} streak={streak} notifCount={notifCount} />
      </div>
    </header>
  )
}

function TrainerShell({
  children,
  userName,
  userEmail,
  trainerLogo,
  trainerIcon,
  businessName,
  highlightMenuHref,
  completedStepKeys = [],
  unreadCounts = {},
  streak,
  canSell = false,
  currency = 'nzd',
  hiddenNavHrefs = [],
  addonLockedHrefs = [],
  orgs = [],
  activeCompanyId = null,
}: AppShellProps) {
  const pathname = usePathname()
  // Nav filtered to what this user's role/permissions allow. Add-on items
  // whose add-on is OFF are hidden entirely (same as permission-hidden items),
  // so the left menu only ever lists features the trainer actually has on.
  const trainerNav = TRAINER_NAV.filter(
    i => !hiddenNavHrefs.includes(i.href) && !addonLockedHrefs.includes(i.href),
  )
  // Retained for the (now unused) locked-row branches below — left in place so
  // switching back to "show disabled with upsell" is a one-line revert.
  const lockedAddons = new Set<string>()
  // Desktop: child items (e.g. Route + Notes under Schedule) don't render as
  // their own rows — they collapse into a hover flyout on their parent. Mobile
  // keeps them as flat items in the "More" sheet.
  const childrenOf: Record<string, NavItem[]> = {}
  {
    let parent: string | null = null
    for (const it of trainerNav) {
      if (it.child) { if (parent) (childrenOf[parent] ??= []).push(it) }
      else parent = it.href
    }
  }
  const desktopNav = trainerNav.filter(i => !i.desktopHidden && !i.child)
  const [collapsed, setCollapsed] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  // Submenu flyouts render position:fixed so they escape the nav's
  // overflow-y-auto clip; we capture the hovered row's top on mouseenter.
  const [flyoutTop, setFlyoutTop] = useState(0)
  // Expanded-sidebar groups (Clients, Schedule, Communication) are CLOSED by
  // default — they only open when the trainer clicks the chevron, and that
  // choice is remembered (persisted). No auto-open based on the current route.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const isGroupActive = (href: string) =>
    (childrenOf[href] ?? []).some(c => pathname === c.href || pathname.startsWith(c.href + '/'))
  const isGroupOpen = (href: string) => openGroups[href] ?? false
  function toggleGroup(href: string) {
    const next = !isGroupOpen(href)
    setOpenGroups(prev => {
      const merged = { ...prev, [href]: next }
      if (typeof window !== 'undefined') window.localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(merged))
      return merged
    })
  }

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) : null
    let next = false
    if (stored === '1') next = true
    else if (stored === '0') next = false
    // Auto-collapse the narrow-desktop window, but NOT touch tablets: their
    // only way to reach child nav items is the inline rows the expanded
    // sidebar renders (they can't trigger the collapsed hover flyout).
    else if (typeof window !== 'undefined' && window.innerWidth < 1024 && !window.matchMedia('(hover: none)').matches) next = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(next)
    try {
      const groups = window.localStorage.getItem(NAV_GROUPS_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (groups) setOpenGroups(JSON.parse(groups))
    } catch { /* ignore malformed storage */ }
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
  // Settings has its OWN left rail (Profile / Notifications / Add-ons / …), so
  // the app's main menu alongside it is two menus fighting for the same job.
  // Hide it in there and give the width back to the content; the top bar's back
  // arrow (and the logo) are still the way out.
  const inSettings = pathname === '/settings' || pathname.startsWith('/settings/')
  const mainOffset = inSettings ? '' : collapsed ? 'md:ml-16' : 'md:ml-64'

  function toggleCollapse() {
    setCollapsed(c => {
      const next = !c
      if (typeof window !== 'undefined') window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }

  // Group parents (e.g. Communication) don't navigate, so they never appear on
  // mobile — their children surface directly in the bottom bar / More sheet.
  const mobilePrimary = trainerNav.filter(i => !i.group && TRAINER_MOBILE_PRIMARY_HREFS.has(i.href))
  const mobileSecondary = trainerNav.filter(i => !i.group && !TRAINER_MOBILE_PRIMARY_HREFS.has(i.href))
  const isOnSecondary = mobileSecondary.some(i => pathname === i.href || pathname.startsWith(i.href + '/'))

  // Top-bar title fallback for pages that don't set one (e.g. /schedule): the
  // longest-matching nav label for the current route.
  const navFallbackTitle = trainerNav
    .filter(i => !i.group && (pathname === i.href || pathname.startsWith(i.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? ''

  return (
    <PageTitleProvider>
    <div className="flex min-h-screen flex-col md:flex-row">
      <TrainerTopBar
        collapsed={collapsed}
        onToggle={toggleCollapse}
        trainerLogo={trainerLogo}
        trainerIcon={trainerIcon}
        businessName={businessName}
        fallbackTitle={navFallbackTitle}
        userName={userName}
        userEmail={userEmail}
        orgs={orgs}
        activeCompanyId={activeCompanyId}
        streak={streak}
        canSell={canSell}
        currency={currency}
        notifCount={unreadCounts['/notifications'] ?? 0}
      />

      {/* Sidebar — sits below the full-width top bar (which owns the logo).
          Hidden inside Settings, which brings its own rail. */}
      <aside className={cn('hidden md:flex-col md:fixed md:top-14 md:bottom-0 md:left-0 md:z-40 bg-white border-r border-slate-100 transition-all duration-200', inSettings ? 'md:hidden' : 'md:flex', sidebarWidth)}>
        <nav className={cn('flex-1 overflow-y-auto py-4 space-y-1', collapsed ? 'px-2' : 'px-3')}>
          {desktopNav.map((item, idx, arr) => {
            // Section grouping: emit a small header (expanded) or a divider
            // (collapsed / system group) at each section boundary.
            const sectionChanged = idx === 0 || arr[idx - 1].section !== item.section
            const sectionHeader = !collapsed && sectionChanged ? NAV_SECTION_LABEL[item.section] : null
            const showDivider = sectionChanged && idx > 0 && (item.section === 'system' || collapsed)
            // Add-on OFF: render disabled-with-upsell (never active/blue), still
            // keeping the section header/divider so the layout stays intact.
            if (lockedAddons.has(item.href)) {
              return (
                <Fragment key={item.href}>
                  {sectionHeader && (
                    <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{sectionHeader}</p>
                  )}
                  {showDivider && !sectionHeader && (
                    <div className={cn('border-t border-slate-100', collapsed ? 'mx-2 my-2' : 'mx-3 my-2')} />
                  )}
                  <LockedNavRow item={item} variant={collapsed ? 'top-collapsed' : 'top-expanded'} />
                </Fragment>
              )
            }
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
            const kids = childrenOf[item.href]
            const isGroup = !!item.group
            // Group parents don't navigate, so their "active" state mirrors
            // whichever child route you're on. Non-group rows use plain `active`.
            const rowActive = isGroup ? isGroupActive(item.href) : active
            // When a group is collapsed its children's unread is rolled up onto
            // the parent so the count stays visible; expanded, the kids show it.
            const groupRollup = isGroup && kids && !isGroupOpen(item.href)
              ? kids.reduce((s, c) => s + (unreadCounts[c.href] ?? 0), 0)
              : 0
            const rowBadge = isGroup ? groupRollup : (unreadCounts[item.href] ?? 0)
            const rowCls = cn(
              'relative flex items-center rounded-xl text-sm font-medium transition-colors',
              collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5',
              !collapsed && item.child && 'pl-9 py-2',
              !collapsed && kids && 'pr-9', // leave room for the chevron toggle
              rowActive
                ? 'bg-blue-50 text-blue-700'
                : item.child
                  ? 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              isGroup && 'w-full text-left cursor-pointer',
            )
            const rowInner = (
              <>
                <Icon className={cn('flex-shrink-0', item.child ? 'h-4 w-4' : 'h-5 w-5')} />
                {!collapsed && item.label}
                {!collapsed && <NavBadge count={rowBadge} />}
                {/* Collapsed rail hides the pill — overlay a dot on the icon. */}
                {collapsed && rowBadge > 0 && (
                  <span aria-hidden className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />
                )}
                {highlighted && (
                  <span aria-hidden className="absolute right-2 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-indigo-500 animate-pm-menu-dot" />
                )}
              </>
            )
            return (
              <Fragment key={item.href}>
                {sectionHeader && (
                  <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{sectionHeader}</p>
                )}
                {showDivider && !sectionHeader && (
                  <div className={cn('border-t border-slate-100', collapsed ? 'mx-2 my-2' : 'mx-3 my-2')} />
                )}
              <div
                className={cn('relative', childrenOf[item.href] && 'group/sub')}
                onMouseEnter={childrenOf[item.href] ? (e) => setFlyoutTop(e.currentTarget.getBoundingClientRect().top) : undefined}
              >
              {isGroup ? (
                // Group parent: a non-navigating toggle (no page of its own).
                <button
                  type="button"
                  onClick={() => toggleGroup(item.href)}
                  title={collapsed ? item.label : undefined}
                  aria-expanded={isGroupOpen(item.href)}
                  className={rowCls}
                >
                  {rowInner}
                </button>
              ) : (
                <Link href={item.href} title={collapsed ? item.label : undefined} className={rowCls}>
                  {rowInner}
                </Link>
              )}
              {/* Chevron toggles the inline child group. It's a sibling of the
                  row Link (can't nest interactive elements) overlaid on the
                  right edge. */}
              {!collapsed && childrenOf[item.href] && (
                <button
                  type="button"
                  onClick={() => toggleGroup(item.href)}
                  aria-label={`${isGroupOpen(item.href) ? 'Collapse' : 'Expand'} ${item.label}`}
                  aria-expanded={isGroupOpen(item.href)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <ChevronDown className={cn('h-4 w-4 transition-transform', !isGroupOpen(item.href) && '-rotate-90')} />
                </button>
              )}
              {/* Collapsed icon rail: children have no inline labels, so expose
                  them via a hover flyout ("View X" + the children). Expanded
                  mode lists them inline instead (below), which keeps them
                  tappable on touch devices that can't trigger a hover. */}
              {collapsed && childrenOf[item.href] && (
                <div
                  className="invisible opacity-0 group-hover/sub:visible group-hover/sub:opacity-100 fixed z-50 transition-opacity duration-100"
                  // Start the flyout at the trigger row's right edge (nav has
                  // px-2 padding, so the row ends short of the sidebar edge) and
                  // pad it back out, so the invisible padding bridges the gap
                  // continuously — no dead strip to drop the hover on.
                  style={{ top: flyoutTop, left: 56, paddingLeft: 14 }}
                >
                  <div className="min-w-[12rem] rounded-xl border border-slate-200 bg-white py-1 shadow-[0_18px_45px_-12px_rgba(15,23,42,0.25)]">
                    {/* Group parents have no page of their own — skip "View X". */}
                    {!isGroup && (
                      <>
                        <Link href={item.href} className="flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                          <Icon className="h-4 w-4 text-slate-400" /> View {item.label.toLowerCase()}
                        </Link>
                        <div className="my-1 border-t border-slate-100" />
                      </>
                    )}
                    {childrenOf[item.href].map(c => {
                      const cActive = pathname === c.href || pathname.startsWith(c.href + '/')
                      const CIcon = c.icon
                      if (lockedAddons.has(c.href)) {
                        return <LockedNavRow key={c.href} item={c} variant="child-flyout" />
                      }
                      if (c.comingSoon) {
                        return (
                          <span key={c.href} className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-400 cursor-default">
                            <CIcon className="h-4 w-4 text-slate-300" /> {c.label}
                            <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Soon</span>
                          </span>
                        )
                      }
                      return (
                        <Link key={c.href} href={c.href} className={cn('flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50', cActive ? 'text-blue-700' : 'text-slate-600')}>
                          <CIcon className="h-4 w-4 text-slate-400" /> {c.label}
                          <NavBadge count={unreadCounts[c.href] ?? 0} />
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}
              </div>
              {/* Expanded sidebar: render children as indented rows so they're
                  reachable by tap — touch tablets can't trigger the collapsed
                  hover flyout. The chevron collapses the group. */}
              {!collapsed && isGroupOpen(item.href) && childrenOf[item.href]?.map(c => {
                const cActive = pathname === c.href || pathname.startsWith(c.href + '/')
                const CIcon = c.icon
                if (lockedAddons.has(c.href)) {
                  return <LockedNavRow key={c.href} item={c} variant="child-expanded" />
                }
                if (c.comingSoon) {
                  return (
                    <div
                      key={c.href}
                      title="Coming soon"
                      className="relative flex items-center gap-3 rounded-xl pl-9 py-2 text-sm font-medium text-slate-400 cursor-default"
                    >
                      <CIcon className="h-4 w-4 flex-shrink-0" />
                      {c.label}
                      <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Soon</span>
                    </div>
                  )
                }
                return (
                  <Link
                    key={c.href}
                    href={c.href}
                    className={cn(
                      'relative flex items-center gap-3 rounded-xl pl-9 py-2 text-sm font-medium transition-colors',
                      cActive ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                    )}
                  >
                    <CIcon className="h-4 w-4 flex-shrink-0" />
                    {c.label}
                    <NavBadge count={unreadCounts[c.href] ?? 0} />
                  </Link>
                )
              })}
              </Fragment>
            )
          })}
        </nav>

        {/* Streak moved to the top-right control bar. */}

      </aside>

      {/* No mobile header on the trainer side. The bottom tab bar covers
          nav, and per-page sticky bars (e.g. session detail) own their
          own safe-area-inset-top. Pages without a sticky bar fall back
          to the <main> safe-area pad below. */}

      {/* Mobile "+" — the phone counterpart to the desktop control bar's, which
          is hidden below md. Dashboard only, so it never covers another page's
          primary action. */}
      {pathname === '/dashboard' && <FloatingCreateButton canSell={canSell} currency={currency} />}

      {/* Mobile bottom tab bar — 4 primary destinations + More */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-slate-100 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {mobilePrimary.map((item) => {
            if (lockedAddons.has(item.href)) {
              return <LockedNavRow key={item.href} item={item} variant="mobile-tab" />
            }
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
                if (lockedAddons.has(item.href)) {
                  return <LockedNavRow key={item.href} item={item} variant="mobile-grid" />
                }
                if (item.comingSoon) {
                  return (
                    <div
                      key={item.href}
                      className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium bg-slate-50 text-slate-400 cursor-default"
                    >
                      <Icon className="h-5 w-5 flex-shrink-0" />
                      {item.label}
                      <span className="ml-auto rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">Soon</span>
                    </div>
                  )
                }
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
        // --app-top-offset reserves the desktop top-bar height (the fixed bar is
        // out of flow) so content clears it and PageHeader toolbar rows stick
        // just beneath it. 0 on mobile (no top bar there).
        className={cn('flex-1 flex flex-col min-h-0 pb-20 md:pb-0 transition-all duration-200 [--app-top-offset:0px] md:[--app-top-offset:3.5rem]', mainOffset)}
        // Clear the fixed top bar on desktop; on mobile fall back to a capped
        // safe-area pad below iOS chrome. Pages that own a sticky bar can break
        // out via negative margin and handle safe-area themselves.
        style={{ paddingTop: 'calc(var(--app-top-offset, 0px) + min(env(safe-area-inset-top, 0px), 1rem))' }}
      >
        {children}
      </main>
    </div>
    </PageTitleProvider>
  )
}
