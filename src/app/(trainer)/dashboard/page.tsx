import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { UserPlus, TrendingUp, Calendar, MapPin, Video, ChevronLeft, ChevronRight, ArrowRight, ShoppingBag, Dog, Users, CheckCircle2, Inbox, type LucideIcon } from 'lucide-react'
import { WeeklyTasksStat, type WeeklyTask } from './weekly-tasks-stat'
import { PendingRequestsPanel } from './pending-requests-panel'
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
  if (!trainerId) redirect('/onboarding')

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
    where: { trainerId, scheduledAt: { gte: focusStart, lte: focusEnd } },
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
      diaryEntries: {
        where: { date: { gte: sevenDaysAgo } },
        select: { id: true, completion: { select: { id: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Detailed list for the expandable "Tasks this week" panel — fetched
  // separately so the count cards stay cheap and the panel has full task
  // data (title, dog, etc.) when it expands.
  const weeklyTasksRaw = await prisma.trainingTask.findMany({
    where: {
      client: { trainerId },
      date: { gte: sevenDaysAgo },
    },
    include: {
      client: { include: { user: { select: { name: true, email: true } } } },
      dog: { select: { name: true } },
      completion: { select: { id: true } },
    },
    orderBy: { date: 'asc' },
  })

  const weeklyTasks: WeeklyTask[] = weeklyTasksRaw.map(t => ({
    id: t.id,
    title: t.title,
    date: t.date.toISOString(),
    clientId: t.clientId,
    clientName: t.client.user.name ?? t.client.user.email,
    dogName: t.dog?.name ?? null,
    completed: !!t.completion,
  }))

  const totalClients = clients.length
  const weeklyTasksAssigned = weeklyTasks.length
  const weeklyTasksCompleted = weeklyTasks.filter(t => t.completed).length
  const overallCompliance =
    weeklyTasksAssigned > 0
      ? Math.round((weeklyTasksCompleted / weeklyTasksAssigned) * 100)
      : null

  const lowComplianceClients = clients.filter((c) => {
    const assigned = c.diaryEntries.length
    if (assigned === 0) return false
    const completed = c.diaryEntries.filter(t => t.completion).length
    return completed / assigned < 0.4
  })

  // New enquiries — embed-form submissions awaiting trainer review. The
  // badge counts unviewed NEW rows; the card shows the latest few inline so
  // the trainer can scan names without leaving the dashboard.
  const newEnquiries = await prisma.enquiry.findMany({
    where: { trainerId, status: 'NEW' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      dogName: true,
      createdAt: true,
      viewedAt: true,
    },
    take: 5,
  })
  const unviewedEnquiryCount = await prisma.enquiry.count({
    where: { trainerId, status: 'NEW', viewedAt: null },
  })

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
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          Good {getGreeting()}, {session.user.name?.split(' ')[0]} 👋
        </h1>
        <p className="hidden sm:block text-slate-500 text-sm mt-1">{session.user.businessName}</p>
      </div>

      {/* Quick actions — top-of-page so primary jobs-to-be-done are one tap away. */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-8">
        <QuickAction href="/clients/invite" icon={<UserPlus className="h-5 w-5" />} label="Invite client" />
        <QuickAction href="/schedule" icon={<Calendar className="h-5 w-5" />} label="Book session" />
        <QuickAction href="/progress" icon={<TrendingUp className="h-5 w-5" />} label="View progress" />
        <QuickAction href="/schedule" icon={<Calendar className="h-5 w-5" />} label="Schedule" />
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
            {!isToday && (
              <Link
                href={todayHref}
                className="h-9 inline-flex items-center px-2 text-xs font-medium text-blue-600 hover:underline"
              >
                Today
              </Link>
            )}
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
                (s) => s.scheduledAt.getTime() + s.durationMins * 60_000 < nowMs
              )
              return todaysSessions.map((s, idx) => {
              const clientUser = s.client?.user ?? s.dog?.primaryFor[0]?.user
              const clientName = clientUser ? (clientUser.name ?? clientUser.email) : null
              const start = new Date(s.scheduledAt)
              const isPast = start.getTime() + s.durationMins * 60_000 < new Date().getTime()
              const meta = STATUS_META[s.status]
              const sessionRequests = s.clientId ? requestsByClient.get(s.clientId) ?? [] : []
              const startTime = start.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })
              const isVirtual = s.sessionType === 'VIRTUAL'
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
                <Card
                  className={cn(
                    'p-0 overflow-hidden transition-all hover:shadow-md hover:-translate-y-px',
                    isPast && 'opacity-60'
                  )}
                >
                  <div className="flex items-stretch sm:h-12 sm:min-h-12">
                    {/* Time rail — colour-coded by status, compact on desktop */}
                    <div className={cn(
                      'flex-shrink-0 w-[72px] sm:w-auto sm:px-3 flex flex-col sm:flex-row items-center justify-center sm:gap-1.5 px-2 py-2.5 sm:py-0 text-center border-r',
                      isPast
                        ? 'bg-slate-50 border-slate-100 text-slate-500'
                        : 'bg-blue-50/60 border-blue-100 text-blue-700'
                    )}>
                      <p className="text-base sm:text-sm font-bold leading-none tabular-nums">{startTime}</p>
                      <p className="text-[10px] sm:text-[11px] font-medium opacity-70 mt-0.5 sm:mt-0">{s.durationMins} min</p>
                    </div>

                    {/* Body — stacked on mobile (Dog → Client → Package), one row on desktop */}
                    <div className="flex-1 min-w-0 px-3 py-2 sm:py-0 sm:px-3.5 flex flex-col sm:flex-row sm:items-center gap-y-0.5 sm:gap-y-0 sm:gap-x-2">
                      {/* Dog (or fallback to title if no dog) */}
                      <div className="inline-flex items-center gap-1.5 min-w-0">
                        {s.dog ? (
                          <>
                            <Dog className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" aria-hidden />
                            <p className="text-sm font-semibold text-slate-900 truncate">{s.dog.name}</p>
                          </>
                        ) : (
                          <p className="text-sm font-semibold text-slate-900 truncate">{s.title}</p>
                        )}
                      </div>

                      {clientName && (
                        <>
                          <span className="hidden sm:inline text-slate-300" aria-hidden>·</span>
                          <p className="text-xs font-medium text-slate-700 truncate sm:max-w-[18ch]">{clientName}</p>
                        </>
                      )}

                      {s.dog && (
                        <>
                          <span className="hidden sm:inline text-slate-300" aria-hidden>·</span>
                          <p className="text-xs text-slate-500 truncate sm:max-w-[26ch]">{s.title}</p>
                        </>
                      )}

                      {/* Status pill — sits inline on desktop, on its own row on mobile */}
                      <span className={cn(
                        'inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap self-start mt-1 sm:mt-0 sm:ml-auto sm:self-auto',
                        meta.colour
                      )}>
                        {meta.label}
                      </span>

                      {sessionRequests.length > 0 && (
                        <span
                          className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 whitespace-nowrap flex-shrink-0"
                          title={sessionRequests.map(r => r.product.name).join(', ')}
                        >
                          <ShoppingBag className="h-3 w-3" aria-hidden />
                          {sessionRequests.length} to bring
                        </span>
                      )}
                    </div>

                    {/* Action rail */}
                    <Link
                      href={`/sessions/${s.id}`}
                      aria-label={`Start session: ${s.title}`}
                      className="group flex-shrink-0 w-14 sm:w-auto flex items-center justify-center gap-1 sm:gap-1.5 px-0 sm:px-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white transition-colors"
                    >
                      <span className="hidden sm:inline text-xs font-semibold">Start</span>
                      <ArrowRight className="h-4 w-4 sm:h-3.5 sm:w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </div>
                </Card>
                </div>
              )
            })
            })()}
          </div>
        )}
      </div>

      {/* New enquiries — surface fresh leads above the lower-priority panels
          so the trainer sees them immediately. */}
      {newEnquiries.length > 0 && (
        <Link
          href="/enquiries"
          className="mb-6 block rounded-2xl bg-violet-50 border border-violet-100 p-4 hover:border-violet-200 transition-colors"
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700 flex-shrink-0">
                <Inbox className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-violet-900 text-sm leading-tight">
                  {unviewedEnquiryCount > 0
                    ? `${unviewedEnquiryCount} new ${unviewedEnquiryCount === 1 ? 'enquiry' : 'enquiries'}`
                    : `${newEnquiries.length} ${newEnquiries.length === 1 ? 'enquiry' : 'enquiries'} awaiting decision`}
                </p>
                <p className="text-xs text-violet-700/80 mt-0.5">
                  Review and accept to onboard them as a client.
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-violet-700 flex-shrink-0 mt-1" />
          </div>
          <div className="flex flex-col gap-1.5 mt-3">
            {newEnquiries.slice(0, 3).map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between bg-white rounded-xl px-3.5 py-2 border border-transparent"
              >
                <span className="text-sm text-slate-700 truncate">
                  <span className={cn('font-medium', !e.viewedAt && 'text-violet-900')}>
                    {e.name}
                  </span>
                  {e.dogName && <span className="text-slate-400"> · {e.dogName}</span>}
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

      {/* Low compliance alert */}
      {lowComplianceClients.length > 0 && (
        <div className="mb-6 rounded-2xl bg-amber-50 border border-amber-100 p-4">
          <p className="font-semibold text-amber-900 mb-2">
            ⚠️ {lowComplianceClients.length} client{lowComplianceClients.length > 1 ? 's' : ''} need attention
          </p>
          <div className="flex flex-col gap-2">
            {lowComplianceClients.map((c) => {
              const rate = Math.round(
                (c.diaryEntries.filter(t => t.completion).length / c.diaryEntries.length) * 100
              )
              return (
                <Link
                  key={c.id}
                  href={`/clients/${c.id}`}
                  className="flex items-center justify-between bg-white rounded-xl px-4 py-2.5 hover:border-amber-200 border border-transparent transition-colors"
                >
                  <span className="text-sm font-medium text-slate-700">
                    {c.user.name ?? c.user.email}
                    {c.dog && <span className="text-slate-400"> · {c.dog.name}</span>}
                  </span>
                  <span className="text-sm font-bold text-red-500">{rate}%</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Stats — kept at the bottom as supporting context, not primary action area. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Clients"
          value={String(totalClients)}
          icon={Users}
          iconClass="bg-blue-50 text-blue-600"
        />
        <WeeklyTasksStat tasks={weeklyTasks} />
        <StatCard
          label="Completed"
          value={String(weeklyTasksCompleted)}
          icon={CheckCircle2}
          iconClass="bg-emerald-50 text-emerald-600"
          sub={weeklyTasksAssigned > 0 ? `of ${weeklyTasksAssigned}` : undefined}
        />
        <StatCard
          label="Compliance"
          value={overallCompliance != null ? `${overallCompliance}%` : '—'}
          icon={TrendingUp}
          iconClass={overallCompliance == null
            ? 'bg-slate-100 text-slate-500'
            : overallCompliance >= 70
              ? 'bg-emerald-50 text-emerald-600'
              : 'bg-rose-50 text-rose-600'
          }
          highlight={overallCompliance != null}
          highlightGood={overallCompliance != null && overallCompliance >= 70}
          progress={overallCompliance ?? undefined}
        />
      </div>
    </div>
  )
}

const STATUS_META: Record<'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'INVOICED', { label: string; colour: string }> = {
  UPCOMING:  { label: 'Upcoming',  colour: 'bg-blue-50 text-blue-700 border-blue-200' },
  COMPLETED: { label: 'Completed', colour: 'bg-green-50 text-green-700 border-green-200' },
  COMMENTED: { label: 'Commented', colour: 'bg-amber-50 text-amber-700 border-amber-200' },
  INVOICED:  { label: 'Invoiced',  colour: 'bg-purple-50 text-purple-700 border-purple-200' },
}

function StatCard({
  label,
  value,
  icon: Icon,
  iconClass,
  sub,
  highlight,
  highlightGood,
  progress,
}: {
  label: string
  value: string
  icon: LucideIcon
  iconClass?: string
  sub?: React.ReactNode
  highlight?: boolean
  highlightGood?: boolean
  progress?: number
}) {
  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <span className={cn(
          'flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0',
          iconClass ?? 'bg-slate-100 text-slate-500'
        )}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <p className={cn(
          'text-2xl font-bold tabular-nums leading-none',
          highlight ? (highlightGood ? 'text-emerald-600' : 'text-rose-500') : 'text-slate-900'
        )}>
          {value}
        </p>
        {sub && <p className="text-xs text-slate-500">{sub}</p>}
      </div>
      {progress != null && (
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={cn('h-full transition-all', progress >= 70 ? 'bg-emerald-500' : 'bg-rose-400')}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </Card>
  )
}

function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="block h-full">
      <Card className="h-full p-3 sm:p-4 flex flex-col items-center justify-start gap-1.5 sm:gap-2 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer text-center">
        <span className="text-blue-600">{icon}</span>
        <span className="text-[11px] sm:text-xs font-medium text-slate-700 leading-tight">{label}</span>
      </Card>
    </Link>
  )
}

function getGreeting() {
  const h = new Date().getHours()
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
