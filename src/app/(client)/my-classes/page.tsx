import { redirect } from 'next/navigation'
import { GraduationCap, CheckCircle2, XCircle, Clock, Star } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Classes' }

const ATT_LABEL: Record<string, { text: string; cls: string }> = {
  PRESENT: { text: 'Present', cls: 'text-emerald-700 bg-emerald-50' },
  ABSENT: { text: 'Absent', cls: 'text-red-600 bg-red-50' },
  LATE: { text: 'Late', cls: 'text-amber-700 bg-amber-50' },
  EXCUSED: { text: 'Excused', cls: 'text-slate-600 bg-slate-100' },
  MAKEUP: { text: 'Make-up', cls: 'text-blue-700 bg-blue-50' },
}

export default async function MyClassesPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const enrollments = await prisma.classEnrollment.findMany({
    where: { clientId: active.clientId, status: { in: ['ENROLLED', 'WAITLISTED', 'COMPLETED'] } },
    orderBy: { enrolledAt: 'desc' },
    include: {
      classRun: {
        include: {
          package: { select: { name: true } },
          sessions: {
            orderBy: { sessionIndex: 'asc' },
            select: { id: true, title: true, scheduledAt: true, sessionIndex: true },
          },
        },
      },
      attendance: {
        select: { sessionId: true, status: true, note: true, scores: true },
      },
    },
  })

  return (
    <div className="px-5 lg:px-8 pt-6 pb-10 max-w-3xl mx-auto w-full">
      <h1 className="text-2xl font-bold text-slate-900">Classes</h1>
      <p className="text-sm text-slate-500 mt-1">Group classes you&apos;re enrolled in, and how each session went.</p>

      {enrollments.length === 0 && (
        <div className="mt-10 flex flex-col items-center justify-center text-center">
          <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center">
            <GraduationCap className="h-7 w-7 text-slate-400" />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-600">No classes yet</p>
          <p className="mt-1 text-xs text-slate-400 max-w-xs">
            When your trainer enrols you in a group class it will show up here.
          </p>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-5">
        {enrollments.map(e => {
          const bySession = new Map(e.attendance.map(a => [a.sessionId, a]))
          const waitlisted = e.status === 'WAITLISTED'
          return (
            <section key={e.id} className="rounded-2xl bg-white border border-slate-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{e.classRun.name}</p>
                  <p className="text-xs text-slate-500">
                    {e.classRun.package.name}
                    {e.classRun.scheduleNote ? ` · ${e.classRun.scheduleNote}` : ''}
                  </p>
                </div>
                {waitlisted ? (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">
                    Waitlisted{e.waitlistPosition ? ` · #${e.waitlistPosition}` : ''}
                  </span>
                ) : e.type === 'DROP_IN' ? (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full flex-shrink-0">
                    Drop-in
                  </span>
                ) : null}
              </div>

              {waitlisted ? (
                <p className="px-4 py-4 text-xs text-slate-500">
                  You&apos;re on the waitlist. We&apos;ll let you know if a spot opens up.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {e.classRun.sessions.map(s => {
                    const att = bySession.get(s.id)
                    const scores = (att?.scores ?? {}) as { rating?: number }
                    const label = att ? ATT_LABEL[att.status] : null
                    const past = new Date(s.scheduledAt).getTime() < Date.now()
                    return (
                      <li key={s.id} className="flex items-start gap-3 px-4 py-3">
                        <div className="flex h-9 w-9 flex-col items-center justify-center rounded-lg bg-slate-100 text-slate-500 flex-shrink-0">
                          <span className="text-[9px] font-semibold uppercase leading-none">
                            {new Date(s.scheduledAt).toLocaleDateString('en-NZ', { month: 'short' })}
                          </span>
                          <span className="text-xs font-bold leading-tight">
                            {new Date(s.scheduledAt).getDate()}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 truncate">{s.title}</p>
                          <p className="text-xs text-slate-500">
                            {new Date(s.scheduledAt).toLocaleString('en-NZ', {
                              weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                            })}
                          </p>
                          {att?.note && <p className="mt-1 text-xs text-slate-600">{att.note}</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          {label ? (
                            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${label.cls}`}>
                              {att!.status === 'PRESENT' ? <CheckCircle2 className="h-3 w-3" /> : att!.status === 'ABSENT' ? <XCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                              {label.text}
                            </span>
                          ) : past ? (
                            <span className="text-[10px] text-slate-400">Not marked</span>
                          ) : (
                            <span className="text-[10px] text-slate-400">Upcoming</span>
                          )}
                          {typeof scores.rating === 'number' && (
                            <span className="text-[10px] font-semibold text-amber-600 inline-flex items-center gap-0.5">
                              <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {scores.rating}/5
                            </span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
