'use client'

import { useEffect, useState } from 'react'
import {
  X, Loader2, Users, Calendar, Clock, Video, MapPin,
  UserPlus, TrendingUp, Sparkles, Package as PackageIcon, ListChecks,
} from 'lucide-react'

interface Bucket {
  value: string
  sessions: number
  revenueCents: number
}

interface ReportData {
  weekStart: string
  weekEnd: string
  timezone: string
  totals: {
    sessions: number
    upcoming: number
    completed: number
    uniqueClients: number
    uniqueDogs: number
    revenueCents: number
    hoursScheduled: number
    avgDurationMins: number
    inPerson: number
    virtual: number
    buddyCount: number
    byStatus: { UPCOMING: number; COMPLETED: number; COMMENTED: number; INVOICED: number }
  }
  byPackage: { name: string; sessions: number; revenueCents: number }[]
  topClients: { id: string; name: string; sessions: number; revenueCents: number }[]
  customBreakdowns: {
    id: string
    label: string
    type: string
    appliesTo: string
    category: string | null
    buckets: Bucket[]
  }[]
}

function fmtMoney(cents: number, opts?: { compact?: boolean }): string {
  const dollars = cents / 100
  if (opts?.compact && dollars >= 1000) {
    return `$${(dollars / 1000).toLocaleString('en-NZ', { maximumFractionDigits: 1 })}k`
  }
  return `$${dollars.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtRange(weekStart: string, weekEnd: string, tz: string): string {
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  }
  const a = parse(weekStart).toLocaleDateString('en-NZ', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })
  const b = parse(weekEnd).toLocaleDateString('en-NZ', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })
  return `${a} – ${b}`
}

export function ScheduleReport({ weekStart, onClose }: { weekStart: string; onClose: () => void }) {
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    fetch(`/api/schedule/report?weekStart=${encodeURIComponent(weekStart)}`, { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`)
        return r.json()
      })
      .then((json: ReportData) => { if (!cancelled) { setData(json); setLoading(false) } })
      .catch(e => {
        if (cancelled || ctrl.signal.aborted) return
        setError(e?.message ?? 'Failed to load report')
        setLoading(false)
      })
    return () => { cancelled = true; ctrl.abort() }
  }, [weekStart])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" />
      <div
        className="relative z-50 bg-slate-50 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Compact header */}
        <div className="relative flex items-center justify-between gap-3 px-5 py-4 bg-white border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm shadow-violet-200">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 leading-tight">Weekly report</h2>
              <p className="text-[11px] text-slate-500 truncate">
                {data ? fmtRange(data.weekStart, data.weekEnd, data.timezone) : 'Crunching numbers…'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close report"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-xs">Pulling in this week&apos;s numbers…</p>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">
              {error}
            </div>
          )}

          {data && !loading && <ReportBody data={data} />}
        </div>
      </div>
    </div>
  )
}

// Trainer's effective take-home after platform / processing share. Tweak this
// constant (or thread it through TrainerProfile later) if the cut changes.
const TAKE_HOME_RATE = 0.8

