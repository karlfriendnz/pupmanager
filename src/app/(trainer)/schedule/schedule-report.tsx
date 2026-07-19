'use client'

import { useEffect, useState } from 'react'
import {
  X, Loader2, Users, Calendar, Clock, Video, MapPin, ChevronLeft, ChevronRight,
  UserPlus, TrendingUp, Sparkles, Package as PackageIcon, ListChecks, CalendarRange, BarChart2, Trophy,
  UsersRound, ShoppingBag,
} from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { formatMoney, currencySymbol } from '@/lib/money'

// Trainer's effective take-home after platform / processing share. Tweak this
// constant (or thread it through TrainerProfile later) if the cut changes.
const TAKE_HOME_RATE = 0.8

// ─── Shared types ────────────────────────────────────────────────────────────

interface Bucket {
  value: string
  sessions: number
  revenueCents: number
}

type StatusCounts = { UPCOMING: number; COMPLETED: number; COMMENTED: number; INVOICED: number }

interface CommonTotals {
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
  byStatus: StatusCounts
}

interface WeeklyData {
  weekStart: string
  weekEnd: string
  timezone: string
  totals: CommonTotals
  byPackage: { name: string; sessions: number; revenueCents: number }[]
  byClass: { name: string; sessions: number; revenueCents: number }[]
  byProduct: { name: string; count: number; totalCents: number }[]
  topClients: { id: string; name: string; sessions: number; revenueCents: number }[]
  customBreakdowns: {
    id: string
    label: string
    type: string
    appliesTo: string
    buckets: Bucket[]
  }[]
}

