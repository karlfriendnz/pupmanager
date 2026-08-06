'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, Fragment, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { signOutWithPush } from '@/lib/sign-out'
import { ProfileSwitchButton } from './profile-switch-button'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, Calendar, Layers, Package,
  MessageSquare, Settings, HelpCircle, User, Trophy,
  Home, LogOut, ShoppingBag, CalendarPlus,
  X, Inbox, GraduationCap, Bell,
  Dog, Menu as MenuIcon, Globe, Phone, Mail, ChevronRight, ChevronLeft, ChevronDown, ArrowLeftRight, Wallet,
  BarChart3, Clock, Navigation, FileText, Megaphone, Lock, ClipboardList,
  type LucideIcon, Ticket, CircleDollarSign,} from 'lucide-react'
import { InstagramIcon } from '@/components/icons/instagram-icon'
import { stepKeyForLocation } from '@/lib/onboarding/path-step'
import { UnreadBadgeSync } from './unread-badge-sync'
import { VersionGuard } from './version-guard'
import { NotificationToaster } from './notification-toaster'
import { TopBarControls } from './top-bar-controls'
import { FloatingCreateButton } from './floating-create-button'
import { PageTitleProvider, NavLabelProvider, usePageTitle, usePageSubtitle, usePageHasBack, usePageImmersive, usePageImmersiveKeepsTopBar } from './page-title'
import { FlatRow, FlatRowGrid } from './flat-list'
import { shouldShowSectionHeader, labelFor, sectionKey, clientLabelFor } from '@/lib/nav-labels'

const SIDEBAR_COLLAPSED_KEY = 'k9.trainerSidebarCollapsed'
const NAV_GROUPS_KEY = 'k10.trainerNavGroups'

// Grouped into sections rendered with small headers in the sidebar. A few
// destinations were trimmed from the top level to declutter:
//   • Draft notes lives on the Schedule toolbar
//   • Help + the profile/org switcher moved to the top-right control bar
// `desktopHidden` keeps Help out of the desktop sidebar while still showing it
// in the mobile "More" sheet (mobile has no top-right bar).
type NavSection = 'overview' | 'clients' | 'programs' | 'tools' | 'business' | 'system'
// `child` items render indented under the item above them (a sub-menu off
// their parent, e.g. Route + Notes under Schedule).
// `group: true` marks a non-navigating parent that only toggles its children
// (it has no page of its own). `comingSoon: true` renders a disabled child.
type NavItem = { href: string; label: string; icon: LucideIcon; section: NavSection; desktopHidden?: boolean; child?: boolean; group?: boolean; comingSoon?: boolean }

const TRAINER_NAV: NavItem[] = [
  // The three a trainer opens every day, above the section headers.
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard, section: 'overview' },
  { href: '/messages',     label: 'Messages',     icon: MessageSquare,   section: 'overview' },
  { href: '/schedule',     label: 'Schedule',     icon: Calendar,        section: 'overview' },
  // No Availability entry. It was added here when the schedule's cog button lost
  // its "View" label and Karl couldn't find the setting; it goes back to living
  // in that panel alone (Karl, 2026-08-02). Its lock in nav-labels.ts stays put
  // on purpose — belt and braces, so a future re-add doesn't quietly become
  // renameable.

  { href: '/clients',      label: 'Clients',      icon: Users,           section: 'clients' },
  { href: '/enquiries',    label: 'Enquiries',    icon: Inbox,           section: 'clients', child: true },
  { href: '/sessions/draft-notes', label: 'Notes', icon: FileText,       section: 'clients', child: true },
  { href: '/clients/waitlist', label: 'Waitlist', icon: ClipboardList,   section: 'clients', child: true },

  { href: '/packages',     label: '1:1 Sessions', icon: Package,         section: 'programs' },
  { href: '/classes',      label: 'Group Classes', icon: GraduationCap,  section: 'programs' },
  { href: '/casual-classes',     label: 'Casual Classes',     icon: Ticket,           section: 'programs' },
  { href: '/events',       label: 'Events',       icon: CalendarPlus,    section: 'programs' },
  // Hidden again (Karl, 2026-07-29). The pages and routes still work and the
  // add-on still grants access — this only takes it out of the nav while the
  // feature is unfinished. Restore this line to bring it back; it is HIDDEN
  // rather than locked for anyone without the add-on (see hiddenNavHrefs in
  // (trainer)/layout.tsx), because a locked "turn it on" row would advertise
  // the very thing we are keeping quiet.
  // { href: '/doggy-daycare', label: 'Doggy Daycare', icon: Dog,      section: 'programs' },
  // Back in the nav (Karl, 2026-07-29), same treatment as Doggy Daycare: HIDDEN
  // rather than locked for anyone without the add-on (see hiddenNavHrefs in
  // (trainer)/layout.tsx), and the add-on itself is `hidden` so it is not
  // advertised while the feature is unfinished.
  { href: '/memberships',  label: 'Packages',   icon: Ticket,          section: 'programs' },
  // Tags used to sit here, last in Offerings. It moved into Settings (Karl,
  // 2026-08-06: "please move tags to settings area") — a tag is not a sixth
  // kind of thing to sell, it is configuration: a word that crosses all five
  // and the shop besides. Settings → Tags now, and /offerings/tags redirects
  // there. Removed from NAV_LABEL_CATALOG with it; the catalogue mirrors this
  // list and its drift test fails on a stale row.

  // Not offerings themselves — the things that support them.
  { href: '/schedule/route', label: 'Route',      icon: Navigation,      section: 'tools' },
  { href: '/library',      label: 'Library',      icon: Layers,          section: 'tools' },
  { href: '/products',     label: 'Products',     icon: ShoppingBag,     section: 'tools' },
  { href: '/achievements', label: 'Achievements', icon: Trophy,          section: 'tools' },

  // Marketing sits in Business, not Clients: reaching people who aren't
  // clients yet is running the business, not servicing the book.
  // Lead magnets, Instagram and Emails were children of Marketing. They're each
  // a place a trainer goes to do a job, not a sub-setting of one — nesting them
  // cost a tap and hid them. Top level in Business now (Karl, 2026-07-26).
  { href: '/marketing',    label: 'Marketing',    icon: Megaphone,       section: 'business' },
  // Lead magnets hidden for now (Karl, 2026-07-27), same treatment as Doggy
  // Daycare — the page and route still work, it just isn't offered in the nav.
  // To restore: uncomment, and re-add `Download` to the lucide import above.
  // { href: '/lead-magnets', label: 'Lead magnets', icon: Download,     section: 'business' },
  { href: '/instagram',    label: 'Instagram link', icon: InstagramIcon as unknown as LucideIcon, section: 'business' },

  { href: '/finances',     label: 'Finances',     icon: Wallet,          section: 'business' },
  { href: '/finances/stripe', label: 'Stripe',      icon: CircleDollarSign, section: 'business' },
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
  programs: 'Offerings',
  tools: 'Tools',
  business: 'Business',
  system: null,
}

