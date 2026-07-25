'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  Calendar, Users, Layers, FileText, Wallet, LayoutGrid,
  MessageSquare, ChevronRight, Inbox,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Phone-only home screen for trainers.
 *
 * The desktop dashboard is a dense wall of widgets; on a phone that reads as
 * overwhelming (groomer/trainer feedback). This is a launcher instead: a
 * branded welcome, one live line about today, and six big destinations. The
 * tiles carry counts so the grid replaces the old four-up stat strip rather
 * than adding a layer above it.
 *
 * Rendered md:hidden — the desktop dashboard is untouched.
 */

type Tile = {
  href?: string
  onClick?: () => void
  label: string
  sub: string
  icon: LucideIcon
  /** Tailwind classes for the icon chip. */
  chip: string
  /** Attention count — rendered as a badge when > 0. */
  badge?: number
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
  notesOn: boolean
}) {
  const openMore = () => window.dispatchEvent(new CustomEvent('pm:open-more'))

  const tiles: Tile[] = [
    {
      href: '/schedule',
      label: 'Schedule',
      sub: todayCount === 1 ? '1 session today' : `${todayCount} sessions today`,
      icon: Calendar,
      chip: 'bg-blue-50 text-blue-600',
    },
    {
      href: '/clients',
      label: 'Clients',
      sub: `${activeClients} active`,
      icon: Users,
      chip: 'bg-violet-50 text-violet-600',
    },
    {
      href: '/offerings',
      label: 'Offerings',
      sub: 'Packages & classes',
      icon: Layers,
      chip: 'bg-amber-50 text-amber-600',
    },
    notesOn
      ? {
          href: '/sessions/needs-notes',
          label: 'Notes',
          sub: notesCount === 1 ? '1 to write' : `${notesCount} to write`,
          icon: FileText,
          chip: 'bg-emerald-50 text-emerald-600',
        }
      : {
          href: '/messages',
          label: 'Messages',
          sub: 'Client conversations',
          icon: MessageSquare,
          chip: 'bg-emerald-50 text-emerald-600',
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
      chip: 'bg-rose-50 text-rose-600',
    },
    {
      onClick: openMore,
      label: 'More',
      sub: 'Reports, settings & more',
      icon: LayoutGrid,
      chip: 'bg-slate-100 text-slate-600',
    },
  ]

  return (
    <section className="md:hidden -mt-1 mb-6">
      {/* Welcome band — the trainer's own logo + a time-of-day greeting so the
          app opens with their brand, not ours. */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-600 to-indigo-700 px-5 py-5 text-white">
        {/* Soft light source, top-right. Purely decorative. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/15 blur-2xl"
        />
        <div className="relative flex items-center gap-3">
          {logoUrl ? (
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/95 p-1.5">
              {/* Plain <img>: trainer logos live on Vercel Blob, which isn't
                  in next/image's remotePatterns (same as everywhere else). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt={businessName || 'Business logo'}
                className="h-full w-full object-contain"
              />
            </span>
          ) : (
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-lg font-semibold backdrop-blur">
              {(businessName || firstName || 'P').charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-tight">
              Good {greeting}{firstName ? `, ${firstName}` : ''}
            </p>
            {businessName && (
              <p className="truncate text-sm text-white/70">{businessName}</p>
            )}
          </div>
        </div>

        {/* The one live line: what's on today, tappable straight to the day. */}
        <Link
          href="/schedule"
          className="relative mt-4 flex items-center gap-2.5 rounded-2xl bg-white/15 px-3.5 py-3 backdrop-blur transition-colors active:bg-white/25"
        >
          <Calendar className="h-4 w-4 flex-shrink-0" />
          {/* Two lines rather than one long truncated string — at 390px
              "1 session today · next 4:30pm Jasper" loses the dog's name. */}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {todayCount === 0
                ? 'Nothing scheduled today'
                : `${todayCount} session${todayCount === 1 ? '' : 's'} today`}
            </span>
            {nextSessionLabel && (
              <span className="mt-0.5 block truncate text-xs text-white/75">
                Next {nextSessionLabel}
              </span>
            )}
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-white/70" />
        </Link>
      </div>

      {/* Anything waiting on the trainer that isn't one of the six tiles. */}
      {enquiryCount > 0 && (
        <Link
          href="/enquiries"
          className="mt-3 flex items-center gap-2.5 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 transition-colors active:bg-violet-100"
        >
          <Inbox className="h-4 w-4 flex-shrink-0 text-violet-700" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-violet-900">
            {enquiryCount} new {enquiryCount === 1 ? 'enquiry' : 'enquiries'} to review
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-violet-400" />
        </Link>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        {tiles.map((t) => {
          const Icon = t.icon
          const inner = (
            <>
              {(t.badge ?? 0) > 0 && (
                <span className="absolute right-3 top-3 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-xs font-semibold tabular-nums text-white">
                  {t.badge! > 99 ? '99+' : t.badge}
                </span>
              )}
              <span className={cn('flex h-11 w-11 items-center justify-center rounded-2xl', t.chip)}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="mt-3 block text-[15px] font-semibold leading-tight text-slate-900">
                {t.label}
              </span>
              <span className="mt-0.5 block text-xs leading-tight text-slate-500">
                {t.sub}
              </span>
            </>
          )
          const cls = 'relative flex min-h-[124px] flex-col items-start rounded-3xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-transform active:scale-[0.98]'
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
