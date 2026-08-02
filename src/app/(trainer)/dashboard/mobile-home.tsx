'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  Calendar, Users, Layers, FileText, Wallet,
  MessageSquare, ChevronRight, Inbox, CalendarClock, ClipboardCheck,
  Navigation, Dog, Megaphone, BarChart3, Receipt,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TileId } from '@/lib/home-tiles'
import { HomeHero } from '@/components/shared/home-hero'

/**
 * Phone-only home screen for trainers.
 *
 * The desktop dashboard is a dense wall of widgets; on a phone that reads as
 * overwhelming (groomer/trainer feedback). This is a launcher instead: whatever
 * is waiting on the trainer first, then a plain welcome, then six destinations
 * carrying live counts so the grid replaces the old four-up stat strip rather
 * than adding a layer above it.
 *
 * Flat by intent — one hairline-divided block, no cards floating on cards, no
 * tinted icon chips, no gradient.
 *
 * Rendered md:hidden — the desktop dashboard is untouched.
 */

type Tile = {
  href?: string
  onClick?: () => void
  label: string
  sub: string
  icon: LucideIcon
}

export function MobileHome({
  greeting,
  firstName,
  businessName,
  logoUrl,
  todayCount,
  nextSessionLabel,
  activeClients,
  notesCount,
  invoiceCount,
  invoiceLabel,
  enquiryCount,
  unreadMessages,
  bookingRequestCount,
  bookingRequestHref,
  tileIds,
  requests,
  accentColor,
  heroImageUrl,
  heroShowLogo,
}: {
  greeting: string
  firstName: string
  businessName: string
  logoUrl: string | null
  todayCount: number
  nextSessionLabel: string | null
  activeClients: number
  notesCount: number
  invoiceCount: number
  invoiceLabel: string | null
  enquiryCount: number
  unreadMessages: number
  bookingRequestCount: number
  bookingRequestHref: string | null
  /** Which buttons to show, in order — resolved from the trainer's trade. */
  tileIds: TileId[]
  /**
   * What clients have asked for and not been answered on. Rendered ABOVE the
   * tile grid: it's the only thing on this screen that's waiting on a REPLY,
   * and under six evergreen tiles it sat below the fold — a request nobody
   * scrolled to is a request nobody answered.
   */
  requests?: React.ReactNode
  /** The trainer's own brand colour (Settings → Design). */
  accentColor: string | null
  /** Company-wide home background photo (Settings → Design), or null. */
  heroImageUrl: string | null
  /** Company-wide: show the logo lockup over that photo, or just the greeting. */
  heroShowLogo: boolean
}) {
  // Colour on this screen is the trainer's own, not a palette we picked. Their
  // brand colour tints the icons and the "needs you" strip; everything else
  // stays neutral so one accent does the work.
  //
  // Both derived tones go through color-mix rather than using the raw hex: a
  // pale brand colour (and plenty of dog-trainer brands are pastel) would be
  // unreadable as an icon on white, so the icon tone keeps the hue but is
  // mixed toward slate-900 to guarantee it stays legible.
  const accent = accentColor?.trim() || '#2563eb'
  const accentVars = { '--pm-accent': accent } as React.CSSProperties
  const INK = 'color-mix(in srgb, var(--pm-accent) 78%, #0f172a)'
  const TINT_BG = 'color-mix(in srgb, var(--pm-accent) 7%, #ffffff)'
  const TINT_BORDER = 'color-mix(in srgb, var(--pm-accent) 22%, #ffffff)'
  const openMore = () => window.dispatchEvent(new CustomEvent('pm:open-more'))
  const [reviewOpen, setReviewOpen] = useState(false)

  // Decisions waiting on the trainer. Summed into one line; the breakdown is
  // behind the disclosure.
  const needsYou = [
    bookingRequestCount > 0 && bookingRequestHref
      ? {
          href: bookingRequestHref,
          icon: CalendarClock,
          label: `${bookingRequestCount} booking request${bookingRequestCount === 1 ? '' : 's'}`,
        }
      : null,
    enquiryCount > 0
      ? {
          href: '/enquiries',
          icon: Inbox,
          label: `${enquiryCount} new ${enquiryCount === 1 ? 'enquiry' : 'enquiries'}`,
        }
      : null,
    // A client waiting on a reply is as much "needs you" as a booking request.
    unreadMessages > 0
      ? {
          href: '/messages',
          icon: MessageSquare,
          label: `${unreadMessages} ${unreadMessages === 1 ? 'message' : 'messages'} to reply to`,
        }
      : null,
  ].filter(r => r !== null)
  const reviewTotal = bookingRequestCount + enquiryCount + unreadMessages

  // What each tile says. Which of them appear, and in what order, is decided
  // by the trainer's trade (see lib/home-tiles) — a dog walker leads with their
  // route, a groomer doesn't want a notes backlog up front.
  const CATALOG: Record<TileId, Tile> = {
    schedule: {
      href: '/schedule',
      label: 'Schedule',
      sub: todayCount === 1 ? '1 session today' : `${todayCount} sessions today`,
      icon: Calendar,
    },
    clients: {
      href: '/clients',
      label: 'Clients',
      sub: `${activeClients} active`,
      icon: Users,
    },
    offerings: {
      href: '/offerings',
      label: 'Offerings',
      sub: '1:1 Sessions & classes',
      icon: Layers,
    },
    todo: {
      href: '/sessions/needs-notes',
      // Same name as the bottom tab and the page's own title — one destination
      // shouldn't answer to two names.
      label: 'To do',
      sub: notesCount === 1 ? '1 to write' : `${notesCount} to write`,
      icon: FileText,
    },
    money: {
      href: '/finances',
      // Whole units only — cents don't help on a tile and ".00" is what pushes
      // a 5-figure total (or a wider currency symbol) into truncation.
      label: 'Money',
      sub: invoiceCount > 0
        ? `${invoiceLabel?.replace(/[.,]00$/, '') ?? invoiceCount} to invoice`
        : 'Payments & invoices',
      icon: Wallet,
    },
    messages: {
      href: '/messages',
      label: 'Messages',
      sub: unreadMessages > 0 ? `${unreadMessages} unread` : 'Client conversations',
      icon: MessageSquare,
    },
    sale: {
      // The sale composer is mounted by the header's create button, so ask for
      // it by event rather than standing up a second copy here.
      onClick: () => window.dispatchEvent(new CustomEvent('pm:open-sale')),
      label: 'Instant sale',
      sub: 'Charge a client now',
      icon: Receipt,
    },
    route: {
      href: '/schedule/route',
      label: 'Route',
      sub: 'Today’s run, in order',
      icon: Navigation,
    },
    daycare: {
      href: '/doggy-daycare',
      label: 'Daycare',
      sub: 'Week board & day parts',
      icon: Dog,
    },
    marketing: {
      href: '/marketing',
      label: 'Marketing',
      sub: 'Email your clients',
      icon: Megaphone,
    },
    reports: {
      href: '/reports',
      label: 'Reports',
      sub: 'How the business is doing',
      icon: BarChart3,
    },
  }

  const tiles: Tile[] = tileIds.map(id => CATALOG[id]).filter(Boolean)

  return (
    <section className="md:hidden -mt-1 mb-6" style={accentVars}>
      {/* The lockup, the background photo and the fade across everything below
          it all live in <HomeHero/>. Its children are what the trainer marked
          as the "red box": the fade is sized to exactly this run of rows and
          tiles, ending fully opaque at the last one. */}
      <HomeHero
        imageUrl={heroImageUrl}
        showLogo={heroShowLogo}
        logoUrl={logoUrl}
        businessName={businessName}
        firstName={firstName}
        greeting={greeting}
      >

      {/* Everything waiting on the trainer, summed into one line. Indigo, the
          same tint the desktop booking-request panel uses — it reads as "needs
          you" without the alarm of red. Tapping opens the breakdown rather than
          sending them somewhere that only covers half of it. */}
      {needsYou.length > 0 && (
        <div
          className="mb-3 overflow-hidden rounded-xl border [&>*+*]:border-t"
          style={{ background: TINT_BG, borderColor: TINT_BORDER }}
        >
          <button
            type="button"
            onClick={() => setReviewOpen(o => !o)}
            aria-expanded={reviewOpen}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
          >
            <ClipboardCheck className="h-[18px] w-[18px] flex-shrink-0" style={{ color: INK }} strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
              {reviewTotal} thing{reviewTotal === 1 ? '' : 's'} to review
            </span>
            <ChevronRight
              className={cn('h-4 w-4 flex-shrink-0 transition-transform duration-200', reviewOpen && 'rotate-90')}
              style={{ color: INK }}
            />
          </button>
          {reviewOpen && needsYou.map(row => {
            const Icon = row.icon
            return (
              <Link
                key={row.label}
                href={row.href}
                className="flex items-center gap-3 py-3.5 pl-11 pr-4"
                style={{ borderColor: TINT_BORDER }}
              >
                <Icon className="h-[18px] w-[18px] flex-shrink-0" style={{ color: INK }} strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  {row.label}
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: INK }} />
              </Link>
            )
          })}
        </div>
      )}

      {/* One live line about today, sharing the grid's flat treatment. */}
      <Link
        href="/schedule"
        className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 active:bg-slate-50"
      >
        <Calendar className="h-[18px] w-[18px] flex-shrink-0" style={{ color: INK }} strokeWidth={1.75} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900">
            {todayCount === 0
              ? 'Nothing scheduled today'
              : `${todayCount} session${todayCount === 1 ? '' : 's'} today`}
          </span>
          {nextSessionLabel && (
            <span className="mt-0.5 block truncate text-[13px] text-slate-500">
              Next {nextSessionLabel}
            </span>
          )}
        </span>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
      </Link>

      {/* Anything a client is waiting on an answer to, before the tiles. */}
      {requests && <div className="mb-3">{requests}</div>}

      {/* One block, divided by hairlines — not six floating cards. The nth-child
          rules drop the outer edges so only the internal lines show. */}
      <div className={cn(
        'grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white',
        '[&>*]:border-b [&>*]:border-r [&>*]:border-slate-200',
        '[&>*:nth-child(2n)]:border-r-0',
        '[&>*:nth-last-child(-n+2)]:border-b-0',
      )}>
        {tiles.map((t) => {
          const Icon = t.icon
          const inner = (
            <>
              <Icon className="h-[22px] w-[22px]" style={{ color: INK }} strokeWidth={1.75} />
              <span className="mt-2.5 block text-[15px] font-semibold leading-tight text-slate-900">
                {t.label}
              </span>
              <span className="mt-1 block text-[13px] leading-tight text-slate-500">
                {t.sub}
              </span>
            </>
          )
          const cls = 'flex min-h-[104px] flex-col items-start justify-center px-4 py-4 text-left active:bg-slate-50'
          return t.href ? (
            <Link key={t.label} href={t.href} className={cls}>{inner}</Link>
          ) : (
            <button key={t.label} type="button" onClick={t.onClick} className={cls}>{inner}</button>
          )
        })}
      </div>
      </HomeHero>
    </section>
  )
}