// The phone menu labels every group and takes them in this order. The sidebar
// leaves the first and last unlabelled, which works beside a heading but not as
// a bare grid of tiles.
const MENU_SECTION_ORDER: NavSection[] = ['overview', 'clients', 'programs', 'tools', 'business', 'system']
const MENU_SECTION_LABEL: Record<NavSection, string> = {
  overview: 'Overview',
  clients: 'Clients',
  programs: 'Offerings',
  tools: 'Tools',
  business: 'Business',
  system: 'Account',
}

// The phone's five bottom tabs, in the order they appear. The More sheet moved
// to the header hamburger, so the fifth slot goes to the to-do list (past
// sessions still needing a write-up or an invoice) — the thing a trainer
// actually opens between clients — rather than to a menu.
//
// Icons/labels are declared here rather than looked up from TRAINER_NAV because
// /sessions/needs-notes isn't a nav row of its own.
const TRAINER_MOBILE_TABS: { href: string; label: string; icon: LucideIcon; needsNav?: string }[] = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/schedule', label: 'Schedule', icon: Calendar },
  // To do over Clients: it's the one screen a trainer keeps coming back to
  // between sessions (notes owed, invoices owed, their own list). Clients is a
  // home tile and the search's whole job, so it's never more than a tap away.
  // Gated by the same add-on as the Notes nav row.
  { href: '/sessions/needs-notes', label: 'To do', icon: ClipboardList, needsNav: '/sessions/draft-notes' },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/notifications', label: 'Alerts', icon: Bell },
]
// Anything not a tab lives in the More sheet.
const TRAINER_MOBILE_PRIMARY_HREFS = new Set(TRAINER_MOBILE_TABS.map(t => t.href))