interface AnnualData {
  year: number
  timezone: string
  totals: CommonTotals & {
    avgRevenuePerMonthCents: number
    bestMonthLabel: string
    bestMonthRevenueCents: number
  }
  byMonth: { month: number; label: string; sessions: number; revenueCents: number; uniqueClients: number }[]
  byPackage: { name: string; sessions: number; revenueCents: number }[]
  byClass: { name: string; sessions: number; revenueCents: number }[]
  byProduct: { name: string; count: number; totalCents: number }[]
  topClients: { id: string; name: string; sessions: number; revenueCents: number }[]
  customBreakdowns: {
    id: string
    label: string
    type: string
    appliesTo: string
    buckets: Bucket[]
  }[]
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmtMoney(cents: number, currency: string, opts?: { compact?: boolean }): string {
  const sym = currencySymbol(currency)
  const dollars = cents / 100
  if (opts?.compact && dollars >= 1000) {
    return `${sym}${(dollars / 1000).toLocaleString('en-NZ', { maximumFractionDigits: 1 })}k`
  }
  return formatMoney(cents, currency)
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

// ─── Modal shell ─────────────────────────────────────────────────────────────

type ReportTab = 'weekly' | 'annual'

export function ScheduleReport({ weekStart, onClose }: { weekStart: string; onClose: () => void }) {
  const [tab, setTab] = useState<ReportTab>('weekly')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" />
      <div
        className="relative z-50 bg-slate-50 rounded-3xl shadow-2xl w-full max-w-4xl h-[92dvh] md:max-h-[92vh] md:h-auto overflow-hidden flex flex-col md:flex-row"
        onClick={e => e.stopPropagation()}
      >
        {/* Sidebar (md+) / horizontal tabs (sm) */}
        <aside className="md:w-44 md:shrink-0 md:border-r border-slate-100 bg-white flex md:flex-col">
          <div className="hidden md:flex items-center gap-2 px-4 pt-5 pb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm shadow-violet-200">
              <Sparkles className="h-4 w-4" />
            </div>
            <p className="text-sm font-semibold text-slate-900">Reports</p>
          </div>
          <nav className="flex md:flex-col flex-1 md:px-2 md:pb-4 px-2 py-2 gap-1">
            <SideTab
              active={tab === 'weekly'}
              onClick={() => setTab('weekly')}
              icon={<CalendarRange className="h-4 w-4" />}
              label="Weekly"
              hint="This selected week"
            />
            <SideTab
              active={tab === 'annual'}
              onClick={() => setTab('annual')}
              icon={<BarChart2 className="h-4 w-4" />}
              label="Annual"
              hint="Calendar year"
            />
          </nav>
          <div className="hidden md:block px-4 pb-4 mt-auto">
            <p className="text-[10px] text-slate-400 leading-snug">
              Take-home shown at {Math.round(TAKE_HOME_RATE * 100)}% of revenue.
            </p>
          </div>
        </aside>

        {/* Body — `min-h-0` is required so flex-1 child can shrink and let
            its inner overflow-y-auto actually scroll instead of pushing
            the modal's height. */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex items-center justify-between gap-3 px-5 py-3 bg-white border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-900">
              {tab === 'weekly' ? 'Weekly report' : 'Annual report'}
            </p>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              aria-label="Close report"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {tab === 'weekly' && <WeeklyView weekStart={weekStart} />}
            {tab === 'annual' && <AnnualView />}
          </div>
        </div>
      </div>
    </div>
  )
}

function SideTab({
  active, onClick, icon, label, hint,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  hint?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all ${
        active
          ? 'bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm shadow-violet-200/60'
          : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${active ? 'bg-white/15' : 'bg-slate-100 text-slate-500'}`}>
        {icon}
      </span>
      <span className="flex flex-col min-w-0">
        <span className={`text-sm font-semibold leading-tight ${active ? 'text-white' : 'text-slate-900'}`}>{label}</span>
        {hint && (
          <span className={`text-[10px] truncate ${active ? 'text-white/70' : 'text-slate-400'}`}>{hint}</span>
        )}
      </span>
    </button>
  )
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

function useFetch<T>(url: string, deps: unknown[] = []): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    setLoading(true)
    setData(null)
    setError(null)
    fetch(url, { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`)
        return r.json()
      })
      .then((json: T) => { if (!cancelled) { setData(json); setLoading(false) } })
      .catch(e => {
        if (cancelled || ctrl.signal.aborted) return
        setError(e?.message ?? 'Failed to load report')
        setLoading(false)
      })
    return () => { cancelled = true; ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, loading, error }
}

function LoaderBlock({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
      <Loader2 className="h-5 w-5 animate-spin" />
      <p className="text-xs">{label}</p>
    </div>
  )
}

function ErrorBlock({ msg }: { msg: string }) {
  return (
    <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">
      {msg}
    </div>
  )
}

// ─── Weekly view ─────────────────────────────────────────────────────────────

function WeeklyView({ weekStart }: { weekStart: string }) {
  const { data, loading, error } = useFetch<WeeklyData>(
    `/api/schedule/report?weekStart=${encodeURIComponent(weekStart)}`,
    [weekStart],
  )

  if (loading) return <LoaderBlock label="Pulling in this week's numbers…" />
  if (error) return <ErrorBlock msg={error} />
  if (!data) return null

  const t = data.totals

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">
        {fmtRange(data.weekStart, data.weekEnd, data.timezone)}
      </p>

      {t.sessions === 0 ? (
        <EmptyState
          title="A quiet week"
          body="No sessions on the calendar yet. Stats will populate as bookings land in this week."
        />
      ) : (
        <>
          <RevenueBanner total={t} subline={`across ${t.sessions} session${t.sessions === 1 ? '' : 's'}`} />
          <CoreStats total={t} />
          <DeliveryAndExtras total={t} />
          <BreakdownsSection
            byPackage={data.byPackage}
            byClass={data.byClass}
            byProduct={data.byProduct}
            topClients={data.topClients}
            customBreakdowns={data.customBreakdowns}
          />
        </>
      )}
    </div>
  )
}

// ─── Annual view ─────────────────────────────────────────────────────────────