function RevenueBanner({ total }: { total: ReportData['totals'] }) {
  const takeHomeCents = Math.round(total.revenueCents * TAKE_HOME_RATE)
  return (
    <div className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-white via-indigo-50/60 to-violet-50/60 shadow-sm">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-indigo-200/60 to-violet-200/60 blur-2xl" aria-hidden />
      <div className="relative grid grid-cols-2 gap-3 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">Revenue</p>
          <p className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums leading-none">
            {fmtMoney(total.revenueCents)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">across {total.sessions} session{total.sessions === 1 ? '' : 's'}</p>
        </div>
        <div className="rounded-xl bg-white/70 ring-1 ring-indigo-100 backdrop-blur px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Take-home</p>
            <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 rounded-full px-1.5 py-0.5">
              {Math.round(TAKE_HOME_RATE * 100)}%
            </span>
          </div>
          <p className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums leading-none">
            {fmtMoney(takeHomeCents)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">after costs</p>
        </div>
      </div>
    </div>
  )
}

function ReportBody({ data }: { data: ReportData }) {
  const t = data.totals

  if (t.sessions === 0) {
    return (
      <div className="text-center py-16">
        <div className="h-16 w-16 rounded-3xl bg-slate-100 flex items-center justify-center mx-auto">
          <Calendar className="h-7 w-7 text-slate-400" />
        </div>
        <p className="mt-4 text-sm font-semibold text-slate-700">A quiet week</p>
        <p className="mt-1 text-xs text-slate-400 max-w-xs mx-auto">
          No sessions on the calendar yet. Stats will populate as bookings land in this week.
        </p>
      </div>
    )
  }

  const completionPct = t.sessions > 0 ? Math.round((t.completed / t.sessions) * 100) : 0
  const inPersonPct = t.sessions > 0 ? Math.round((t.inPerson / t.sessions) * 100) : 0

  return (
    <>
      <RevenueBanner total={t} />

      {/* Quick stats row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          tone="emerald"
          icon={<Users className="h-4 w-4" />}
          label="Clients"
          value={t.uniqueClients}
          sub={`${t.uniqueDogs} dog${t.uniqueDogs === 1 ? '' : 's'} on calendar`}
        />
        <Stat
          tone="sky"
          icon={<Calendar className="h-4 w-4" />}
          label="Sessions"
          value={t.sessions}
          sub={`${t.upcoming} upcoming · ${t.completed} done`}
        />
        <Stat
          tone="amber"
          icon={<Clock className="h-4 w-4" />}
          label="Avg duration"
          value={`${t.avgDurationMins}m`}
          sub={`${t.hoursScheduled} hrs total`}
        />
        <Stat
          tone="violet"
          icon={<TrendingUp className="h-4 w-4" />}
          label="Completion"
          value={`${completionPct}%`}
          sub={`${t.completed} of ${t.sessions} done`}
        />
      </section>

      {/* Mode of delivery + extras */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Delivery mix</p>
            <span className="text-[10px] text-slate-400">{inPersonPct}% in-person</span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden bg-slate-100 flex">
            <div
              className="bg-gradient-to-r from-emerald-400 to-emerald-500"
              style={{ width: `${inPersonPct}%` }}
            />
            <div
              className="bg-gradient-to-r from-sky-400 to-sky-500"
              style={{ width: `${100 - inPersonPct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <MapPin className="h-3 w-3" /> {t.inPerson} in-person
            </span>
            <span className="inline-flex items-center gap-1.5 text-sky-700">
              <Video className="h-3 w-3" /> {t.virtual} virtual
              <span className="h-2 w-2 rounded-full bg-sky-500" />
            </span>
          </div>
        </Card>

        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">This week, also</p>
          <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-sm">
            <Pulse label="Upcoming" value={t.upcoming} accent="indigo" />
            <Pulse label="Buddies" value={t.buddyCount} icon={<UserPlus className="h-3 w-3" />} accent="rose" />
            <Pulse label="Commented" value={t.byStatus.COMMENTED} accent="emerald" />
            <Pulse label="Invoiced" value={t.byStatus.INVOICED} accent="amber" />
          </div>
        </Card>
      </section>

      {data.byPackage.length > 0 && (
        <BreakdownCard
          title="By package"
          icon={<PackageIcon className="h-4 w-4" />}
          accent="indigo"
          rows={data.byPackage.map(p => ({ label: p.name, sessions: p.sessions, revenueCents: p.revenueCents }))}
        />
      )}

      {data.topClients.length > 0 && (
        <BreakdownCard
          title="Top clients"
          icon={<Users className="h-4 w-4" />}
          accent="emerald"
          rows={data.topClients.map(c => ({ label: c.name, sessions: c.sessions, revenueCents: c.revenueCents }))}
        />
      )}

      {data.customBreakdowns.map((field, idx) => (
        <BreakdownCard
          key={field.id}
          title={field.label}
          subtitle={field.appliesTo === 'DOG' ? 'Dog field' : 'Owner field'}
          icon={<ListChecks className="h-4 w-4" />}
          accent={CYCLE_ACCENTS[idx % CYCLE_ACCENTS.length]}
          rows={field.buckets.map(b => ({ label: b.value || '—', sessions: b.sessions, revenueCents: b.revenueCents }))}
        />
      ))}
    </>
  )
}

const CYCLE_ACCENTS = ['violet', 'amber', 'sky', 'rose', 'teal'] as const
type Accent = 'emerald' | 'amber' | 'sky' | 'violet' | 'indigo' | 'rose' | 'teal'

const TONE: Record<Accent, { ring: string; bgChip: string; text: string; bar: string; barTrack: string }> = {
  emerald: { ring: 'ring-emerald-100', bgChip: 'bg-emerald-50 text-emerald-600', text: 'text-emerald-700', bar: 'bg-gradient-to-r from-emerald-400 to-emerald-500', barTrack: 'bg-emerald-50' },
  amber:   { ring: 'ring-amber-100',   bgChip: 'bg-amber-50 text-amber-600',     text: 'text-amber-700',   bar: 'bg-gradient-to-r from-amber-400 to-amber-500',     barTrack: 'bg-amber-50' },
  sky:     { ring: 'ring-sky-100',     bgChip: 'bg-sky-50 text-sky-600',         text: 'text-sky-700',     bar: 'bg-gradient-to-r from-sky-400 to-sky-500',         barTrack: 'bg-sky-50' },
  violet:  { ring: 'ring-violet-100',  bgChip: 'bg-violet-50 text-violet-600',   text: 'text-violet-700',  bar: 'bg-gradient-to-r from-violet-400 to-violet-500',   barTrack: 'bg-violet-50' },
  indigo:  { ring: 'ring-indigo-100',  bgChip: 'bg-indigo-50 text-indigo-600',   text: 'text-indigo-700',  bar: 'bg-gradient-to-r from-indigo-400 to-indigo-500',   barTrack: 'bg-indigo-50' },
  rose:    { ring: 'ring-rose-100',    bgChip: 'bg-rose-50 text-rose-600',       text: 'text-rose-700',    bar: 'bg-gradient-to-r from-rose-400 to-rose-500',       barTrack: 'bg-rose-50' },
  teal:    { ring: 'ring-teal-100',    bgChip: 'bg-teal-50 text-teal-600',       text: 'text-teal-700',    bar: 'bg-gradient-to-r from-teal-400 to-teal-500',       barTrack: 'bg-teal-50' },
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white border border-slate-100 shadow-sm p-4 ${className}`}>
      {children}
    </div>
  )
}

function Stat({
  tone, icon, label, value, sub,
}: {
  tone: Accent
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
}) {
  const t = TONE[tone]
  return (
    <div className={`relative rounded-2xl bg-white border border-slate-100 shadow-sm p-3.5 ring-1 ${t.ring}`}>
      <div className={`inline-flex items-center justify-center h-8 w-8 rounded-xl ${t.bgChip}`}>
        {icon}
      </div>
      <p className="mt-2.5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className="text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums leading-none mt-1">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

function Pulse({
  label, value, accent, icon,
}: {
  label: string
  value: number
  accent: Accent
  icon?: React.ReactNode
}) {
  const t = TONE[accent]
  return (
    <div className="flex items-center justify-between">
      <span className="inline-flex items-center gap-1.5 text-slate-500 text-xs">
        <span className={`h-1.5 w-1.5 rounded-full ${t.bar}`} />
        {icon}
        {label}
      </span>
      <span className="font-bold text-slate-900 tabular-nums">{value}</span>
    </div>
  )
}

function BreakdownCard({
  title, subtitle, icon, accent, rows,
}: {
  title: string
  subtitle?: string
  icon: React.ReactNode
  accent: Accent
  rows: { label: string; sessions: number; revenueCents: number }[]
}) {
  if (rows.length === 0) return null
  const totalRev = rows.reduce((acc, r) => acc + r.revenueCents, 0)
  const totalSessions = rows.reduce((acc, r) => acc + r.sessions, 0)
  const showRevenue = totalRev > 0
  const denominator = showRevenue ? totalRev : totalSessions
  const t = TONE[accent]

  return (
    <section>
      <div className="flex items-center gap-2 mb-2.5">
        <div className={`inline-flex items-center justify-center h-7 w-7 rounded-lg ${t.bgChip}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 leading-none">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <span className="text-[11px] text-slate-400">
          {showRevenue ? fmtMoney(totalRev, { compact: true }) : `${totalSessions} session${totalSessions === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
        <ul className="divide-y divide-slate-50">
          {rows.map((r, i) => {
            const value = showRevenue ? r.revenueCents : r.sessions
            const pct = denominator > 0 ? Math.max(2, Math.round((value / denominator) * 100)) : 0
            return (
              <li key={i} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-slate-800 truncate">{r.label}</p>
                  <div className="flex items-baseline gap-2 shrink-0">
                    {showRevenue && (
                      <span className="text-sm font-semibold text-slate-900 tabular-nums">
                        {fmtMoney(r.revenueCents, { compact: true })}
                      </span>
                    )}
                    <span className={`text-xs font-medium ${showRevenue ? 'text-slate-400' : t.text} tabular-nums`}>
                      {r.sessions} session{r.sessions === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                <div className={`mt-2 h-1.5 rounded-full ${t.barTrack} overflow-hidden`}>
                  <div className={`h-full rounded-full ${t.bar} transition-all`} style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