// Mobile bottom tabs (4 primary + a Menu hamburger added in the shell).
const CLIENT_TABS = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/my-availability', label: 'Offerings', icon: CalendarPlus },
  { href: '/my-sessions', label: 'Sessions', icon: Calendar },
  { href: '/my-messages', label: 'Messages', icon: MessageSquare },
]
// Everything a client can reach — the full-screen menu (mobile).
const CLIENT_MENU = [
  { href: '/my-availability', label: 'Offerings', icon: CalendarPlus },
  { href: '/my-sessions', label: 'Sessions', icon: Calendar },
  { href: '/my-messages', label: 'Messages', icon: MessageSquare },
  { href: '/my-shop', label: 'Shop', icon: ShoppingBag },
  { href: '/my-memberships', label: 'Packages', icon: Ticket },
  { href: '/my-invoices', label: 'Invoices', icon: FileText },
  { href: '/my-achievements', label: 'Achievements', icon: Trophy },
  { href: '/my-dogs', label: 'My dogs', icon: Dog },
  // Was a tab inside My Profile. It's its own page now (inbox + what you want
  // to hear about), so it needs a way in that isn't the bell badge alone.
  { href: '/my-notifications', label: 'Notifications', icon: Bell },
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
   * What this trainer calls their own menu items — nav key to their word
   * ({"/packages": "Private lessons"}). Missing/empty means our words. Locked
   * items (Stripe, Finances, Reports…) ignore it, so a stale override can't
   * rename something it shouldn't.
   */
  navLabels?: Record<string, string> | null
  /**
   * Client shell only: the trainer's public contact details, surfaced as
   * icon links in the full-screen menu header. Any null/missing value is
   * simply not rendered.
   */
  trainerContact?: { website?: string | null; phone?: string | null; email?: string | null }
  /** Client shell only: show a "Switch trainer" entry (client has 2+ trainers). */
  showTrainerSwitcher?: boolean
  /**
   * This person holds BOTH a trainer and a client relationship, so they get a
   * "switch sides" control next to Sign out. A trainer being somebody else's
   * client is ordinary — they take their own dog to a specialist — and before
   * this they could only reach whichever surface `User.role` happened to name.
   */
  isDualProfile?: boolean
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
  /**
   * Trainer shell only: where the top-bar logo links to — the trainer's chosen
   * home page (Settings → landing page). Defaults to /dashboard.
   */
  homeHref?: string
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

function ClientShell({ children, trainerLogo, businessName, clientNavHints, unreadCounts = {}, trainerContact, showTrainerSwitcher, previewExitHref, hiddenNavHrefs = [], navLabels = null, isDualProfile = false }: AppShellProps) {
  const handleSignOut = () => {
    if (previewExitHref) { window.location.href = previewExitHref; return }
    signOutWithPush()
  }
  const pathname = usePathname()
  // Append a "Switch trainer" entry when the client works with 2+ trainers.
  const switchItem = { href: '/switch-trainer', label: 'Switch', icon: ArrowLeftRight }
  // Hide any nav item the trainer's add-ons disable (e.g. /my-shop when the
  // client-shop add-on is off).
  const shown = <T extends { href: string }>(items: T[]) => items.filter(i => !hiddenNavHrefs.includes(i.href))
  // A client sees the trainer's words too: rename Events to Seminars and it is
  // Seminars on both sides. Only where the two mean the same thing — see
  // CLIENT_LABEL_SOURCE for the deliberate omissions.
  const clientLabelled = <T extends { href: string; label: string }>(items: T[]) =>
    items.map(i => ({ ...i, label: clientLabelFor(i.href, i.label, navLabels) }))
  const menuItems = clientLabelled(shown(showTrainerSwitcher ? [...CLIENT_MENU, switchItem] : CLIENT_MENU))
  const sidebarItems = clientLabelled(shown(showTrainerSwitcher ? [...CLIENT_SIDEBAR, switchItem] : CLIENT_SIDEBAR))
  const clientTabs = clientLabelled(CLIENT_TABS)
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
    // The trainer's words reach the client app too, so any screen in here can
    // resolve a renamed label — not just the nav rows (the home quick-action tile
    // still said "Offerings" while the menu beside it said the trainer's word).
    <NavLabelProvider labels={navLabels ?? {}}>
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
        <nav className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar px-3 py-4 space-y-1">
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
          {/* Only for a person who genuinely holds both sides. A previewing
              trainer already has "Sign out" wired to their exit href, so they
              must not also get a switch that would strand them here. */}
          {isDualProfile && !previewExitHref && <ProfileSwitchButton to="trainer" />}
          <button onClick={handleSignOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors">
            <LogOut className="h-5 w-5" />Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 md:ml-64 min-h-[100dvh] flex flex-col">
        {/* Mobile top bar — the TRAINER's brand (this app is white-labelled to
            them), with the account button on the right. Phone only: on desktop
            the sidebar already carries the logo. Sticky so it occupies flow and
            no page needs extra top padding; pads the safe-area inset. */}
        <header
          className="md:hidden sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-100"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <Link href="/home" className="flex min-w-0 items-center gap-2">
              {trainerLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={trainerLogo} alt={businessName ?? 'Logo'} className="h-8 w-auto max-w-[160px] object-contain" />
              ) : (
                <span className="font-display text-lg font-extrabold text-slate-900 truncate">
                  {businessName ?? 'PupManager'}
                </span>
              )}
            </Link>
            {/* Opens the same full-screen menu as the bottom bar's Menu tab —
                account details, contacts and (when they have more than one
                trainer) the switcher. */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Account menu"
              aria-expanded={menuOpen}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"
            >
              <User className="h-5 w-5" />
            </button>
          </div>
        </header>
        <main className="flex-1 flex flex-col min-h-0 pb-24 md:pb-0">{children}</main>
      </div>

      {/* Mobile bottom tabs */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-100"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {clientTabs.map((item) => {
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
              // On a white header a logo shows itself. This sheet is painted in
              // the trainer's own colour, and most logos are drawn in that same
              // colour — so it was rendering invisibly against it. The white
              // tile is what the top-bar brand mark already does for the same
              // reason; it carries a light logo as well as a dark one.
              <span className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={trainerLogo} alt={businessName ?? ''} className="h-10 w-auto max-w-[200px] object-contain" />
              </span>
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
              {isDualProfile && !previewExitHref && (
                <ProfileSwitchButton to="trainer" variant="sheet" />
              )}
              <button onClick={handleSignOut} className="w-full flex items-center gap-4 px-3 py-3.5 text-left" style={isDualProfile && !previewExitHref ? { borderTop: `1px solid ${divider}` } : undefined}>
                <span className="flex h-9 w-9 items-center justify-center shrink-0"><LogOut className="h-5 w-5" /></span>
                <span className="text-[15px] font-medium flex-1">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </NavLabelProvider>
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

/**
 * The label for a row on the collapsed rail, shown beside it on hover.
 *
 * A collapsed sidebar is a column of unlabelled icons, and several of them are
 * near neighbours — Group Classes, Casual Classes and Events are three
 * variations on a calendar. The browser's own `title=` does say the name, but
 * only after about a second of holding still, which is far longer than it takes
 * to give up and open the sidebar instead. This appears immediately.
 *
 * Positioned `fixed` from the row's measured top rather than absolutely inside
 * it, because the nav is `overflow-x-hidden` — anything laid out inside the
 * rail gets cut off at the rail's edge, which is exactly where the label needs
 * to start. Measured on enter (not on every scroll) since the tip only ever has
 * to be right while it is on screen.
 */
function TipIf({ when, label, children }: { when: boolean; label: string; children: ReactNode }) {
  return when ? <RailTip label={label}>{children}</RailTip> : <>{children}</>
}

function RailTip({ label, children }: { label: string; children: ReactNode }) {
  const [top, setTop] = useState<number | null>(null)
  const measure = (el: HTMLElement | null) => { if (el) setTop(el.getBoundingClientRect().top) }
  return (
    <div
      className="group/tip relative"
      onMouseEnter={e => measure(e.currentTarget)}
      onFocusCapture={e => measure(e.currentTarget)}
    >
      {children}
      {top != null && (
        <span
          aria-hidden
          className="pointer-events-none invisible fixed z-50 flex h-10 items-center pl-3.5 opacity-0 transition-opacity duration-100 group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100"
          style={{ top, left: 56 }}
        >
          <span className="whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-[0_10px_25px_-8px_rgba(15,23,42,0.55)]">
            {label}
          </span>
        </span>
      )}
    </div>
  )
}
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
        <RailTip label={`${item.label} — add-on`}>
          <Link
            href={ADDON_SETTINGS_HREF}
            aria-label={`${item.label}. ${ADDON_LOCK_TITLE}`}
            className="relative flex items-center justify-center h-10 w-10 mx-auto rounded-xl text-slate-400 hover:bg-slate-50 transition-colors"
          >
            <Icon className="h-5 w-5 flex-shrink-0" />
            <Lock aria-hidden className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 text-slate-400" />
          </Link>
        </RailTip>
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
  navHovered = false,
  onToggle,
  trainerLogo,
  trainerIcon,
  businessName,
  homeHref = '/dashboard',
  fallbackTitle,
  userName,
  userEmail,
  orgs,
  activeCompanyId,
  streak,
  canSell = false,
  currency = 'nzd',
  notifCount = 0,
  isDualProfile = false,
}: {
  collapsed: boolean
  /** Pointer is over the rail below — reveals the toggle without hovering it. */
  navHovered?: boolean
  onToggle: () => void
  trainerLogo?: string | null
  trainerIcon?: string | null
  businessName?: string | null
  homeHref?: string
  fallbackTitle: string
  userName?: string | null
  userEmail?: string | null
  orgs?: { id: string; name: string; role: string }[]
  activeCompanyId?: string | null
  streak?: { current: number } | null
  isDualProfile?: boolean
  canSell?: boolean
  currency?: string
  notifCount?: number
}) {
  const title = usePageTitle() ?? fallbackTitle
  const subtitle = usePageSubtitle()
  return (
    <header className="hidden md:flex fixed top-0 inset-x-0 z-40 min-h-[3.5rem] items-center border-b border-slate-100 bg-white/85 backdrop-blur pt-[var(--app-safe-top)]">
      {/* Logo zone — aligned to the sidebar width so it sits above it. Links to
          the trainer's chosen home page. */}
      {/* The logo square doubles as the expand/collapse control: the mark sits
          there normally, and hovering swaps it for the chevron. The toggle used
          to be a separate button floating just past the sidebar border, which
          read as a stray arrow belonging to nothing — it pointed at the rail
          without being part of it.

          They are SIBLINGS, not nested: a <button> inside an <a> is invalid
          HTML and breaks both the link and the button. So the wrapper is the
          hover group, and the toggle is positioned over the mark.

          When expanded the toggle covers only the 2rem mark, so the business
          name beside it stays a working link to home. Collapsed there is no
          name, so home is the Dashboard row in the nav below. */}
      <div className={cn('group relative h-full shrink-0 border-r border-slate-100 transition-all duration-200', collapsed ? 'w-16' : 'w-64')}>
      <Link href={homeHref} aria-label="Home" className={cn('flex items-center h-full w-full transition-all duration-200 overflow-hidden hover:bg-slate-50', collapsed ? 'justify-center px-2' : 'gap-3 px-5')}>
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
      </Link>
      {/* Hidden until the logo zone is hovered — and until it is FOCUSED, or
          the only way to collapse the menu would be with a mouse. */}
      <button
        type="button"
        onClick={onToggle}
        title={collapsed ? 'Expand menu' : 'Collapse menu'}
        aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        className={cn(
          'absolute top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-lg',
          'bg-white text-slate-600 ring-1 ring-slate-200 shadow-sm',
          'transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100',
          // Anywhere on the rail counts, not just the logo square itself.
          navHovered ? 'opacity-100' : 'opacity-0',
          'hover:bg-slate-50',
          // Collapsed, the logo square IS the whole zone, so the toggle sits on
          // it. Expanded there is room, so it moves to the far end by the
          // divider — pointing back at the edge it will pull the rail to, and
          // leaving the mark and the business name both visible and both
          // clickable as the link home.
          collapsed ? 'left-1/2 -translate-x-1/2' : 'right-3',
        )}
      >
        {collapsed ? <ChevronRight className="h-5 w-5" strokeWidth={1.75} /> : <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />}
      </button>
      </div>
      {/* Back-arrow slot — pages portal a back button here (detail pages). */}
      <div id="pm-topbar-back" className="ml-2 flex items-center empty:hidden" />
      {/* Page title. */}
      <div className="ml-2 min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-slate-900 leading-tight">{title}</h1>
        {/* Whose record this is, in the same band — never a strip of its own. */}
        {subtitle && <p className="truncate text-xs leading-tight text-slate-500">{subtitle}</p>}
      </div>
      {/* Page-actions slot — pages portal their action buttons here instead of
          a redundant second header row. */}
      <div id="pm-topbar-actions" className="mr-2 flex items-center gap-1.5 empty:hidden" />
      {/* Right-hand controls. */}
      <div className="pr-3 lg:pr-5">
        <TopBarControls userName={userName} userEmail={userEmail} orgs={orgs} activeCompanyId={activeCompanyId} streak={streak} canSell={canSell} currency={currency} notifCount={notifCount} isDualProfile={isDualProfile} />
      </div>
    </header>
  )
}

// Trainer phone top bar: menu on the left, then the business name (home) or the
// page's back arrow + title (everywhere else) — pages portal their back button
// into #pm-topbar-back-mobile, and the title comes from the page-title context.
// Create and search stay pinned on the right, and open as full screens.
// The slots render unconditionally so the portal target always exists on first
// paint (matching the desktop bar).
function TrainerMobileHeader({
  businessName,
  fallbackTitle,
  canSell = false,
  currency = 'nzd',
}: {
  businessName?: string
  fallbackTitle: string
  canSell?: boolean
  currency?: string
}) {
  // A page's own title (via PageHeader) wins; otherwise fall back to the nav
  // label for the route, so pages with a custom header (e.g. /schedule) still
  // name themselves here.
  const title = usePageTitle() ?? fallbackTitle
  const subtitle = usePageSubtitle()
  const hasBack = usePageHasBack()
  const pathname = usePathname()
  const isHome = pathname === '/dashboard'
  const showTitle = !!title && !isHome
  // These hooks live HERE rather than in TrainerShell's body on purpose: the
  // shell renders PageTitleProvider, so a usePageImmersive() call up there sits
  // ABOVE the provider and always reads the default `false`.
  const immersive = usePageImmersive()
  const keepsTopBar = usePageImmersiveKeepsTopBar()
  // An immersive page that brings its own header (an open message thread —
  // back arrow, avatar, the client's name) gets the bar out of the way; two
  // headers, the upper one saying less, is the shape that rule was written for.
  if (immersive && !keepsTopBar) return null
  return (
    <header
      className="md:hidden sticky top-0 z-40 border-b border-slate-100 bg-white/95 backdrop-blur"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex h-14 items-center gap-2 px-3">
        {/* Menu — far left, where a thumb reaches on a phone. Opens the same
            More sheet the shell owns, asked for by event. */}
        {/* A detail page shows a back arrow in the slot below — from inside a
            class or a client, back is what you reach for, and two navigation
            controls side by side is one too many. */}
        {/* It survives an immersive page BY DESIGN. Immersive takes the bottom
            tabs away, so if a page turned immersive without portalling a back
            arrow and this went too, the trainer would be looking at a screen
            with nothing on it to press. Every immersive-with-top-bar page today
            (the product form) has a back arrow, so this is the safety net
            rather than the normal look — Karl's "back button and the name". */}
        {!hasBack && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('pm:open-more'))}
            aria-label="Menu"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 active:bg-slate-100"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
        )}
        {/* No logo in the bar on any page: the home screen shows it large and
            centred, and on inner pages it was a 32px decoration competing with
            the page name. Home is a bottom tab. */}
        {/* Back slot — always present so the portal target exists on first paint. */}
        <span id="pm-topbar-back-mobile" className="flex items-center empty:hidden" />
        {/* On inner pages, the page name; on the home screen, the business.
            An <h1>, not a <span>: PageHeader suppresses its own heading when
            the shell owns the mobile header, and this was a plain span — so
            NO trainer screen had a heading at all on a phone. Measured: one
            heading at 1280px, zero at 390px. That's a screen reader with
            nothing to jump to on every page. The desktop bar is md:-only and
            this one is md:hidden, so exactly one h1 ever renders. */}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-slate-900 leading-tight">
            {showTitle ? title : businessName ?? 'PupManager'}
          </h1>
          {/* One band, two lines. A client's section pages used to put "karl ·
              Sammy" in a full-width strip UNDER this bar — a back arrow and two
              names costing ~120px before any content (Karl: "i think we should
              tighten this up"). It truncates, so a long name can't push the
              44px back arrow around. */}
          {showTitle && subtitle && (
            <p className="truncate text-xs leading-tight text-slate-500">{subtitle}</p>
          )}
        </div>
        {/* Page-actions slot — always present (empty:hidden). */}
        <span id="pm-topbar-actions-mobile" className="flex items-center gap-1.5 empty:hidden" />
        {/* Create "+" and search both offer to start something ELSE, which is
            the one thing a half-filled form must not do (Karl, 2026-08-06:
            "when creating a product these should not be there its confusing").
            An immersive bar is the page's name and the way back, nothing more.
            The "+" also reads usePageImmersive itself — belt and braces, since
            it portals to <body> and could otherwise outlive this row. */}
        {!immersive && (
          <>
            <FloatingCreateButton canSell={canSell} currency={currency} />
            {/* The same slide-out search as desktop — one implementation, so the
                scope selector, type-ahead and keyboard handling can't diverge. */}
            <TopBarControls variant="search" />
          </>
        )}
        {/* No bell up here — notifications are a bottom tab on phones. */}
      </div>
    </header>
  )
}