function AnnualView() {
  const currency = useCurrency()
  const [year, setYear] = useState(new Date().getFullYear())
  const { data, loading, error } = useFetch<AnnualData>(`/api/schedule/report/annual?year=${year}`, [year])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setYear(y => y - 1)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Previous year"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-xl font-bold text-slate-900 tabular-nums px-2">{year}</p>
          <button
            onClick={() => setYear(y => y + 1)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Next year"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {data && data.totals.bestMonthRevenueCents > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2.5 py-1">
            <Trophy className="h-3 w-3" />
            Best month: <span className="font-semibold">{data.totals.bestMonthLabel}</span>
            <span className="text-amber-500">({fmtMoney(data.totals.bestMonthRevenueCents, currency, { compact: true })})</span>
          </div>
        )}
      </div>

      {loading && <LoaderBlock label={`Loading ${year}…`} />}
      {error && <ErrorBlock msg={error} />}

      {data && !loading && (
        data.totals.sessions === 0 ? (
          <EmptyState
            title={`No data for ${year}`}
            body="Sessions in this calendar year will populate stats here."
          />
        ) : (
          <>
            <RevenueBanner
              total={data.totals}
              subline={`across ${data.totals.sessions} session${data.totals.sessions === 1 ? '' : 's'} in ${year}`}
            />
            <CoreStats
              total={data.totals}
              extras={[
                {
                  tone: 'amber',
                  icon: <Trophy className="h-4 w-4" />,
                  label: 'Avg / month',
                  value: fmtMoney(data.totals.avgRevenuePerMonthCents, currency, { compact: true }),
                  sub: 'months with sessions',
                },
              ]}
            />
            <MonthlyChart byMonth={data.byMonth} />
            <DeliveryAndExtras total={data.totals} />
            <BreakdownsSection
              byPackage={data.byPackage}
              byClass={data.byClass}
              byProduct={data.byProduct}
              topClients={data.topClients}
              customBreakdowns={data.customBreakdowns}
            />
          </>
        )
      )}
    </div>
  )
}

