'use client'

import { money, minutesToHours } from '@/lib/timesheets'

type Entry = { date: string; task: string; minutes: number; amountCents: number }

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const dayKey = (d: Date) => d.toISOString().slice(0, 10)
const fmtShort = (d: Date) => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const hrs = (mins: number) => (mins ? minutesToHours(mins).toFixed(2) : '')

// Classic weekly-grid timesheet: projects (tasks) as rows, Mon–Sun as columns,
// with per-project totals, effective hourly rate, weekly pay, daily totals, and
// grand totals. Print-friendly.
export function TimesheetReport({
  weekStart,
  entries,
  currency,
  businessName,
  employeeName,
  status,
}: {
  weekStart: string
  entries: Entry[]
  currency: string
  businessName: string
  employeeName: string | null
  status: string
}) {
  const start = new Date(weekStart)
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); return d })
  const dayKeys = days.map(dayKey)

  // Pivot: task → { minutes per dayKey, total minutes, total cents }.
  const rows = new Map<string, { perDay: Record<string, number>; minutes: number; cents: number }>()
  for (const e of entries) {
    const task = e.task?.trim() || 'Untitled'
    const k = dayKey(new Date(e.date))
    const row = rows.get(task) ?? { perDay: {}, minutes: 0, cents: 0 }
    row.perDay[k] = (row.perDay[k] ?? 0) + e.minutes
    row.minutes += e.minutes
    row.cents += e.amountCents
    rows.set(task, row)
  }
  const rowList = [...rows.entries()]

  const dailyMinutes = (k: string) => rowList.reduce((n, [, r]) => n + (r.perDay[k] ?? 0), 0)
  const totalMinutes = rowList.reduce((n, [, r]) => n + r.minutes, 0)
  const totalCents = rowList.reduce((n, [, r]) => n + r.cents, 0)
  // Effective hourly rate for a row = pay ÷ hours (handles mixed-rate rows).
  const effRate = (r: { minutes: number; cents: number }) => (r.minutes > 0 ? Math.round(r.cents / (r.minutes / 60)) : 0)

  const th = 'border border-slate-300 px-2 py-1.5 text-center text-[11px] font-semibold text-slate-600'
  const td = 'border border-slate-300 px-2 py-1.5 text-center text-sm text-slate-700 tabular-nums'

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm print:border-0 print:shadow-none">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-900">Timesheet</h2>
        <div className="mt-2 grid gap-x-8 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
          <p><span className="font-semibold text-slate-500">Company:</span> {businessName}</p>
          <p><span className="font-semibold text-slate-500">Employee:</span> {employeeName ?? '—'}</p>
          <p><span className="font-semibold text-slate-500">Start date:</span> {fmtShort(days[0])}</p>
          <p><span className="font-semibold text-slate-500">End date:</span> {fmtShort(days[6])}</p>
        </div>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${th} text-left`} rowSpan={2}>Projects</th>
            {DAY_LABELS.map((d) => <th key={d} className={th}>{d}</th>)}
            <th className={`${th} bg-slate-50`} rowSpan={2}>Project<br />totals</th>
            <th className={`${th} bg-orange-50`} rowSpan={2}>Hourly<br />rate</th>
            <th className={`${th} bg-blue-50`} rowSpan={2}>Weekly<br />pay</th>
          </tr>
          <tr>
            {days.map((d, i) => <th key={i} className={`${th} font-normal text-[10px] text-slate-400`}>{fmtShort(d)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rowList.length === 0 && (
            <tr><td className={`${td} text-slate-400`} colSpan={11}>No entries this week.</td></tr>
          )}
          {rowList.map(([task, r]) => (
            <tr key={task}>
              <td className={`${td} text-left font-medium text-slate-800`}>{task}</td>
              {dayKeys.map(k => <td key={k} className={td}>{hrs(r.perDay[k] ?? 0)}</td>)}
              <td className={`${td} bg-slate-50 font-semibold`}>{hrs(r.minutes)}</td>
              <td className={`${td} bg-orange-50`}>{r.cents > 0 ? money(effRate(r), currency) : ''}</td>
              <td className={`${td} bg-blue-50 font-semibold`}>{r.cents > 0 ? money(r.cents, currency) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${td} text-left font-semibold italic text-slate-600`}>Daily total</td>
            {dayKeys.map(k => <td key={k} className={`${td} font-semibold`}>{hrs(dailyMinutes(k))}</td>)}
            <td className={`${td} bg-slate-100 font-bold`}>{hrs(totalMinutes)}</td>
            <td className={`${td} bg-orange-50`}></td>
            <td className={`${td} bg-blue-100 font-bold`}>{money(totalCents, currency)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="mt-4 flex flex-wrap justify-end gap-8 text-sm">
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total hours</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums">{minutesToHours(totalMinutes).toFixed(2)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total pay</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums">{money(totalCents, currency)}</p>
        </div>
      </div>
      {status === 'FINALISED' && <p className="mt-3 text-xs font-medium text-emerald-600">Finalised</p>}
    </div>
  )
}