/**
 * Renders children unless the current page has declared itself immersive.
 *
 * Must be used INSIDE PageTitleProvider. TrainerShell renders that provider, so
 * a usePageImmersive() call in TrainerShell's own body sits above it in the tree
 * and always reads the default `false` — which is exactly the bug this replaced.
 */
function HideWhenImmersive({ children }: { children: React.ReactNode }) {
  return usePageImmersive() ? null : <>{children}</>
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
  navLabels = null,
  orgs = [],
  activeCompanyId = null,
  homeHref = '/dashboard',
  isDualProfile = false,
}: AppShellProps) {
  const pathname = usePathname()
  // Nav filtered to what this user's role/permissions allow. Add-on items
  // whose add-on is OFF are hidden entirely (same as permission-hidden items),
  // so the left menu only ever lists features the trainer actually has on.
  // Their words, not ours, wherever they've chosen one. Applied HERE, once, so
  // every place a label renders — rail, flyout, phone menu, page titles — reads
  // the same name without each having to remember to ask.
  const trainerNav = TRAINER_NAV.filter(
    i => !hiddenNavHrefs.includes(i.href) && !addonLockedHrefs.includes(i.href),
  ).map(i => ({ ...i, label: labelFor(i.href, i.label, navLabels) }))
  const sectionLabel = (section: NavSection, fallback: Record<NavSection, string | null>) => {
    const def = fallback[section]
    return def === null ? null : labelFor(sectionKey(section), def, navLabels)
  }
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
  // The daily three (Dashboard / Messages / Schedule) sit across the top of the
  // rail as one row rather than three stacked rows — they're the most-used
  // items and don't need to cost three rows of height. Collapsed, the rail is
  // icons only and everything stacks as before.
  const desktopTopRow = desktopNav.filter(i => i.section === 'overview')
  const desktopRest = desktopNav.filter(i => i.section !== 'overview')
  const [collapsed, setCollapsed] = useState(false)
  // True while the pointer is anywhere over the desktop rail — see the <aside>.
  const [navHovered, setNavHovered] = useState(false)
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

  // The phone home grid's "More" tile lives outside this shell, so it asks for
  // the sheet by event rather than duplicating the whole menu.
  useEffect(() => {
    const open = () => setMoreOpen(true)
    window.addEventListener('pm:open-more', open)
    return () => window.removeEventListener('pm:open-more', open)
  }, [])

  const sidebarWidth = collapsed ? 'md:w-16' : 'md:w-64'
  // Settings has its OWN left rail (Profile / Notifications / Add-ons / …), so
  // the app's main menu alongside it is two menus fighting for the same job.
  // Hide it in there and give the width back to the content; the top bar's back
  // arrow (and the logo) are still the way out.
  // Settings hides the main rail and brings its own. The form editors live at
  // /forms/… but BELONG to Settings — `FormsManager` is rendered as a Settings
  // tab and links out to them — so landing on one swapped the whole left menu
  // underneath the trainer and lost them their place. Editing a form is still
  // being in Settings; the URL is just the only thing that said otherwise.
  const inSettings =
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/forms' ||
    pathname.startsWith('/forms/')
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
  // Tabs still answer to permissions and add-ons: a tab whose route (or the nav
  // row gating it) was filtered out of trainerNav doesn't show. A tab pointing
  // somewhere the nav never lists at all — /notifications — isn't gated by
  // anything, so it always shows.
  const navHrefs = new Set(trainerNav.map(i => i.href))
  const allNavHrefs = new Set(TRAINER_NAV.map(i => i.href))
  const mobilePrimary = TRAINER_MOBILE_TABS.filter(t => {
    const gate = t.needsNav ?? t.href
    return !allNavHrefs.has(gate) || navHrefs.has(gate)
  })
  const mobileSecondary = trainerNav.filter(i => !i.group && !TRAINER_MOBILE_PRIMARY_HREFS.has(i.href))

  // Karl, 2026-08-02: "in the more menu can you please add schedule, todo,
  // messages, and alert as well just as a double access."
  //
  // The four tabs that aren't Home now open the menu's Overview run too. The
  // sheet covers the tab bar the moment it opens, so a trainer who reached for
  // the menu had to close it again to get to Alerts — the one place the menu
  // was a dead end. Home stays out: the logo and the Home tab are already two
  // ways to it, and a third is the "nothing says the same thing twice" rule.
  //
  // Built from the TAB list, not from TRAINER_NAV, for two reasons. Two of the
  // four (/sessions/needs-notes, /notifications) have no nav row to un-hide —
  // they exist only as tabs — and reading one source is what stops the menu and
  // the bar disagreeing about the word, the icon or whether the row is there at
  // all. It maps `mobilePrimary` rather than the raw list, so a tab already
  // gated away by a permission or an add-on is absent from the menu with it.
  const mobileMenuTabs: NavItem[] = mobilePrimary
    .filter(t => t.href !== '/dashboard')
    .map(t => ({ href: t.href, label: t.label, icon: t.icon, section: 'overview' as NavSection }))
  // Tabs first, so Overview reads in the order the bar does; anything the tabs
  // already cover is dropped from the rest rather than drawn twice.
  const mobileMenu: NavItem[] = [
    ...mobileMenuTabs,
    ...mobileSecondary.filter(i => !mobileMenuTabs.some(t => t.href === i.href)),
  ]

  // Top-bar title fallback for pages that don't set one (e.g. /schedule): the
  // longest-matching nav label for the current route.
  const navFallbackTitle = trainerNav
    .filter(i => !i.group && (pathname === i.href || pathname.startsWith(i.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? ''

  return (
    <PageTitleProvider>
    {/* Their menu words reach page TITLES too, so a renamed "Library" doesn't
        open a page still headed "Library". */}
    <NavLabelProvider labels={navLabels ?? {}}>
    <div className="flex min-h-screen flex-col md:flex-row">
      <TrainerTopBar
        collapsed={collapsed}
        navHovered={navHovered}
        onToggle={toggleCollapse}
        trainerLogo={trainerLogo}
        trainerIcon={trainerIcon}
        businessName={businessName}
        homeHref={homeHref}
        fallbackTitle={navFallbackTitle}
        userName={userName}
        userEmail={userEmail}
        orgs={orgs}
        activeCompanyId={activeCompanyId}
        streak={streak}
        isDualProfile={isDualProfile}
        canSell={canSell}
        currency={currency}
        notifCount={unreadCounts['/notifications'] ?? 0}
      />

      {/* Mobile top bar. The desktop TrainerTopBar is `hidden md:flex`, so on a
          phone the app had no header at all — no branding, and the global
          client search was unreachable. White-labelled: the trainer's own icon/
          logo and business name, never "PupManager". Sticky (not fixed) so it
          occupies flow and no page needs new top padding; pads the safe-area
          inset so it clears the notch. */}
      {/* An immersive page decides for itself whether this bar stays — a
          message thread brings its own header and drops it, a form keeps it
          stripped to back + name. TrainerMobileHeader reads that itself (it is
          below PageTitleProvider, where the hook works); wrapping it in
          HideWhenImmersive here is what left the product form with no header
          at all. */}
      <TrainerMobileHeader businessName={businessName} fallbackTitle={navFallbackTitle} canSell={canSell} currency={currency} />

      {/* Sidebar — sits below the full-width top bar (which owns the logo).
          Hidden inside Settings, which brings its own rail. */}
      {/* Hovering ANYWHERE on the rail reveals the expand/collapse chevron up in
          the logo square. It has to be React state rather than `group-hover`:
          the logo lives in the fixed top bar and the rail is a separate
          element, so no CSS group can span both. Pointer events only — a touch
          device has no hover, and there the chevron is always shown. */}
      <aside
        onMouseEnter={() => setNavHovered(true)}
        onMouseLeave={() => setNavHovered(false)}
        className={cn('hidden md:flex-col md:fixed md:top-[calc(3.5rem_+_var(--app-safe-top))] md:bottom-0 md:left-0 md:z-40 bg-white border-r border-slate-100 transition-all duration-200', inSettings ? 'md:hidden' : 'md:flex', sidebarWidth)}
      >
        {/* Scrolls, but shows no bars: overflow-x-hidden kills the horizontal
            one the collapsed rail was getting from its icon tiles, and
            .no-scrollbar hides the vertical track while keeping the scroll. */}
        <nav className={cn('flex-1 overflow-y-auto overflow-x-hidden no-scrollbar py-4 space-y-1', collapsed ? 'px-2' : 'px-3')}>
          {/* Columns follow the COUNT. Fixed at 3, two tiles left a hole where a
              third used to be — and two is a real state: Messages goes with the
              client-app switch. */}
          {!collapsed && desktopTopRow.length > 0 && (
            <div
              className="mb-2 grid gap-1"
              style={{ gridTemplateColumns: `repeat(${Math.min(desktopTopRow.length, 3)}, minmax(0, 1fr))` }}
            >
              {desktopTopRow.map(item => {
                const Icon = item.icon
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                const unread = unreadCounts[item.href] ?? 0
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[11px] font-medium transition-colors',
                      active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="max-w-full truncate">{item.label}</span>
                    {unread > 0 && (
                      <span
                        aria-label={`${unread} unread`}
                        className="absolute right-1.5 top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white tabular-nums"
                      >
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
          {(collapsed ? desktopNav : desktopRest).map((item, idx, arr) => {
            // Section grouping: emit a small header (expanded) or a divider
            // (collapsed / system group) at each section boundary.
            const sectionChanged = idx === 0 || arr[idx - 1].section !== item.section
            // A heading over ONE row earns nothing — "Offerings" above a single
            // "Group Classes" link says what the link already said. Counted from
            // the RENDERED array, so add-ons hiding a section down to one item
            // takes its heading with them. (Karl's review note, 2026-07-30.)
            const sectionHeader = !collapsed && sectionChanged
              && shouldShowSectionHeader(arr.filter(i => i.section === item.section).length)
              ? sectionLabel(item.section, NAV_SECTION_LABEL)
              : null
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
              <TipIf when={collapsed && !childrenOf[item.href]} label={item.label}>
              {isGroup ? (
                // Group parent: a non-navigating toggle (no page of its own).
                <button
                  type="button"
                  onClick={() => toggleGroup(item.href)}
                  aria-label={collapsed ? item.label : undefined}
                  aria-expanded={isGroupOpen(item.href)}
                  className={rowCls}
                >
                  {rowInner}
                </button>
              ) : (
                <Link href={item.href} aria-label={collapsed ? item.label : undefined} className={rowCls}>
                  {rowInner}
                </Link>
              )}
              </TipIf>
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

      {/* The mobile "+" now lives in the top bar (TrainerMobileHeader), matching
          the desktop control bar, so it's reachable from every page. */}

      {/* Mobile bottom tab bar — 4 primary destinations + More. Hidden on the
          offering wizard, whose own Back/Next bar owns the bottom of the phone,
          and on any page that declares itself immersive (an open message
          thread, where the composer sits at the bottom and five tabs beneath it
          just read as clutter). A thread is /messages?client=…, a query param —
          so the page reports it rather than the shell sniffing the URL, which
          would need useSearchParams and bail the whole app out of SSR. */}
      {pathname !== '/offerings/new' && (
      <HideWhenImmersive>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-slate-100 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex">
          {mobilePrimary.map((item) => {
            if (lockedAddons.has(item.href)) {
              // lockedAddons is empty today (add-on-locked routes are hidden,
              // not shown disabled); `section` is only here to satisfy NavItem
              // if that decision is reverted.
              return <LockedNavRow key={item.href} item={{ ...item, section: 'overview' }} variant="mobile-tab" />
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
          {/* No "More" tab — the header hamburger opens that sheet now, so the
              five slots down here all go to places a trainer works in. */}
        </div>
      </nav>
      </HideWhenImmersive>
      )}

      {/* Mobile menu — a whole screen of grouped tiles, the same shape as the
          settings menu. It was a bottom sheet of 20-odd grey pills in one
          undifferentiated run, which is a lot to read past to find "Reports". */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-[60] flex flex-col bg-white"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-100 px-3">
            {/* Close on the LEFT (Karl, 2026-08-06). It is where the back arrow
                lives on every other screen, so the way out is in one place
                whether you are a level deep or in this menu — and it is the
                corner a thumb reaches on a phone. The avatar was decoration
                sitting in that spot; the name says who you are. */}
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              aria-label="Close"
              className="-ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 active:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{userName ?? 'You'}</p>
              {userEmail && <p className="truncate text-xs text-slate-500">{userEmail}</p>}
            </div>
          </div>

          {/* no-scrollbar: a phone draws an overlay bar that fades; a desktop
              browser at phone width leaves a permanent grey rail down the edge. */}
          <div
            className="flex-1 overflow-y-auto no-scrollbar p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
          >
            {MENU_SECTION_ORDER.map(section => {
              const inSection = mobileMenu.filter(i => i.section === section)
              if (inSection.length === 0) return null
              return (
                <div key={section} className="mb-5">
                  <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                    {sectionLabel(section, MENU_SECTION_LABEL)}
                  </p>
                  {/* Two across at row height — the sections stay visible
                      without a tile's worth of vertical space per entry. */}
                  <FlatRowGrid count={inSection.length}>
                    {inSection.map(item => {
                      // Same `unreadCounts` the tab bar reads, so the menu row
                      // and the tab can never quote different numbers — the
                      // sheet hides the bar, and a Messages row that looked
                      // quiet while the tab underneath said 3 would be worse
                      // than no count at all.
                      const unread = unreadCounts[item.href] ?? 0
                      return (
                        <FlatRow
                          key={item.href}
                          href={item.comingSoon ? undefined : item.href}
                          icon={item.icon}
                          label={item.label}
                          active={pathname === item.href || pathname.startsWith(item.href + '/')}
                          comingSoon={item.comingSoon}
                          trailing={unread > 0 ? (
                            <span
                              aria-label={`${unread} unread`}
                              // flex-shrink-0 like every other trailing element
                              // in a FlatRow: the label beside it is flex-1, so
                              // without this a long word ("Messages") squeezes
                              // the badge to zero width and the count silently
                              // vanishes — while the shorter "Alerts" keeps its.
                              className="inline-flex h-4 min-w-4 flex-shrink-0 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white tabular-nums"
                            >
                              {unread > 9 ? '9+' : unread}
                            </span>
                          ) : <span />}
                        />
                      )
                    })}
                  </FlatRowGrid>
                </div>
              )
            })}

            {isDualProfile && (
              <button
                type="button"
                onClick={() => { void fetch('/api/profile/switch', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ side: 'client' }),
                }).then(() => { window.location.href = '/home' }) }}
                className="mb-3 flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-medium text-slate-700 active:bg-slate-50"
              >
                <ArrowLeftRight className="h-[18px] w-[18px]" />
                Switch to my client account
              </button>
            )}

            <button
              type="button"
              onClick={() => signOutWithPush()}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-medium text-red-600 active:bg-red-50"
            >
              <LogOut className="h-[18px] w-[18px]" />
              Sign out
            </button>
          </div>
        </div>
      )}

      <main
        // --app-top-offset reserves the desktop top-bar height (the fixed bar is
        // out of flow) so content clears it and PageHeader toolbar rows stick
        // just beneath it. 0 on mobile (no top bar there).
        // Bottom reserve = what the tab bar ACTUALLY occupies. The bar is 58px
        // of content PLUS env(safe-area-inset-bottom), which is ~34px on a
        // notched iPhone — so a flat pb-20 (80px) left the last row of every
        // phone screen sitting under the bar and untappable. Emulators report a
        // 0px inset, which is why this survived so long: it only reproduces on
        // real hardware. 5rem keeps today's spacing identical where the inset
        // is 0, and simply adds it where it isn't.
        className={cn('pm-main flex-1 flex flex-col min-h-0 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0 transition-all duration-200 [--app-top-offset:0px] md:[--app-top-offset:3.5rem]', mainOffset)}
        // Clear the fixed top bar on desktop; on mobile fall back to a capped
        // safe-area pad below iOS chrome. Pages that own a sticky bar can break
        // out via negative margin and handle safe-area themselves.
        style={{ paddingTop: 'calc(var(--app-top-offset, 0px) + min(env(safe-area-inset-top, 0px), 1rem))' }}
      >
        {children}
      </main>
    </div>
    </NavLabelProvider>
    </PageTitleProvider>
  )
}
