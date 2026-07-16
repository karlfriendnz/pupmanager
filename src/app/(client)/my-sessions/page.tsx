import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Calendar, Clock, MapPin, Video, ChevronRight, Users } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { PageHeader } from '@/components/shared/page-header'
import { resolveCancellationFeeCents } from '@/lib/cancellation'
import { CancelSessionButton } from './cancel-session-button'
import { LeaveClassButton } from './leave-class-button'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Sessions' }

const DONE = ['COMPLETED', 'COMMENTED', 'INVOICED']

type Row = {
  id: string
  title: string
  scheduledAt: Date
  durationMins: number
  sessionType: string
  location: string | null
  status: string
  isClass: boolean
  className: string | null
  classRunId: string | null
}

function formatDateTime(d: Date) {
  return d.toLocaleString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export default async function MySessionsPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const now = new Date()

  // The client's trainer, for the self-cancel affordance: the cancellation-fee
  // config drives the fee we warn about before they confirm.
  const clientProfile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      trainer: {
        select: { cancellationFeeCents: true, cancellationFeeWindowHours: true, payoutCurrency: true },
      },
    },
  })
  const feeConfig = {
    cancellationFeeCents: clientProfile?.trainer.cancellationFeeCents ?? null,
    cancellationFeeWindowHours: clientProfile?.trainer.cancellationFeeWindowHours ?? null,
  }
  const currency = clientProfile?.trainer.payoutCurrency ?? 'nzd'
  const feeFor = (at: Date) => resolveCancellationFeeCents(feeConfig, at, now)

  // 1:1 sessions (direct client link) + group-class sessions (via the client's
  // enrolments → the run's shared sessions). Merged into one timeline.
  const [oneToOne, enrollments] = await Promise.all([
    prisma.trainingSession.findMany({
      where: { clientId: active.clientId },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true, title: true, scheduledAt: true, durationMins: true, sessionType: true, location: true, status: true },
    }),
    prisma.classEnrollment.findMany({
      where: { clientId: active.clientId, status: { not: 'WITHDRAWN' } },
      select: {
        classRun: {
          select: {
            id: true,
            name: true,
            sessions: { select: { id: true, title: true, scheduledAt: true, durationMins: true, sessionType: true, location: true, status: true } },
          },
        },
      },
    }),
  ])

  const rows: Row[] = [
    ...oneToOne.map(s => ({ ...s, isClass: false, className: null, classRunId: null })),
    ...enrollments.flatMap(e => e.classRun.sessions.map(s => ({ ...s, isClass: true, className: e.classRun.name, classRunId: e.classRun.id }))),
  ]

  const upcoming = rows
    .filter(s => s.scheduledAt >= now && s.status === 'UPCOMING')
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
  const past = rows
    .filter(s => s.scheduledAt < now || DONE.includes(s.status))
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())
    .slice(0, 50)

  const titleOf = (s: Row) => (s.isClass ? s.className ?? s.title : s.title)
  const hasAny = upcoming.length > 0 || past.length > 0
  const [next, ...restUpcoming] = upcoming

  // "Leave class" withdraws the whole enrolment, so show it just ONCE per class —
  // on its soonest upcoming session. `upcoming` is sorted ascending, so the first
  // row seen for a run is its earliest. Maps that session id → its run id.
  const leaveClassAt = new Map<string, string>()
  const seenRuns = new Set<string>()
  for (const s of upcoming) {
    if (s.isClass && s.classRunId && !seenRuns.has(s.classRunId)) {
      seenRuns.add(s.classRunId)
      leaveClassAt.set(s.id, s.classRunId)
    }
  }

  return (
    <>
      <PageHeader title="Sessions" subtitle="Your upcoming & past training" />
      <div className="px-4 pt-5 pb-10 max-w-3xl mx-auto w-full space-y-6">
        {!hasAny && (
          <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-accent-soft flex items-center justify-center"><Calendar className="h-6 w-6 text-accent" /></div>
            <p className="mt-3 text-sm font-semibold text-slate-700">No sessions yet</p>
            <p className="mt-1 text-xs text-slate-400">Once your trainer books a session it will show up here.</p>
          </div>
        )}

        {upcoming.length > 0 && (
          <section>
            <h2 className="font-display text-lg font-bold text-slate-900 mb-2.5">Upcoming</h2>
            <div className="space-y-3">
              {next && (
                <Link href={`/my-sessions/${next.id}`} className="block rounded-3xl p-5 text-white active:scale-[0.99] transition-transform" style={{ background: 'var(--accent)' }}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-medium text-white/75">{formatDateTime(next.scheduledAt)}</p>
                      <h3 className="font-display text-xl font-bold mt-0.5">{titleOf(next)}</h3>
                    </div>
                    <span className="text-[10px] font-semibold bg-white/15 rounded-full px-2 py-1">{next.isClass ? 'Class' : 'Next'}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-white/90">
                    <Clock className="h-4 w-4 opacity-80" /> {next.durationMins} min
                    {next.sessionType === 'IN_PERSON' && next.location && <><span className="opacity-50">·</span><MapPin className="h-4 w-4 opacity-80" /> <span className="truncate">{next.location}</span></>}
                    {next.sessionType === 'VIRTUAL' && <><span className="opacity-50">·</span><Video className="h-4 w-4 opacity-80" /> Virtual</>}
                  </div>
                  {!next.isClass ? (
                    <div className="mt-3 border-t border-white/15 pt-2.5">
                      <span className="[&_button]:!text-white/90 [&_button:hover]:!text-white">
                        <CancelSessionButton sessionId={next.id} title={titleOf(next)} feeCents={feeFor(next.scheduledAt)} currency={currency} />
                      </span>
                    </div>
                  ) : leaveClassAt.has(next.id) ? (
                    <div className="mt-3 border-t border-white/15 pt-2.5">
                      <span className="[&_button]:!text-white/90 [&_button:hover]:!text-white">
                        <LeaveClassButton runId={leaveClassAt.get(next.id)!} className={titleOf(next)} feeCents={feeFor(next.scheduledAt)} currency={currency} />
                      </span>
                    </div>
                  ) : null}
                </Link>
              )}
              {restUpcoming.length > 0 && (
                <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
                  {restUpcoming.map((s, i) => (
                    <Link key={s.id} href={`/my-sessions/${s.id}`} className={`flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                      <DateChip date={s.scheduledAt} tone="accent" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate flex items-center gap-1.5">
                          {s.isClass && <Users className="h-3.5 w-3.5 text-teal-500 flex-shrink-0" />}{titleOf(s)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(s.scheduledAt)} · {s.durationMins} min</p>
                      </div>
                      {!s.isClass ? (
                        <CancelSessionButton sessionId={s.id} title={titleOf(s)} feeCents={feeFor(s.scheduledAt)} currency={currency} />
                      ) : leaveClassAt.has(s.id) ? (
                        <LeaveClassButton runId={leaveClassAt.get(s.id)!} className={titleOf(s)} feeCents={feeFor(s.scheduledAt)} currency={currency} />
                      ) : null}
                      <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {past.length > 0 && (
          <section>
            <h2 className="font-display text-lg font-bold text-slate-900 mb-2.5">Past</h2>
            <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
              {past.map((s, i) => {
                const done = DONE.includes(s.status)
                return (
                  <Link key={s.id} href={`/my-sessions/${s.id}`} className={`flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                    <DateChip date={s.scheduledAt} tone="slate" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate flex items-center gap-1.5">
                        {s.isClass && <Users className="h-3.5 w-3.5 text-teal-500 flex-shrink-0" />}{titleOf(s)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(s.scheduledAt)} · {s.durationMins} min</p>
                    </div>
                    {done && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-wide">Done</span>}
                    <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                  </Link>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </>
  )
}

function DateChip({ date, tone }: { date: Date; tone: 'accent' | 'slate' }) {
  return (
    <div className={`flex h-10 w-10 flex-col items-center justify-center rounded-xl flex-shrink-0 ${tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-slate-100 text-slate-500'}`}>
      <span className="text-[10px] font-semibold uppercase leading-none">{date.toLocaleDateString('en-NZ', { month: 'short' })}</span>
      <span className="text-sm font-bold leading-tight">{date.getDate()}</span>
    </div>
  )
}
