import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ListTodo, ChevronRight, Dog, FileText, DollarSign } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'To do' }

// Past sessions that still need either a write-up OR an invoice. Once both
// are recorded the row drops off automatically. Note that we don't filter on
// status here — invoicing/notes are independent of the completion lifecycle.
async function loadPendingSessions(trainerId: string) {
  const now = new Date()
  return prisma.trainingSession.findMany({
    where: {
      trainerId,
      scheduledAt: { lt: now },
      clientId: { not: null },
      OR: [
        { formResponses: { none: {} } },
        { invoicedAt: null },
      ],
    },
    // Oldest first — this is a backlog queue, not a feed. The next session
    // the trainer needs to work on is the one that's been waiting longest.
    orderBy: { scheduledAt: 'asc' },
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      durationMins: true,
      status: true,
      invoicedAt: true,
      _count: { select: { formResponses: true } },
      client: { select: { user: { select: { name: true, email: true } } } },
      dog: {
        select: {
          name: true,
          primaryFor: { take: 1, select: { user: { select: { name: true, email: true } } } },
        },
      },
      // Session value: package price prorated across the package's session
      // count. Null priceCents or sessionCount = unpriced; the badge will
      // fall back to a dollar icon without an amount.
      clientPackage: {
        select: { package: { select: { priceCents: true, sessionCount: true } } },
      },
    },
  })
}

function sessionValueCents(s: { clientPackage: { package: { priceCents: number | null; sessionCount: number } | null } | null }): number | null {
  const pkg = s.clientPackage?.package
  if (!pkg?.priceCents || !pkg.sessionCount || pkg.sessionCount <= 0) return null
  return Math.round(pkg.priceCents / pkg.sessionCount)
}

function formatDollars(cents: number): string {
  const dollars = cents / 100
  // Whole dollars when even; one decimal otherwise. "$60" reads cleaner than
  // "$60.00" in a chip.
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

// Monday-anchored week start in local server time.
function startOfWeek(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const day = out.getDay()
  const diff = day === 0 ? -6 : 1 - day
  out.setDate(out.getDate() + diff)
  return out
}

function dayKey(d: Date): string {
  // YYYY-MM-DD in local time, stable group key for day sub-groups.
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDayLabel(d: Date): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(d); target.setHours(0, 0, 0, 0)
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return target.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'short' })
}

