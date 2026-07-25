'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  Calendar, Users, Layers, FileText, Wallet, LayoutGrid,
  MessageSquare, ChevronRight, Inbox, CalendarClock, ClipboardCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

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
  bookingRequestCount,
  bookingRequestHref,
  notesOn,
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
  bookingRequestCount: number
  bookingRequestHref: string | null
  notesOn: boolean
}) {
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
  ].filter(r => r !== null)
  const reviewTotal = bookingRequestCount + enquiryCount

  const tiles: Tile[] = [
    {
      href: '/schedule',
      label: 'Schedule',
      sub: todayCount === 1 ? '1 session today' : `${todayCount} sessions today`,
      icon: Calendar,
    },
    {
      href: '/clients',
      label: 'Clients',
      sub: `${activeClients} active`,
      icon: Users,
    },
    {
      href: '/offerings',
      label: 'Offerings',
      sub: 'Packages & classes',
      icon: Layers,
    },
    notesOn
      ? {
          href: '/sessions/needs-notes',
          label: 'Notes',
          sub: notesCount === 1 ? '1 to write' : `${notesCount} to write`,
          icon: FileText,
        }
      : {
          href: '/messages',
          label: 'Messages',
          sub: 'Client conversations',
          icon: MessageSquare,
        },
    {
      href: '/finances',
      label: 'Money',
      // Whole units only — cents don't help on a tile and ".00" is what pushes
      // a 5-figure total (or a wider currency symbol) into truncation.
      sub: invoiceCount > 0
        ? `${invoiceLabel?.replace(/[.,]00$/, '') ?? invoiceCount} to invoice`
        : 'Payments & invoices',
      icon: Wallet,
    },
    {
      onClick: openMore,
      label: 'More',
      sub: 'Reports, settings & more',
      icon: LayoutGrid,
    },
  ]

  return (
    <section className="md:hidden -mt-1 mb-6">

      {/* Plain welcome — their logo, their name. No gradient, no card. */}
      <div className="mb-4 flex items-center gap-3 px-0.5">
        {logoUrl ? (
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1">
            {/* Plain <img>: trainer logos live on Vercel Blob, which isn't in
                next/image's remotePatterns (same as everywhere else). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              alt={businessName || 'Business logo'}
              className="h-full w-full object-contain"
            />
          </span>
        ) : (
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-base font-semibold text-slate-700">
            {(businessName || firstName || 'P').charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[17px] font-semibold leading-tight text-slate-900">
            Good {greeting}{firstName ? `, ${firstName}` : ''}
          </p>
          {businessName && (
            <p className="truncate text-[13px] text-slate-500">{businessName}</p>
          )}
        </div>
      </div>

      {/* Everything waiting on the trainer, summed into one line — amber so it
          reads as "needs you" against the otherwise neutral screen, without the
          alarm of red. Tapping opens the breakdown rather than sending them
          somewhere that only covers half of it. */}
      {needsYou.length > 0 && (
        <div className={cn(
          'mb-3 overflow-hidden rounded-xl border border-amber-200 bg-amber-50',
          '[&>*+*]:border-t [&>*+*]:border-amber-200/70',
        )}>
          <button
            type="button"
            onClick={() => setReviewOpen(o => !o)}
            aria-expanded={reviewOpen}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-amber-100"
          >
            <ClipboardCheck className="h-[18px] w-[18px] flex-shrink-0 text-amber-600" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-amber-900">
              {reviewTotal} thing{reviewTotal === 1 ? '' : 's'} to review
            </span>
            <ChevronRight
              className={cn(
                'h-4 w-4 flex-shrink-0 text-amber-500 transition-transform duration-200',
                reviewOpen && 'rotate-90',
              )}
            />
          </button>
          {reviewOpen && needsYou.map(row => {
            const Icon = row.icon
            return (
              <Link
                key={row.label}
                href={row.href}
                className="flex items-center gap-3 py-3.5 pl-11 pr-4 active:bg-amber-100"
              >
                <Icon className="h-[18px] w-[18px] flex-shrink-0 text-amber-600/80" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate text-sm text-amber-900/90">
                  {row.label}
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-amber-500" />
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
        <Calendar className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" />
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
              <Icon className="h-[22px] w-[22px] text-slate-700" strokeWidth={1.75} />
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
    </section>
  )
}
