import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar, ChevronLeft, ChevronRight, ArrowRight, Users, PawPrint, Inbox, FileText, DollarSign } from 'lucide-react'
import { SessionRowCard } from '@/components/shared/session-row-card'
import { PageHeader } from '@/components/shared/page-header'
import { WaitlistNudge } from '@/components/shared/waitlist-nudge'
import { BookingRequestsPanel } from '@/components/shared/booking-requests-panel'
import { PendingRequestsPanel } from './pending-requests-panel'
import { OnboardingPanel } from './onboarding-panel'
import { initTrainerOnboarding } from '@/lib/onboarding/init'
import { getOnboardingState } from '@/lib/onboarding/state'
import { startOfDayInTz, endOfDayInTz, todayInTz } from '@/lib/timezone'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Dashboard' }

function parseLocalDate(s: string): Date | null {
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 12, 0, 0)
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  // Idempotent: creates the TrainerOnboardingProgress row + seeds default
  // achievements on first visit. Cheap (one indexed lookup) on every load after.
  await initTrainerOnboarding(trainerId)
  const onboardingState = await getOnboardingState(trainerId)

  // Trainer's timezone drives all day-bounds and time formatting on this
  // server-rendered page. Vercel runs Node in UTC so without this every
  // time would render as UTC for everyone.
  const trainerUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { timezone: true },
  })
  const tz = trainerUser?.timezone ?? 'Pacific/Auckland'

  const sp = await searchParams
  const todayDateStr = todayInTz(tz)
  const focusDateStr = (sp.date && parseLocalDate(sp.date)) ? sp.date! : todayDateStr
  const focusDate = parseLocalDate(focusDateStr)!
  const focusStart = startOfDayInTz(focusDateStr, tz)
  const focusEnd = endOfDayInTz(focusDateStr, tz)
  const isToday = focusDateStr === todayDateStr

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const todaysSessionsRaw = await prisma.trainingSession.findMany({
    where: {
      trainerId,
      scheduledAt: { gte: focusStart, lte: focusEnd },
      // Hide sessions whose client was deleted. clientId is `onDelete: SetNull`,
      // so a deleted client leaves orphan rows; we treat them as gone here
      // rather than auto-removing them so trainers don't lose past records.
      clientId: { not: null },
    },
    include: {
      client: { select: { user: { select: { name: true, email: true } } } },
      dog: {
        select: {
          name: true,
          primaryFor: { select: { user: { select: { name: true, email: true } } } },
        },
      },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  // Push finished sessions to the bottom so the next/current one is on top.
  // For past or future days every row falls in the same bucket so chronological
  // order is preserved.
  const nowMs = Date.now()
  const todaysSessions = [...todaysSessionsRaw].sort((a, b) => {
    const aPast = a.scheduledAt.getTime() + a.durationMins * 60_000 < nowMs ? 1 : 0
    const bPast = b.scheduledAt.getTime() + b.durationMins * 60_000 < nowMs ? 1 : 0
    if (aPast !== bPast) return aPast - bPast
    return a.scheduledAt.getTime() - b.scheduledAt.getTime()
  })

  const prevDate = new Date(focusDate); prevDate.setDate(prevDate.getDate() - 1)
  const nextDate = new Date(focusDate); nextDate.setDate(nextDate.getDate() + 1)
  const prevHref = `/dashboard?date=${toDateStr(prevDate)}`
  const nextHref = `/dashboard?date=${toDateStr(nextDate)}`
  const todayHref = `/dashboard`

  const clients = await prisma.clientProfile.findMany({
    where: { trainerId },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true } },
      dogs: { select: { id: true } },
      diaryEntries: {
        where: { date: { gte: sevenDaysAgo } },
        select: { id: true, completion: { select: { id: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const totalClients = clients.length
  const activeClients = clients.filter(c => c.status === 'ACTIVE').length
  // Dog counts: primary dog (c.dogId) + additional household dogs (c.dogs).
  // "Active" follows the parent client's status, matching how dogs disappear
  // from the trainer's day-to-day when the client goes inactive.
  const dogCount = (c: typeof clients[number]) => (c.dogId ? 1 : 0) + c.dogs.length
  const totalDogs = clients.reduce((sum, c) => sum + dogCount(c), 0)
  const activeDogs = clients.filter(c => c.status === 'ACTIVE').reduce((sum, c) => sum + dogCount(c), 0)

  // Recent enquiries — only NEW (still pending decision). Accepted and
  // declined ones drop off the dashboard once actioned; trainer can find
  // them under the respective tabs on /enquiries.
  const recentEnquiries = await prisma.enquiry.findMany({
    where: { trainerId, status: 'NEW' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      dogName: true,
      status: true,
      viewedAt: true,
      createdAt: true,
    },
    take: 5,
  })
  const unviewedEnquiryCount = await prisma.enquiry.count({
    where: { trainerId, status: 'NEW', viewedAt: null },
  })

  // Past sessions still needing notes OR an invoice — the dashboard CTA links
  // to /sessions/needs-notes which is now framed as a generic "to do" list.
  // We fetch the rows (not just a count) so we can also surface the
  // notes-pending count + total un-invoiced value alongside the headline.
  const sessionsToAction = await prisma.trainingSession.findMany({
    where: {
      trainerId,
      scheduledAt: { lt: new Date() },
      clientId: { not: null },
      OR: [
        { formResponses: { none: {} } },
        { invoicedAt: null },
      ],
    },
    select: {
      invoicedAt: true,
      _count: { select: { formResponses: true } },
      clientPackage: {
        select: { package: { select: { priceCents: true, sessionCount: true } } },
      },
    },
  })
  const sessionsToActionCount = sessionsToAction.length
  const wrapNotesCount = sessionsToAction.filter(s => s._count.formResponses === 0).length
  const wrapInvoiceCount = sessionsToAction.filter(s => s.invoicedAt == null).length
  const wrapInvoiceCents = sessionsToAction.reduce((sum, s) => {
    if (s.invoicedAt != null) return sum
    const pkg = s.clientPackage?.package
    if (!pkg?.priceCents || !pkg.sessionCount || pkg.sessionCount <= 0) return sum
    return sum + Math.round(pkg.priceCents / pkg.sessionCount)
  }, 0)
  const wrapInvoiceLabel = wrapInvoiceCents > 0
    ? '$' + (wrapInvoiceCents / 100).toLocaleString('en-NZ', {
        minimumFractionDigits: 0,
        maximumFractionDigits: wrapInvoiceCents % 100 === 0 ? 0 : 2,
      })
    : null

  // Pending product requests across this trainer's clients — shown as a panel
  // so the trainer can fulfil items at the next session and dismiss the chip.
  const pendingProductRequests = await prisma.productRequest.findMany({
    where: { client: { trainerId }, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      createdAt: true,
      note: true,
      client: { select: { id: true, user: { select: { name: true, email: true } } } },
      product: { select: { id: true, name: true, kind: true, imageUrl: true } },
    },
  })

  // Index requests by client so we can show them inline on each "Coming up
  // today" session row — the trainer sees what to bring at a glance.
  const requestsByClient = new Map<string, typeof pendingProductRequests>()
  for (const r of pendingProductRequests) {
    const arr = requestsByClient.get(r.client.id) ?? []
    arr.push(r)
    requestsByClient.set(r.client.id, arr)
  }

  return (
    <>
      <PageHeader
        title={`Good ${getGreeting(tz)}, ${session.user.name?.split(' ')[0] ?? 'there'} 👋`}
      />
      <div className="p-4 md:p-8 w-full max-w-4xl xl:max-w-7xl mx-auto">
        <BookingRequestsPanel trainerId={trainerId} />
        <WaitlistNudge trainerId={trainerId} />
        <OnboardingPanel state={onboardingState} />

      {/* Vital stats strip — four tiles in one row: Notes, Invoice, Clients,
          Dogs. The first two link to /sessions/needs-notes; Clients/Dogs are
          informational. Tiles show their value even when zero so the row stays
          a stable four-up. */}
      <div className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link
          href="/sessions/needs-notes"
          className={cn(
            'block rounded-2xl bg-white border p-3.5 transition-colors',
            wrapNotesCount > 0 ? 'border-amber-100 hover:border-amber-300' : 'border-slate-100 hover:border-slate-200',
          )}
        >
          <div className="flex items-center gap-2.5">
            <span className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0',
              wrapNotesCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400',
            )}>
              <FileText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xl font-bold text-slate-900 leading-none tabular-nums">{wrapNotesCount}</p>
              <p className="text-[11px] text-slate-500 mt-1 leading-tight">
                {wrapNotesCount === 1 ? 'note to write' : 'notes to write'}
              </p>
            </div>
          </div>
        </Link>
        <Link
          href="/sessions/needs-notes"
          className={cn(
            'block rounded-2xl bg-white border p-3.5 transition-colors',
            wrapInvoiceCount > 0 ? 'border-rose-100 hover:border-rose-300' : 'border-slate-100 hover:border-slate-200',
          )}
        >
          <div className="flex items-center gap-2.5">
            <span className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0',
              wrapInvoiceCount > 0 ? 'bg-rose-600 text-white' : 'bg-slate-50 text-slate-400',
            )}>
              <DollarSign className="h-4 w-4" strokeWidth={3} />
            </span>
            <div className="min-w-0">
              <p className="text-xl font-bold text-slate-900 leading-none tabular-nums">
                {wrapInvoiceCount > 0 ? (wrapInvoiceLabel ?? wrapInvoiceCount) : 0}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 leading-tight">
                {wrapInvoiceCount} session{wrapInvoiceCount === 1 ? '' : 's'} to invoice
              </p>
            </div>
          </div>
        </Link>
        <div className="block rounded-2xl bg-white border border-slate-100 p-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 flex-shrink-0">
              <Users className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xl font-bold text-slate-900 leading-none tabular-nums">{activeClients}/{totalClients}</p>
              <p className="text-[11px] text-slate-500 mt-1 leading-tight">active clients</p>
            </div>
          </div>
        </div>
        <div className="block rounded-2xl bg-white border border-slate-100 p-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600 flex-shrink-0">
              <PawPrint className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xl font-bold text-slate-900 leading-none tabular-nums">{activeDogs}/{totalDogs}</p>
              <p className="text-[11px] text-slate-500 mt-1 leading-tight">active dogs</p>
            </div>
          </div>
        </div>
      </div>

      {/* Day-scoped session list — surfaced next so the trainer sees what's
          on today before scrolling past stats. */}
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3 h-9">
          <h2 className="text-base font-semibold text-slate-900 leading-none min-w-0 truncate">
            {isToday
              ? "Today's sessions"
              : new Date(`${focusDateStr}T12:00:00Z`).toLocaleDateString('en-NZ', {
                  weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC',
                })}
          </h2>
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Today badge sits to the left of the arrows — only when we're
                not on today. The arrows themselves stay in fixed positions
                so muscle memory works regardless of which day is in view. */}
            {!isToday && (
              <Link
                href={todayHref}
                className="h-9 inline-flex items-center px-2 mr-1 text-xs font-medium text-blue-600 hover:underline"
              >
                Today
              </Link>
            )}
            <Link
              href={prevHref}
              aria-label="Previous day"
              className="h-9 w-9 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <Link
              href={nextHref}
              aria-label="Next day"
              className="h-9 w-9 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
        {todaysSessions.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <Calendar className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-500">
              {isToday ? 'No sessions scheduled for today.' : 'No sessions on this day.'}
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2.5">
            {(() => {
              const firstPastIndex = todaysSessions.findIndex(
                (s) => s.scheduledAt.getTime() + s.durationMins * 60_000 < nowMs,
              )
              return todaysSessions.map((s, idx) => {
                const sessionRequests = s.clientId ? requestsByClient.get(s.clientId) ?? [] : []
                const showDivider = idx === firstPastIndex && firstPastIndex > 0
                return (
                  <div key={s.id} className="contents">
                    {showDivider && (
                      <div className="flex items-center gap-3 pt-2 pb-1" aria-hidden>
                        <div className="h-px flex-1 bg-slate-200" />
                        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Earlier</span>
                        <div className="h-px flex-1 bg-slate-200" />
                      </div>
                    )}
                    <SessionRowCard
                      session={s}
                      tz={tz}
                      toBringCount={sessionRequests.length}
                    />
                  </div>
                )
              })
            })()}
          </div>
        )}
      </div>

      {/* Recent enquiries — only shown when there's actually been recent
          inbound activity, so the dashboard doesn't carry an empty card. */}
      {recentEnquiries.length > 0 && (
        <Link
          href="/enquiries"
          className={cn(
            'mb-6 block rounded-2xl border p-4 transition-colors',
            unviewedEnquiryCount > 0
              ? 'bg-violet-50 border-violet-100 hover:border-violet-200'
              : 'bg-white border-slate-200 hover:border-slate-300',
          )}
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0',
                unviewedEnquiryCount > 0 ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500',
              )}>
                <Inbox className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className={cn(
                  'font-semibold text-sm leading-tight',
                  unviewedEnquiryCount > 0 ? 'text-violet-900' : 'text-slate-900',
                )}>
                  {unviewedEnquiryCount > 0
                    ? `${unviewedEnquiryCount} new ${unviewedEnquiryCount === 1 ? 'enquiry' : 'enquiries'}`
                    : 'Recent enquiries'}
                </p>
                <p className={cn(
                  'text-xs mt-0.5',
                  unviewedEnquiryCount > 0 ? 'text-violet-700/80' : 'text-slate-500',
                )}>
                  Review, reply, accept or decline.
                </p>
              </div>
            </div>
            <ArrowRight className={cn(
              'h-4 w-4 flex-shrink-0 mt-1',
              unviewedEnquiryCount > 0 ? 'text-violet-700' : 'text-slate-400',
            )} />
          </div>
          <div className="flex flex-col gap-1.5 mt-3">
            {recentEnquiries.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between bg-white rounded-xl px-3.5 py-2 border border-slate-100"
              >
                <span className="text-sm text-slate-700 truncate flex items-center gap-2 min-w-0">
                  <span className={cn(
                    'font-medium truncate',
                    !e.viewedAt && 'text-violet-900',
                  )}>
                    {e.name}
                  </span>
                  {e.dogName && <span className="text-slate-400 truncate">· {e.dogName}</span>}
                  {!e.viewedAt && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-600 text-white uppercase tracking-wide flex-shrink-0">
                      New
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-slate-400 tabular-nums flex-shrink-0 ml-2">
                  {timeAgo(e.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </Link>
      )}

      {/* Pending product requests */}
      <PendingRequestsPanel
        requests={pendingProductRequests.map(r => ({
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          note: r.note,
          client: {
            id: r.client.id,
            name: r.client.user.name ?? r.client.user.email,
          },
          product: {
            id: r.product.id,
            name: r.product.name,
            kind: r.product.kind as 'PHYSICAL' | 'DIGITAL',
            imageUrl: r.product.imageUrl,
          },
        }))}
      />

      </div>
    </>
  )
}

function getGreeting(tz: string) {
  // Vercel runs Node in UTC, so new Date().getHours() returns UTC hours and
  // would call NZ 2pm "morning". Format the hour in the trainer's tz instead.
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz }))
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function timeAgo(date: Date): string {
  const ms = Date.now() - date.getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return date.toLocaleDateString()
}