function formatWeekLabel(weekStart: Date): string {
  const today = startOfWeek(new Date())
  const diffMs = today.getTime() - weekStart.getTime()
  const weeksAgo = Math.round(diffMs / (1000 * 60 * 60 * 24 * 7))
  if (weeksAgo === 0) return 'This week'
  if (weeksAgo === 1) return 'Last week'
  if (weeksAgo < 4) return `${weeksAgo} weeks ago`
  return weekStart.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function SessionsTodoPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const sessions = await loadPendingSessions(trainerId)
  const needsNotesCount = sessions.filter(s => s._count.formResponses === 0).length
  const needsInvoiceCount = sessions.filter(s => s.invoicedAt == null).length
  // Sum the prorated session value across every un-invoiced row. Sessions
  // without a priced package don't contribute (sessionValueCents returns
  // null for those), so this is "what we know we're owed", not a guess.
  const totalInvoiceCents = sessions.reduce((sum, s) => {
    if (s.invoicedAt != null) return sum
    const v = sessionValueCents(s)
    return v != null ? sum + v : sum
  }, 0)

  // Group by Monday-anchored week so the trainer can scan one week at a time.
  // Map preserves insertion order which is ASC by scheduledAt, so the oldest
  // week is at the top — the "next up" in the backlog queue.
  type Row = (typeof sessions)[number]
  const byWeek = new Map<string, { weekStart: Date; sessions: Row[] }>()
  for (const s of sessions) {
    const ws = startOfWeek(new Date(s.scheduledAt))
    const key = ws.toISOString().split('T')[0]
    const existing = byWeek.get(key)
    if (existing) existing.sessions.push(s)
    else byWeek.set(key, { weekStart: ws, sessions: [s] })
  }

  return (
    <>
      <PageHeader
        title="Sessions to wrap up"
        back={{ href: '/dashboard', label: 'Back to dashboard' }}
        actions={<ListTodo className="h-5 w-5 text-amber-500" />}
      />
      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">

      <div className="mb-6">

        {sessions.length === 0 ? (
          <p className="text-sm text-slate-500 mt-1">
            You&apos;re all caught up — every past session has notes recorded and is invoiced.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white border border-amber-100 p-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <FileText className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-slate-900 leading-none tabular-nums">{needsNotesCount}</p>
                <p className="text-xs text-slate-500 mt-1">need notes</p>
              </div>
            </div>
            <div className="rounded-2xl bg-white border border-rose-100 p-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-600 text-white">
                <DollarSign className="h-5 w-5" strokeWidth={3} />
              </span>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-slate-900 leading-none tabular-nums">
                  {totalInvoiceCents > 0 ? formatDollars(totalInvoiceCents) : needsInvoiceCount}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {needsInvoiceCount} session{needsInvoiceCount === 1 ? '' : 's'} to invoice
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-2xl bg-white border border-dashed border-slate-200 p-10 text-center">
          <ListTodo className="h-8 w-8 mx-auto text-slate-300" />
          <p className="text-sm font-medium text-slate-600 mt-3">All caught up</p>
          <p className="text-xs text-slate-400 mt-1">Past sessions only show here while notes or invoicing are pending.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {Array.from(byWeek.values()).map(({ weekStart, sessions }) => {
            // Group this week's sessions by day. Insertion order tracks the
            // ASC scheduledAt query so the oldest day in the week comes first.
            const byDay = new Map<string, { date: Date; sessions: typeof sessions }>()
            for (const s of sessions) {
              const dt = new Date(s.scheduledAt)
              const key = dayKey(dt)
              const existing = byDay.get(key)
              if (existing) existing.sessions.push(s)
              else byDay.set(key, { date: dt, sessions: [s] })
            }
            return (
              <section key={weekStart.toISOString()}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3 flex items-baseline gap-2">
                  <span>{formatWeekLabel(weekStart)}</span>
                  <span className="text-slate-300 font-normal normal-case tracking-normal">
                    {weekStart.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} —
                    {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                  </span>
                </h2>
                <div className="flex flex-col gap-4">
                  {Array.from(byDay.values()).map(({ date, sessions: daySessions }) => (
                    <div key={dayKey(date)}>
                      <h3 className="text-[11px] font-semibold text-slate-500 mb-1.5 px-1">
                        {formatDayLabel(date)}
                      </h3>
                      <div className="rounded-2xl bg-white border border-slate-100 overflow-hidden">
                        {daySessions.map((s, i) => {
                          const clientUser = s.client?.user ?? s.dog?.primaryFor[0]?.user
                          const clientName = clientUser ? (clientUser.name ?? clientUser.email) : null
                          const start = new Date(s.scheduledAt)
                          const needsNotes = s._count.formResponses === 0
                          const needsInvoice = s.invoicedAt == null
                          const valueCents = sessionValueCents(s)
                          return (
                            <Link
                              key={s.id}
                              href={`/sessions/${s.id}`}
                              className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors ${i > 0 ? 'border-t border-slate-100' : ''}`}
                            >
                              <div className="w-12 flex-shrink-0 text-xs font-semibold text-slate-500 tabular-nums">
                                {start.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-900 truncate">{s.title}</p>
                                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                                  {s.dog && (
                                    <span className="inline-flex items-center gap-1">
                                      <Dog className="h-3 w-3" /> {s.dog.name}
                                    </span>
                                  )}
                                  {clientName && (
                                    <>
                                      {s.dog && <span className="text-slate-300">·</span>}
                                      <span className="truncate">{clientName}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                                {needsNotes && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                    <FileText className="h-3 w-3" /> Notes
                                  </span>
                                )}
                                {needsInvoice && (
                                  <span
                                    className="inline-flex items-center gap-1 text-[10px] font-semibold pl-0.5 pr-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200"
                                    title={valueCents != null ? `Invoice for ${formatDollars(valueCents)}` : 'Needs invoice'}
                                  >
                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-white">
                                      <DollarSign className="h-2.5 w-2.5" strokeWidth={3} />
                                    </span>
                                    {valueCents != null ? formatDollars(valueCents) : 'Invoice'}
                                  </span>
                                )}
                              </div>
                              <div className="sm:hidden flex items-center gap-1 flex-shrink-0">
                                {needsNotes && (
                                  <span className="h-2 w-2 rounded-full bg-amber-500" title="Needs notes" />
                                )}
                                {needsInvoice && (
                                  <span className="h-2 w-2 rounded-full bg-rose-500" title={valueCents != null ? `Invoice for ${formatDollars(valueCents)}` : 'Needs invoice'} />
                                )}
                              </div>
                              <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
      </div>
    </>
  )
}
