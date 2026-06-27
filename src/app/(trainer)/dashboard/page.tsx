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
import { StreakChip } from '@/components/shared/streak-chip'
import { PendingRequestsPanel } from './pending-requests-panel'
import { TodoBrainDumpPanel } from './todo-braindump-panel'
import { hasAddon, getEnabledAddons } from '@/lib/billing'
import { isCurrencyCode, DEFAULT_CURRENCY, type CurrencyCode } from '@/lib/pricing'
import { OnboardingPanel } from './onboarding-panel'
import { SampleDataBanner } from './sample-data-banner'
import { CountryPrompt } from './country-prompt'
import { TrialBanner } from '../trial-banner'
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

  const sp = await searchParams
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const NOTES_DONE_STATUSES = ['COMMENTED', 'COMPLETED', 'INVOICED']

  // Start every independent query at once so they run in parallel against the
  // remote DB rather than serially (each round-trip is ~100ms+ — stacking ten
  // of them is what made this page slow). Awaited below where first used.
  const onboardingP = (async () => { await initTrainerOnboarding(trainerId); return getOnboardingState(trainerId) })()
  const brandingP = prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: {
      businessName: true, logoUrl: true, emailAccentColor: true, appGradientStart: true, appGradientEnd: true,
      clientWelcomeNote: true, website: true, phone: true, publicEmail: true, signupCountry: true,
      payoutCurrency: true,
      subscriptionStatus: true, trialEndsAt: true, stripeSubscriptionId: true,
      user: { select: { email: true } },
    },
  })
  const sampleCountP = prisma.clientProfile.count({ where: { trainerId, isSample: true } })
  // Real (non-sample) client count — once it reaches 3 the sample-data banner
  // nudges the trainer to clear the demo records and focus on the real thing.
  const realClientCountP = prisma.clientProfile.count({ where: { trainerId, isSample: false } })
  const trainerUserP = prisma.user.findUnique({ where: { id: session.user.id }, select: { timezone: true } })
  const clientsP = prisma.clientProfile.findMany({
    where: { trainerId },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true } },
      dogs: { select: { id: true } },
      diaryEntries: { where: { date: { gte: sevenDaysAgo } }, select: { id: true, completion: { select: { id: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const recentEnquiriesP = prisma.enquiry.findMany({
    where: { trainerId, status: 'NEW' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, dogName: true, status: true, viewedAt: true, createdAt: true },
    take: 5,
  })
  const unviewedEnquiryCountP = prisma.enquiry.count({ where: { trainerId, status: 'NEW', viewedAt: null } })
  const sessionsToActionP = prisma.trainingSession.findMany({
    where: {
      trainerId,
      scheduledAt: { lt: new Date() },
      clientId: { not: null },
      OR: [
        { AND: [{ formResponses: { none: {} } }, { status: { notIn: NOTES_DONE_STATUSES as ('COMMENTED' | 'COMPLETED' | 'INVOICED')[] } }] },
        { invoicedAt: null },
      ],
    },
    select: {
      invoicedAt: true,
      status: true,
      _count: { select: { formResponses: true } },
      clientPackage: { select: { package: { select: { priceCents: true, sessionCount: true } } } },
    },
  })
  const pendingProductRequestsP = prisma.productRequest.findMany({
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

  // Right-rail scratchpad data: the company's to-dos, this user's brain dump,
  // and the team roster (for the to-do assignee picker; only relevant >1 member).
  const todosP = prisma.trainerTodo.findMany({
    where: { companyId: trainerId },
    include: { assignedTo: { select: { id: true, user: { select: { name: true, email: true } } } } },
    orderBy: [{ done: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
  })
  const brainDumpP = prisma.trainerBrainDump.findUnique({
    where: { companyId_userId: { companyId: trainerId, userId: session.user.id } },
    select: { body: true },
  })
  const membersP = prisma.trainerMembership.findMany({
    where: { companyId: trainerId },
    select: { id: true, user: { select: { name: true, email: true } } },
    orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
  })

  const onboardingState = await onboardingP
  const brandingProfile = await brandingP
  // Add-on state for the onboarding wizard's "Add-ons" step — which are already
  // on, and the currency to quote prices in (payout currency when we price in
  // it, else NZD).
  const enabledAddonSet = await getEnabledAddons(trainerId)
  const payout = (brandingProfile?.payoutCurrency ?? '').toUpperCase()
  const wizardCurrency: CurrencyCode = isCurrencyCode(payout) ? payout : DEFAULT_CURRENCY
  const branding = {
    businessName: brandingProfile?.businessName ?? '',
    logoUrl: brandingProfile?.logoUrl ?? null,
    emailAccentColor: brandingProfile?.emailAccentColor ?? null,
    appGradientStart: brandingProfile?.appGradientStart ?? null,
    appGradientEnd: brandingProfile?.appGradientEnd ?? null,
    clientWelcomeNote: brandingProfile?.clientWelcomeNote ?? null,
    website: brandingProfile?.website ?? null,
    phone: brandingProfile?.phone ?? null,
    publicEmail: brandingProfile?.publicEmail ?? null,
    signupEmail: brandingProfile?.user?.email ?? '',
    currency: wizardCurrency,
    enabledAddonIds: [...enabledAddonSet],
  }

  // Whether the trainer currently has loaded sample data — drives the "remove
  // sample data" banner. Sample clients are always part of a sample load.
  const sampleClientCount = await sampleCountP
  const realClientCount = await realClientCountP

  // Trainer's timezone drives all day-bounds and time formatting on this
  // server-rendered page. Vercel runs Node in UTC so without this every
  // time would render as UTC for everyone.
  const trainerUser = await trainerUserP
  const tz = trainerUser?.timezone ?? 'Pacific/Auckland'

  const todayDateStr = todayInTz(tz)
  const focusDateStr = (sp.date && parseLocalDate(sp.date)) ? sp.date! : todayDateStr
  const focusDate = parseLocalDate(focusDateStr)!
  const focusStart = startOfDayInTz(focusDateStr, tz)
  const focusEnd = endOfDayInTz(focusDateStr, tz)
  const isToday = focusDateStr === todayDateStr

  const todaysSessionsRaw = await prisma.trainingSession.findMany({
    where: {
      trainerId,
      scheduledAt: { gte: focusStart, lte: focusEnd },
      // Include 1:1 sessions (clientId set) and group-class sessions
      // (classRunId set). clientId is `onDelete: SetNull`, so a deleted client
      // leaves orphan rows — those (no client AND no class) stay hidden.
      OR: [{ clientId: { not: null } }, { classRunId: { not: null } }],
    },
    include: {
      client: { select: { user: { select: { name: true, email: true } } } },
      dog: {
        select: {
          name: true,
          photoUrl: true,
          primaryFor: { select: { user: { select: { name: true, email: true } } } },
        },
      },
      classRun: { select: { name: true } },
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

  const clients = await clientsP
  // The To-do / Brain dump scratchpad is a (free) add-on — only show it when on.
  const hasTodos = await hasAddon(trainerId, 'todos')

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
  const recentEnquiries = await recentEnquiriesP
  const unviewedEnquiryCount = await unviewedEnquiryCountP

  // Past sessions still needing notes OR an invoice — the dashboard CTA links
  // to /sessions/needs-notes which is now framed as a generic "to do" list.
  // We fetch the rows (not just a count) so we can also surface the
  // notes-pending count + total un-invoiced value alongside the headline.
  // Sessions marked complete/commented/invoiced no longer "need notes" — only
  // a missing write-up on a not-yet-completed session counts (mirrors the
  // /sessions/needs-notes page).
  const sessionsToAction = await sessionsToActionP
  const sessionsToActionCount = sessionsToAction.length
  const wrapNotesCount = sessionsToAction.filter(s => s._count.formResponses === 0 && !(NOTES_DONE_STATUSES as readonly string[]).includes(s.status)).length
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
  const pendingProductRequests = await pendingProductRequestsP

  // Index requests by client so we can show them inline on each "Coming up
  // today" session row — the trainer sees what to bring at a glance.
  const requestsByClient = new Map<string, typeof pendingProductRequests>()
  for (const r of pendingProductRequests) {
    const arr = requestsByClient.get(r.client.id) ?? []
    arr.push(r)
    requestsByClient.set(r.client.id, arr)
  }

  // Right-rail scratchpad — serialize for the client panel. Members list is
  // only passed to drive the assignee picker; the panel hides it for solo orgs.
  const [todos, brainDump, members] = await Promise.all([todosP, brainDumpP, membersP])
  const todoItems = todos.map((t) => ({
    id: t.id,
    title: t.title,
    done: t.done,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    assignee: t.assignedTo
      ? { id: t.assignedTo.id, name: t.assignedTo.user.name?.trim() || t.assignedTo.user.email || 'Trainer' }
      : null,
  }))
  const memberOptions = members.map((m) => ({
    id: m.id,
    name: m.user.name?.trim() || m.user.email || 'Trainer',
  }))

  return (
    <>
      <PageHeader
        title={`Good ${getGreeting(tz)}, ${session.user.name?.split(' ')[0] ?? 'there'} 👋`}
        actions={
          <>
            <TrialBanner
              placement="header"
              status={brandingProfile?.subscriptionStatus ?? 'TRIALING'}
              trialEndsAt={brandingProfile?.trialEndsAt ?? null}
              hasSubscription={!!brandingProfile?.stripeSubscriptionId}
            />
            <StreakChip trainerId={trainerId} />
          </>
        }
      />
      <div className="p-4 md:p-8 w-full">
        {/* iOS/Android only: prompt for a country when we couldn't capture it
            from the IP at signup. Hidden on web and once one is set. */}
        <CountryPrompt hasCountry={!!brandingProfile?.signupCountry} />
        {/* Two-column layout on lg+: the existing dashboard widgets fill the
            main column (8/12) while the scratchpad panel (To-do / Brain dump)
            sits in a 4/12 right rail. Stacks full-width below lg. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-8">
          <div className={cn('min-w-0', hasTodos ? 'lg:col-span-8' : 'lg:col-span-12')}>
        {/* While sample data is loaded the account looks set up, so show the
            "remove sample data" strip at the top and hide the get-set-up
            onboarding. Removing the sample data brings the onboarding back. */}
        {sampleClientCount > 0 && <SampleDataBanner realClientCount={realClientCount} />}
        <BookingRequestsPanel trainerId={trainerId} />
        <WaitlistNudge trainerId={trainerId} />
        {sampleClientCount === 0 && <OnboardingPanel state={onboardingState} branding={branding} impersonating={!!session.user.impersonatorId} />}

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

          {/* Right rail — To-do / Brain dump scratchpad (a free add-on). On lg+
              it sticks below the page header so it stays visible while the main
              column scrolls. */}
          {hasTodos && (
            <div className="lg:col-span-4 min-w-0 mt-2 lg:mt-0">
              <div className="lg:sticky lg:top-4">
                <TodoBrainDumpPanel
                  initialTodos={todoItems}
                  initialBrainDump={brainDump?.body ?? ''}
                  members={memberOptions}
                />
              </div>
            </div>
          )}
        </div>
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
