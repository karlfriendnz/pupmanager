'use client'

import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { BarChart, LineChart, DoughnutChart } from '@/components/reports/report-charts'
import {
  Users, PawPrint, CalendarDays, Wallet, Clock, ListChecks, Dog, Activity,
  Table2, X, SlidersHorizontal,
} from 'lucide-react'
// Type-only import — `reports.ts` pulls in Prisma, so importing a runtime value
// from it here would bundle the DB client into the browser. Types are erased.
import type { BusinessReports, CustomFieldReport, ReportFilterField } from '@/lib/reports'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const CURRENCY_SYMBOL: Record<string, string> = { nzd: '$', aud: '$', usd: '$', gbp: '£', eur: '€', cad: '$' }
function money(cents: number, currency: string): string {
  const sym = CURRENCY_SYMBOL[currency.toLowerCase()] ?? '$'
  return `${sym}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

const SESSION_STATUS_LABEL: Record<string, string> = {
  UPCOMING: 'Upcoming', COMPLETED: 'Completed', COMMENTED: 'Commented', INVOICED: 'Invoiced',
}
const SESSION_TYPE_LABEL: Record<string, string> = { IN_PERSON: 'In person', VIRTUAL: 'Virtual' }
const ENQUIRY_STATUS_LABEL: Record<string, string> = {
  NEW: 'New', ACCEPTED: 'Accepted', DECLINED: 'Declined', ARCHIVED: 'Archived',
}

const RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '12m', label: 'Last 12 months' },
  { value: '90d', label: 'Last 90 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'ytd', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
]

type TabId = 'clients' | 'sessions' | 'engagement' | 'revenue' | 'fields'
const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'clients', label: 'Clients & dogs', icon: Users },
  { id: 'sessions', label: 'Sessions', icon: CalendarDays },
  { id: 'engagement', label: 'Engagement', icon: Activity },
  { id: 'revenue', label: 'Revenue', icon: Wallet },
  { id: 'fields', label: 'Custom fields', icon: ListChecks },
]

type Series = { label: string; value: number }[]
type ValueKind = 'count' | 'money' | 'hours'
type ChartKind = 'line' | 'bar' | 'barH' | 'doughnut'

interface Filters {
  member: string
  breed: string
  range: string
  from: string
  to: string
  customFields: Record<string, string>
}

export function ReportsExplorer({
  reports: r, members, breeds, customFields, filters,
}: {
  reports: BusinessReports
  members: { id: string; name: string }[]
  breeds: string[]
  customFields: ReportFilterField[]
  filters: Filters
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<TabId>('clients')

  const cur = r.revenue.currency
  const monthLabels = r.months.map(m => m.label)
  const conversion = r.enquiries.total > 0 ? Math.round((r.enquiries.accepted / r.enquiries.total) * 100) : 0
  const homeworkPct = r.engagement.homeworkTotal > 0
    ? Math.round((r.engagement.homeworkCompleted / r.engagement.homeworkTotal) * 100) : 0

  // Filters live in the URL so the view is shareable + bookmarkable. Updating a
  // param re-runs the server fetch; this client instance persists (so the
  // active tab is kept) and receives fresh `reports`.
  function setParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') params.delete(k)
      else params.set(k, v)
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const seriesFromBuckets = (data: number[]): Series => r.months.map((m, i) => ({ label: m.label, value: data[i] ?? 0 }))
  const cfActive = Object.keys(filters.customFields).length > 0
  const anyFilter = !!(filters.member || filters.breed || cfActive || (filters.range && filters.range !== 'all'))
  const peopleFiltered = !!(filters.member || filters.breed || cfActive)

  return (
    <div className="flex flex-col gap-6">
      {/* ── Filter bar ── */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3 text-slate-500">
          <SlidersHorizontal className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">Filters</span>
          {anyFilter && (
            <button onClick={() => router.push(pathname)} className="ml-auto text-xs font-medium text-accent hover:underline">
              Clear all
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          {members.length > 1 && (
            <FilterSelect
              label="Team member"
              value={filters.member}
              onChange={v => setParams({ member: v })}
              options={[{ value: '', label: 'All trainers' }, ...members.map(m => ({ value: m.id, label: m.name }))]}
            />
          )}
          <FilterSelect
            label="Date range"
            value={filters.range}
            onChange={v => (v === 'custom' ? setParams({ range: 'custom' }) : setParams({ range: v, from: null, to: null }))}
            options={RANGE_OPTIONS}
          />
          {filters.range === 'custom' && (
            <>
              <FilterDate label="From" value={filters.from} onChange={v => setParams({ from: v, range: 'custom' })} />
              <FilterDate label="To" value={filters.to} onChange={v => setParams({ to: v, range: 'custom' })} />
            </>
          )}
          {breeds.length > 0 && (
            <FilterSelect
              label="Breed"
              value={filters.breed}
              onChange={v => setParams({ breed: v })}
              options={[{ value: '', label: 'All breeds' }, ...breeds.map(b => ({ value: b, label: b }))]}
            />
          )}
          {customFields.map(f => (
            <FilterSelect
              key={f.id}
              label={`${f.label}${f.appliesTo === 'DOG' ? ' (dog)' : ''}`}
              value={filters.customFields[f.id] ?? ''}
              onChange={v => setParams({ [`cf_${f.id}`]: v })}
              options={[{ value: '', label: 'Any' }, ...f.options.map(o => ({ value: o, label: o }))]}
            />
          ))}
        </div>
      </Card>

      {/* Persistent top-line summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Clients" value={String(r.clients.total)} sub={`${r.clients.active} active`} />
        <StatCard icon={PawPrint} label="Dogs" value={String(r.clients.totalDogs)} sub={`${r.clients.dogsPerClient.toFixed(1)} per client`} />
        <StatCard icon={CalendarDays} label="Sessions" value={String(r.sessions.total)} sub={`${r.sessions.hoursTracked} h tracked`} />
        <StatCard icon={Wallet} label="Revenue" value={money(r.revenue.totalCents, cur)} sub="collected in range" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-1 py-2 rounded-xl transition-all duration-150 ${
                active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="text-[11px] sm:text-sm font-medium leading-tight text-center">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── Clients & dogs ── */}
      {tab === 'clients' && (
        <TabBody description="Growth and make-up of your client base.">
          <ChartCard title="New clients per month" series={seriesFromBuckets(r.clients.newPerMonth)} chartKind="line">
            {r.clients.newPerMonth.some(n => n > 0)
              ? <LineChart labels={monthLabels} data={r.clients.newPerMonth} label="New clients" />
              : <Empty />}
          </ChartCard>
          <ChartCard title="Active vs inactive clients" series={[{ label: 'Active', value: r.clients.active }, { label: 'Inactive', value: r.clients.inactive }]} chartKind="doughnut">
            {r.clients.total > 0
              ? <DoughnutChart labels={['Active', 'Inactive']} data={[r.clients.active, r.clients.inactive]} />
              : <Empty />}
          </ChartCard>
          <ChartCard title="Top dog breeds" series={r.clients.dogBreeds.map(b => ({ label: b.label, value: b.count }))} chartKind="barH">
            {r.clients.dogBreeds.length > 0
              ? <BarChart labels={r.clients.dogBreeds.map(b => b.label)} data={r.clients.dogBreeds.map(b => b.count)} label="Dogs" horizontal />
              : <Empty />}
          </ChartCard>
          <ChartCard title="Dog age groups" series={r.clients.dogAgeGroups.map(a => ({ label: a.label, value: a.count }))} chartKind="doughnut">
            {r.clients.dogAgeGroups.length > 0
              ? <DoughnutChart labels={r.clients.dogAgeGroups.map(a => a.label)} data={r.clients.dogAgeGroups.map(a => a.count)} />
              : <Empty hint="No dog ages recorded." />}
          </ChartCard>
          <ChartCard title="Most active clients" series={r.clients.topClients.map(c => ({ label: c.label, value: c.count }))} chartKind="barH">
            {r.clients.topClients.length > 0
              ? <BarChart labels={r.clients.topClients.map(c => c.label)} data={r.clients.topClients.map(c => c.count)} label="Sessions" horizontal />
              : <Empty />}
          </ChartCard>
        </TabBody>
      )}

      {/* ── Sessions ── */}
      {tab === 'sessions' && (
        <TabBody description="Volume over time and how sessions break down.">
          <ChartCard title="Sessions per month" series={seriesFromBuckets(r.sessions.perMonth)} chartKind="bar">
            {r.sessions.perMonth.some(n => n > 0)
              ? <BarChart labels={monthLabels} data={r.sessions.perMonth} label="Sessions" />
              : <Empty />}
          </ChartCard>
          <ChartCard title="Busiest days" series={WEEKDAYS.map((d, i) => ({ label: d, value: r.sessions.byWeekday[i] ?? 0 }))} chartKind="bar">
            {r.sessions.byWeekday.some(n => n > 0)
              ? <BarChart labels={WEEKDAYS} data={r.sessions.byWeekday} label="Sessions" />
              : <Empty />}
          </ChartCard>
          <ChartCard title="By status" series={r.sessions.byStatus.map(s => ({ label: SESSION_STATUS_LABEL[s.label] ?? s.label, value: s.count }))} chartKind="doughnut">
            {r.sessions.byStatus.length > 0
              ? <DoughnutChart labels={r.sessions.byStatus.map(s => SESSION_STATUS_LABEL[s.label] ?? s.label)} data={r.sessions.byStatus.map(s => s.count)} />
              : <Empty />}
          </ChartCard>
          <ChartCard title="By type" series={r.sessions.byType.map(s => ({ label: SESSION_TYPE_LABEL[s.label] ?? s.label, value: s.count }))} chartKind="doughnut">
            {r.sessions.byType.length > 0
              ? <DoughnutChart labels={r.sessions.byType.map(s => SESSION_TYPE_LABEL[s.label] ?? s.label)} data={r.sessions.byType.map(s => s.count)} />
              : <Empty />}
          </ChartCard>
          {r.sessions.staff.length > 1 && (
            <ChartCard title="Sessions by team member" series={r.sessions.staff.map(s => ({ label: s.name, value: s.sessions }))} chartKind="barH">
              <BarChart labels={r.sessions.staff.map(s => s.name)} data={r.sessions.staff.map(s => s.sessions)} label="Sessions" horizontal color="#8b5cf6" />
            </ChartCard>
          )}
          <ChartCard title="Time tracked">
            <div className="h-64 flex flex-col items-center justify-center gap-3">
              <div className="text-center">
                <p className="flex items-center justify-center gap-2 text-4xl font-bold text-slate-900"><Clock className="h-7 w-7 text-accent" />{r.sessions.hoursTracked}<span className="text-lg font-medium text-slate-400">h</span></p>
                <p className="text-sm text-slate-500 mt-1">logged across all sessions</p>
              </div>
              {r.sessions.billableCents > 0 && (
                <p className="text-sm font-semibold text-emerald-600">{money(r.sessions.billableCents, cur)} billable</p>
              )}
            </div>
          </ChartCard>
        </TabBody>
      )}

      {/* ── Engagement ── */}
      {tab === 'engagement' && (
        <TabBody description="How clients are keeping up with homework.">
          <ChartCard title="Homework completion" series={[{ label: 'Completed', value: r.engagement.homeworkCompleted }, { label: 'Outstanding', value: r.engagement.homeworkTotal - r.engagement.homeworkCompleted }]}>
            {r.engagement.homeworkTotal > 0
              ? <DoughnutChart labels={['Completed', 'Outstanding']} data={[r.engagement.homeworkCompleted, r.engagement.homeworkTotal - r.engagement.homeworkCompleted]} />
              : <Empty hint="No homework assigned yet." />}
          </ChartCard>
          <ChartCard title="Completion rate">
            <div className="h-64 flex flex-col items-center justify-center">
              <p className="text-5xl font-bold text-slate-900">{homeworkPct}<span className="text-2xl text-slate-400">%</span></p>
              <p className="text-sm text-slate-500 mt-2">{r.engagement.homeworkCompleted} of {r.engagement.homeworkTotal} tasks completed</p>
            </div>
          </ChartCard>
        </TabBody>
      )}

      {/* ── Revenue & enquiries ── */}
      {tab === 'revenue' && (
        <TabBody description={peopleFiltered ? 'Revenue & enquiries are shown business-wide (member/breed filters don’t apply); the date range still applies.' : 'Money collected and where new clients come from.'}>
          <ChartCard title="Revenue per month" series={seriesFromBuckets(r.revenue.perMonthCents)} valueKind="money" currency={cur} chartKind="line">
            {r.revenue.perMonthCents.some(n => n > 0)
              ? <LineChart labels={monthLabels} data={r.revenue.perMonthCents} label="Revenue" currency={cur} />
              : <Empty hint="No client payments collected yet." />}
          </ChartCard>
          <ChartCard title="Revenue by type" series={r.revenue.byType.map(t => ({ label: t.label, value: t.count }))} valueKind="money" currency={cur} chartKind="doughnut">
            {r.revenue.byType.length > 0
              ? <DoughnutChart labels={r.revenue.byType.map(t => t.label)} data={r.revenue.byType.map(t => Math.round(t.count / 100))} />
              : <Empty hint="No client payments collected yet." />}
          </ChartCard>
          <ChartCard title="Enquiries by status" series={r.enquiries.byStatus.map(s => ({ label: ENQUIRY_STATUS_LABEL[s.label] ?? s.label, value: s.count }))} chartKind="doughnut">
            {r.enquiries.total > 0
              ? <DoughnutChart labels={r.enquiries.byStatus.map(s => ENQUIRY_STATUS_LABEL[s.label] ?? s.label)} data={r.enquiries.byStatus.map(s => s.count)} />
              : <Empty hint="No enquiries yet." />}
          </ChartCard>
          <ChartCard title="Enquiry conversion">
            <div className="h-64 flex flex-col items-center justify-center">
              <p className="text-5xl font-bold text-slate-900">{conversion}<span className="text-2xl text-slate-400">%</span></p>
              <p className="text-sm text-slate-500 mt-2">{r.enquiries.accepted} of {r.enquiries.total} enquiries accepted</p>
            </div>
          </ChartCard>
        </TabBody>
      )}

      {/* ── Custom fields ── */}
      {tab === 'fields' && (
        <div>
          <p className="text-sm text-slate-500 mb-4">How many of your clients and dogs have each field filled in.</p>
          {r.customFields.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-slate-400">
                No custom fields yet. Add them in{' '}
                <Link href="/settings?tab=forms" className="text-accent hover:underline">Settings → Forms</Link>{' '}
                to capture extra details about clients and dogs.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {r.customFields.map(f => <CustomFieldCard key={f.id} field={f} />)}
            </div>
          )}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Dog className="h-3.5 w-3.5" /> Counts include any sample/demo records. Tap “View data” on any chart for the numbers behind it.
      </p>
    </div>
  )
}

// ─── Filter controls ─────────────────────────────────────────────────────────

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-400">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function FilterDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-400">{label}</span>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </label>
  )
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: string; sub: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
    </Card>
  )
}

function TabBody({ description, children }: { description: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-slate-500 mb-4">{description}</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{children}</div>
    </div>
  )
}

function ChartCard({
  title, series, valueKind = 'count', currency, chartKind, children,
}: {
  title: string
  series?: Series
  valueKind?: ValueKind
  currency?: string
  chartKind?: ChartKind
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const canDrill = !!series && series.some(s => s.value > 0)
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {canDrill && (
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-accent flex-shrink-0"
          >
            <Table2 className="h-3.5 w-3.5" /> View data
          </button>
        )}
      </div>
      {children}
      {open && series && (
        <DataTableModal title={title} series={series} valueKind={valueKind} currency={currency} chartKind={chartKind} onClose={() => setOpen(false)} />
      )}
    </Card>
  )
}

// The chart, rebuilt from the series so the modal shows the same visual the card
// did, sitting above the raw numbers.
function ModalChart({ series, chartKind, valueKind, currency }: {
  series: Series; chartKind: ChartKind; valueKind: ValueKind; currency: string
}) {
  const labels = series.map(s => s.label)
  const data = series.map(s => s.value)
  if (chartKind === 'doughnut') {
    return <DoughnutChart labels={labels} data={valueKind === 'money' ? data.map(v => Math.round(v / 100)) : data} />
  }
  if (chartKind === 'line') {
    return <LineChart labels={labels} data={data} label="" currency={valueKind === 'money' ? currency : undefined} />
  }
  return <BarChart labels={labels} data={data} label="" horizontal={chartKind === 'barH'} />
}

function DataTableModal({
  title, series, valueKind, currency = 'nzd', chartKind, onClose,
}: {
  title: string
  series: Series
  valueKind: ValueKind
  currency?: string
  chartKind?: ChartKind
  onClose: () => void
}) {
  const total = series.reduce((s, row) => s + row.value, 0)
  const fmt = (v: number) =>
    valueKind === 'money' ? money(v, currency) : valueKind === 'hours' ? `${v} h` : v.toLocaleString()
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-[61] bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto">
          {chartKind && (
            <div className="px-5 pt-5">
              <ModalChart series={series} chartKind={chartKind} valueKind={valueKind} currency={currency} />
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-slate-400">
              <tr>
                <th className="text-left font-semibold px-5 py-2.5">Item</th>
                <th className="text-right font-semibold px-5 py-2.5">Value</th>
                <th className="text-right font-semibold px-5 py-2.5">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {series.map((row, i) => (
                <tr key={`${row.label}-${i}`} className="hover:bg-slate-50/60">
                  <td className="px-5 py-2.5 text-slate-700">{row.label}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums font-medium text-slate-900">{fmt(row.value)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-slate-400">{total > 0 ? `${Math.round((row.value / total) * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200">
              <tr>
                <td className="px-5 py-2.5 font-semibold text-slate-700">Total</td>
                <td className="px-5 py-2.5 text-right tabular-nums font-bold text-slate-900">{fmt(total)}</td>
                <td className="px-5 py-2.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

function Empty({ hint = 'No data yet.' }: { hint?: string }) {
  return (
    <div className="h-64 flex items-center justify-center">
      <p className="text-sm text-slate-400">{hint}</p>
    </div>
  )
}

function CustomFieldCard({ field }: { field: CustomFieldReport }) {
  const [open, setOpen] = useState(false)
  const pct = field.total > 0 ? Math.round((field.filled / field.total) * 100) : 0
  const breakdown = field.optionBreakdown?.filter(o => o.count > 0) ?? []
  const series: Series = [
    ...breakdown.map(o => ({ label: o.option, value: o.count })),
    { label: 'Not filled in', value: Math.max(0, field.total - field.filled) },
  ]
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 truncate">{field.label}</p>
          <span className={`inline-block mt-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
            field.appliesTo === 'DOG' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
          }`}>
            {field.appliesTo === 'DOG' ? '🐕 Dog' : '👤 Client'}
          </span>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{field.filled}<span className="text-sm font-medium text-slate-400">/{field.total}</span></p>
          <button onClick={() => setOpen(true)} className="text-xs font-medium text-slate-400 hover:text-accent inline-flex items-center gap-1">
            <Table2 className="h-3 w-3" /> {pct}% filled
          </button>
        </div>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
      </div>
      {breakdown.length > 0 && (
        <div className="mt-4">
          <DoughnutChart labels={breakdown.map(o => o.option)} data={breakdown.map(o => o.count)} />
        </div>
      )}
      {open && (
        <DataTableModal title={field.label} series={series} valueKind="count" chartKind="doughnut" onClose={() => setOpen(false)} />
      )}
    </Card>
  )
}