function MonthlyChart({ byMonth }: { byMonth: AnnualData['byMonth'] }) {
  const currency = useCurrency()
  const maxRev = Math.max(1, ...byMonth.map(m => m.revenueCents))
  const totalSessions = byMonth.reduce((acc, m) => acc + m.sessions, 0)
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-900">Monthly breakdown</h3>
        <span className="text-[11px] text-slate-400">{totalSessions} session{totalSessions === 1 ? '' : 's'}</span>
      </div>
      <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4">
        <div className="grid grid-cols-12 gap-1.5 items-end h-32">
          {byMonth.map(m => {
            const h = m.revenueCents > 0 ? Math.max(8, Math.round((m.revenueCents / maxRev) * 100)) : 2
            return (
              <div key={m.month} className="flex flex-col items-center gap-1 group">
                <div className="relative w-full flex items-end justify-center" style={{ height: '100%' }}>
                  <div
                    className={`w-full rounded-t-md transition-colors ${
                      m.revenueCents > 0
                        ? 'bg-gradient-to-t from-indigo-400 to-violet-400 group-hover:from-indigo-500 group-hover:to-violet-500'
                        : 'bg-slate-100'
                    }`}
                    style={{ height: `${h}%` }}
                    title={`${m.label}: ${fmtMoney(m.revenueCents, currency)} · ${m.sessions} session${m.sessions === 1 ? '' : 's'}`}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div className="grid grid-cols-12 gap-1.5 mt-2">
          {byMonth.map(m => (
            <p key={m.month} className="text-center text-[10px] text-slate-400">{m.label}</p>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Shared blocks ───────────────────────────────────────────────────────────

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center py-16">
      <div className="h-16 w-16 rounded-3xl bg-slate-100 flex items-center justify-center mx-auto">
        <Calendar className="h-7 w-7 text-slate-400" />
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-xs text-slate-400 max-w-xs mx-auto">{body}</p>
    </div>
  )
}

function RevenueBanner({ total, subline }: { total: CommonTotals; subline: string }) {
  const currency = useCurrency()
  const takeHomeCents = Math.round(total.revenueCents * TAKE_HOME_RATE)
  return (
    <div className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-white via-indigo-50/60 to-violet-50/60 shadow-sm">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-indigo-200/60 to-violet-200/60 blur-2xl" aria-hidden />
      <div className="relative grid grid-cols-2 gap-3 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">Revenue</p>
          <p className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums leading-none">
            {fmtMoney(total.revenueCents, currency)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">{subline}</p>
        </div>
        <div className="rounded-xl bg-white/70 ring-1 ring-indigo-100 backdrop-blur px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Take-home</p>
            <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 rounded-full px-1.5 py-0.5">
              {Math.round(TAKE_HOME_RATE * 100)}%
            </span>
          </div>
          <p className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums leading-none">
            {fmtMoney(takeHomeCents, currency)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">after costs</p>
        </div>
      </div>
    </div>
  )
}

function CoreStats({
  total,
  extras = [],
}: {
  total: CommonTotals
  extras?: { tone: Accent; icon: React.ReactNode; label: string; value: string | number; sub?: string }[]
}) {
  const completionPct = total.sessions > 0 ? Math.round((total.completed / total.sessions) * 100) : 0
  const baseStats = [
    { tone: 'emerald' as const, icon: <Users className="h-4 w-4" />, label: 'Clients', value: total.uniqueClients, sub: `${total.uniqueDogs} dog${total.uniqueDogs === 1 ? '' : 's'} on calendar` },
    { tone: 'sky' as const, icon: <Calendar className="h-4 w-4" />, label: 'Sessions', value: total.sessions, sub: `${total.upcoming} upcoming · ${total.completed} done` },
    { tone: 'amber' as const, icon: <Clock className="h-4 w-4" />, label: 'Avg duration', value: `${total.avgDurationMins}m`, sub: `${total.hoursScheduled} hrs total` },
    { tone: 'violet' as const, icon: <TrendingUp className="h-4 w-4" />, label: 'Completion', value: `${completionPct}%`, sub: `${total.completed} of ${total.sessions} done` },
    ...extras,
  ]
  return (
    <section className={`grid gap-3 ${baseStats.length > 4 ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'}`}>
      {baseStats.map((s, i) => (
        <Stat key={i} {...s} />
      ))}
    </section>
  )
}

function DeliveryAndExtras({ total }: { total: CommonTotals }) {
  const inPersonPct = total.sessions > 0 ? Math.round((total.inPerson / total.sessions) * 100) : 0
  return (
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
            <MapPin className="h-3 w-3" /> {total.inPerson} in-person
          </span>
          <span className="inline-flex items-center gap-1.5 text-sky-700">
            <Video className="h-3 w-3" /> {total.virtual} virtual
            <span className="h-2 w-2 rounded-full bg-sky-500" />
          </span>
        </div>
      </Card>

      <Card>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Also of note</p>
        <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-sm">
          <Pulse label="Upcoming" value={total.upcoming} accent="indigo" />
          <Pulse label="Group walkers" value={total.buddyCount} icon={<UserPlus className="h-3 w-3" />} accent="rose" />
          <Pulse label="Commented" value={total.byStatus.COMMENTED} accent="emerald" />
          <Pulse label="Invoiced" value={total.byStatus.INVOICED} accent="amber" />
        </div>
      </Card>
    </section>
  )
}

function BreakdownsSection({
  byPackage,
  byClass,
  byProduct,
  topClients,
  customBreakdowns,
}: {
  byPackage: { name: string; sessions: number; revenueCents: number }[]
  byClass: { name: string; sessions: number; revenueCents: number }[]
  byProduct: { name: string; count: number; totalCents: number }[]
  topClients: { id: string; name: string; sessions: number; revenueCents: number }[]
  customBreakdowns: { id: string; label: string; appliesTo: string; buckets: Bucket[] }[]
}) {
  return (
    <>
      {/* What's selling — sales breakdowns. Always shown so a trainer can see
          which channels are (or aren't) earning, with a per-section empty state. */}
      <BreakdownCard
        title="Sales by package"
        icon={<PackageIcon className="h-4 w-4" />}
        accent="indigo"
        emptyHint="No 1:1 package sessions in this period."
        rows={byPackage.map(p => ({ label: p.name, sessions: p.sessions, revenueCents: p.revenueCents }))}
      />

      <BreakdownCard
        title="Sales by class"
        subtitle="Group classes"
        icon={<UsersRound className="h-4 w-4" />}
        accent="teal"
        emptyHint="No group-class sessions in this period."
        rows={byClass.map(c => ({ label: c.name, sessions: c.sessions, revenueCents: c.revenueCents }))}
      />

      <BreakdownCard
        title="Sales by product"
        subtitle="Paid product purchases"
        icon={<ShoppingBag className="h-4 w-4" />}
        accent="rose"
        countNoun="sold"
        emptyHint="No product sales recorded in this period."
        rows={byProduct.map(p => ({ label: p.name, sessions: p.count, revenueCents: p.totalCents }))}
      />

      {topClients.length > 0 && (
        <BreakdownCard
          title="Top clients"
          icon={<Users className="h-4 w-4" />}
          accent="emerald"
          rows={topClients.map(c => ({ label: c.name, sessions: c.sessions, revenueCents: c.revenueCents }))}
        />
      )}

      {customBreakdowns.map((field, idx) => (
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

// ─── Tone palette ────────────────────────────────────────────────────────────

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
  title, subtitle, icon, accent, rows, emptyHint, countNoun = 'session',
}: {
  title: string
  subtitle?: string
  icon: React.ReactNode
  accent: Accent
  rows: { label: string; sessions: number; revenueCents: number }[]
  // When provided, an empty `rows` renders this hint instead of hiding the card —
  // used for the sales sections so trainers always see the channel.
  emptyHint?: string
  // Noun for the per-row count ("session" → "3 sessions"; "sold" → "3 sold").
  countNoun?: string
}) {
  const currency = useCurrency()
  const t = TONE[accent]
  const totalRev = rows.reduce((acc, r) => acc + r.revenueCents, 0)
  const totalCount = rows.reduce((acc, r) => acc + r.sessions, 0)
  const showRevenue = totalRev > 0
  const denominator = showRevenue ? totalRev : totalCount
  const fmtCount = (n: number) =>
    countNoun === 'sold' ? `${n} sold` : `${n} ${countNoun}${n === 1 ? '' : 's'}`

  const Header = (
    <div className="flex items-center gap-2 mb-2.5">
      <div className={`inline-flex items-center justify-center h-7 w-7 rounded-lg ${t.bgChip}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-slate-900 leading-none">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {rows.length > 0 && (
        <span className="text-[11px] text-slate-400">
          {showRevenue ? fmtMoney(totalRev, currency, { compact: true }) : fmtCount(totalCount)}
        </span>
      )}
    </div>
  )

  if (rows.length === 0) {
    if (!emptyHint) return null
    return (
      <section>
        {Header}
        <div className="rounded-2xl bg-white border border-slate-100 shadow-sm px-4 py-5">
          <p className="text-xs text-slate-400">{emptyHint}</p>
        </div>
      </section>
    )
  }

  return (
    <section>
      {Header}
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
                        {fmtMoney(r.revenueCents, currency, { compact: true })}
                      </span>
                    )}
                    <span className={`text-xs font-medium ${showRevenue ? 'text-slate-400' : t.text} tabular-nums`}>
                      {fmtCount(r.sessions)}
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
