import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Calendar, Clock, MapPin, Video, ChevronRight } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Sessions' }

function formatDateTime(d: Date) {
  return d.toLocaleString('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default async function MySessionsPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const now = new Date()
  const [upcoming, past] = await Promise.all([
    prisma.trainingSession.findMany({
      where: { clientId: active.clientId, scheduledAt: { gte: now }, status: 'UPCOMING' },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        durationMins: true,
        sessionType: true,
        location: true,
      },
    }),
    prisma.trainingSession.findMany({
      where: {
        clientId: active.clientId,
        OR: [
          { scheduledAt: { lt: now } },
          { status: { in: ['COMPLETED', 'COMMENTED', 'INVOICED'] } },
        ],
      },
      orderBy: { scheduledAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        durationMins: true,
        sessionType: true,
        status: true,
      },
    }),
  ])

  const hasAny = upcoming.length > 0 || past.length > 0

  return (
    <div className="px-5 lg:px-8 pt-6 pb-10 max-w-3xl mx-auto w-full">
      <h1 className="text-2xl font-bold text-slate-900">Sessions</h1>
      <p className="text-sm text-slate-500 mt-1">Your upcoming and past training sessions.</p>

      {!hasAny && (
        <div className="mt-10 flex flex-col items-center justify-center text-center">
          <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Calendar className="h-7 w-7 text-slate-400" />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-600">No sessions yet</p>
          <p className="mt-1 text-xs text-slate-400 max-w-xs">
            Once your trainer books a session it will show up here.
          </p>
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Upcoming</h2>
          <div className="rounded-2xl bg-white border border-slate-100 overflow-hidden">
            {upcoming.map((s, i) => (
              <Link
                key={s.id}
                href={`/my-sessions/${s.id}`}
                className={`flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors ${i > 0 ? 'border-t border-slate-100' : ''}`}
              >
                <div className="flex h-10 w-10 flex-col items-center justify-center rounded-xl bg-blue-50 text-blue-700 flex-shrink-0">
                  <span className="text-[10px] font-semibold uppercase leading-none">
                    {s.scheduledAt.toLocaleDateString('en-NZ', { month: 'short' })}
                  </span>
                  <span className="text-sm font-bold leading-tight">
                    {s.scheduledAt.getDate()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{s.title}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDateTime(s.scheduledAt)} · {s.durationMins} min
                    </span>
                  </div>
                  {s.sessionType === 'IN_PERSON' && s.location && (
                    <p className="mt-0.5 text-xs text-slate-400 truncate flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {s.location}
                    </p>
                  )}
                  {s.sessionType === 'VIRTUAL' && (
                    <p className="mt-0.5 text-xs text-slate-400 flex items-center gap-1">
                      <Video className="h-3 w-3" /> Virtual session
                    </p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Past</h2>
          <div className="rounded-2xl bg-white border border-slate-100 overflow-hidden">
            {past.map((s, i) => {
              const done = s.status === 'COMPLETED' || s.status === 'COMMENTED' || s.status === 'INVOICED'
              return (
                <Link
                  key={s.id}
                  href={`/my-sessions/${s.id}`}
                  className={`flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors ${i > 0 ? 'border-t border-slate-100' : ''}`}
                >
                  <div className="flex h-10 w-10 flex-col items-center justify-center rounded-xl bg-slate-100 text-slate-500 flex-shrink-0">
                    <span className="text-[10px] font-semibold uppercase leading-none">
                      {s.scheduledAt.toLocaleDateString('en-NZ', { month: 'short' })}
                    </span>
                    <span className="text-sm font-bold leading-tight">
                      {s.scheduledAt.getDate()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{s.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDateTime(s.scheduledAt)} · {s.durationMins} min
                    </p>
                  </div>
                  {done && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-wide">
                      Done
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
