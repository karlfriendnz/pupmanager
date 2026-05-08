import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ArrowLeft, FileText, ChevronRight, Dog } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Notes to write' }

// "Needs notes" = past session, status not yet INVOICED, no SessionFormResponse
// row. Once the trainer writes the notes (creates a response) the row drops
// off the list automatically; once they mark INVOICED we treat that as
// "trainer is done thinking about this" and stop nagging.
async function loadPendingSessions(trainerId: string) {
  const now = new Date()
  return prisma.trainingSession.findMany({
    where: {
      trainerId,
      scheduledAt: { lt: now },
      status: { in: ['UPCOMING', 'COMPLETED', 'COMMENTED'] },
      formResponses: { none: {} },
    },
    orderBy: { scheduledAt: 'desc' },
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      durationMins: true,
      status: true,
      client: { select: { user: { select: { name: true, email: true } } } },
      dog: {
        select: {
          name: true,
          primaryFor: { take: 1, select: { user: { select: { name: true, email: true } } } },
        },
      },
    },
  })
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

function formatWeekLabel(weekStart: Date): string {
  const today = startOfWeek(new Date())
  const diffMs = today.getTime() - weekStart.getTime()
  const weeksAgo = Math.round(diffMs / (1000 * 60 * 60 * 24 * 7))
  if (weeksAgo === 0) return 'This week'
  if (weeksAgo === 1) return 'Last week'
  if (weeksAgo < 4) return `${weeksAgo} weeks ago`
  return weekStart.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function NeedsNotesPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const sessions = await loadPendingSessions(trainerId)

  // Group by Monday-anchored week so the trainer can scan one week at a time.
  // Map preserves insertion order which is already DESC by scheduledAt, so
  // the resulting weeks are this-week → last-week → older without re-sorting.
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
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <FileText className="h-6 w-6 text-amber-500" />
          Notes to write
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {sessions.length === 0
            ? 'You\'re all caught up — every past session has a write-up.'
            : `${sessions.length} session${sessions.length === 1 ? '' : 's'} still need your notes.`}
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-2xl bg-white border border-dashed border-slate-200 p-10 text-center">
          <FileText className="h-8 w-8 mx-auto text-slate-300" />
          <p className="text-sm font-medium text-slate-600 mt-3">All caught up</p>
          <p className="text-xs text-slate-400 mt-1">Past sessions with notes recorded won&apos;t show here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {Array.from(byWeek.values()).map(({ weekStart, sessions }) => (
            <section key={weekStart.toISOString()}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-baseline gap-2">
                <span>{formatWeekLabel(weekStart)}</span>
                <span className="text-slate-300 font-normal normal-case tracking-normal">
                  {weekStart.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} —
                  {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                </span>
              </h2>
              <div className="rounded-2xl bg-white border border-slate-100 overflow-hidden">
                {sessions.map((s, i) => {
                  const clientUser = s.client?.user ?? s.dog?.primaryFor[0]?.user
                  const clientName = clientUser ? (clientUser.name ?? clientUser.email) : null
                  const start = new Date(s.scheduledAt)
                  return (
                    <Link
                      key={s.id}
                      href={`/sessions/${s.id}`}
                      className={`flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors ${i > 0 ? 'border-t border-slate-100' : ''}`}
                    >
                      <div className="flex h-10 w-10 flex-col items-center justify-center rounded-xl bg-amber-50 text-amber-700 flex-shrink-0">
                        <span className="text-[10px] font-semibold uppercase leading-none">
                          {start.toLocaleDateString('en-NZ', { weekday: 'short' })}
                        </span>
                        <span className="text-sm font-bold leading-tight">
                          {start.getDate()}
                        </span>
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
                          <span className="text-slate-300">·</span>
                          <span>
                            {start.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                    </Link>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
