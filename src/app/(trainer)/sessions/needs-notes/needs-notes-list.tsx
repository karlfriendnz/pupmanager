'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Dog, FileText, DollarSign, ChevronRight, Check, Loader2 } from 'lucide-react'

export type TodoRow = {
  id: string
  title: string
  scheduledAt: string // ISO
  needsNotes: boolean
  invoiced: boolean
  clientName: string | null
  dogName: string | null
  valueCents: number | null
}

function formatDollars(cents: number): string {
  const d = cents / 100
  return d % 1 === 0 ? `$${d}` : `$${d.toFixed(2)}`
}
function startOfWeek(d: Date): Date {
  const out = new Date(d); out.setHours(0, 0, 0, 0)
  const day = out.getDay(); out.setDate(out.getDate() + (day === 0 ? -6 : 1 - day)); return out
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatDayLabel(d: Date): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const t = new Date(d); t.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - t.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return t.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'short' })
}
function formatWeekLabel(weekStart: Date): string {
  const today = startOfWeek(new Date())
  const weeksAgo = Math.round((today.getTime() - weekStart.getTime()) / (86_400_000 * 7))
  if (weeksAgo === 0) return 'This week'
  if (weeksAgo === 1) return 'Last week'
  if (weeksAgo < 4) return `${weeksAgo} weeks ago`
  return weekStart.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function NeedsNotesList({ rows }: { rows: TodoRow[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [invoicing, setInvoicing] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)))

  async function markInvoiced(id: string) {
    setInvoicing(prev => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/schedule/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiced: true }),
      })
      if (res.ok) router.refresh()
      else alert('Could not mark as invoiced.')
    } finally {
      setInvoicing(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  async function bulkUpdate(payload: { status?: 'COMPLETED'; invoiced?: boolean }) {
    if (selected.size === 0) return
    setBulkBusy(true)
    try {
      const res = await fetch('/api/sessions/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], ...payload }),
      })
      if (res.ok) { setSelected(new Set()); router.refresh() }
      else alert('Bulk update failed.')
    } finally { setBulkBusy(false) }
  }

  // Group by week → day, preserving the ASC-by-date order of `rows`.
  const byWeek = new Map<string, { weekStart: Date; rows: TodoRow[] }>()
  for (const r of rows) {
    const ws = startOfWeek(new Date(r.scheduledAt))
    const key = ws.toISOString().split('T')[0]
    const g = byWeek.get(key)
    if (g) g.rows.push(r); else byWeek.set(key, { weekStart: ws, rows: [r] })
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 cursor-pointer select-none">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300 accent-rose-600" />
          Select all ({rows.length})
        </label>
      </div>

      <div className="flex flex-col gap-6 pb-24">
        {Array.from(byWeek.values()).map(({ weekStart, rows: weekRows }) => {
          const byDay = new Map<string, { date: Date; rows: TodoRow[] }>()
          for (const r of weekRows) {
            const dt = new Date(r.scheduledAt); const k = dayKey(dt)
            const g = byDay.get(k); if (g) g.rows.push(r); else byDay.set(k, { date: dt, rows: [r] })
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
                {Array.from(byDay.values()).map(({ date, rows: dayRows }) => (
                  <div key={dayKey(date)}>
                    <h3 className="text-[11px] font-semibold text-slate-500 mb-1.5 px-1">{formatDayLabel(date)}</h3>
                    <div className="rounded-2xl bg-white border border-slate-100 overflow-hidden">
                      {dayRows.map((s, i) => {
                        const start = new Date(s.scheduledAt)
                        const isInvoicing = invoicing.has(s.id)
                        const isSel = selected.has(s.id)
                        return (
                          <div key={s.id} className={`flex items-center gap-2.5 pl-3 pr-3 py-3 transition-colors ${isSel ? 'bg-rose-50/50' : 'hover:bg-slate-50'} ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                            <input
                              type="checkbox" checked={isSel} onChange={() => toggle(s.id)}
                              className="h-4 w-4 rounded border-slate-300 accent-rose-600 flex-shrink-0"
                              aria-label={`Select ${s.title}`}
                            />
                            <Link href={`/sessions/${s.id}`} className="flex-1 min-w-0 flex items-center gap-3">
                              <div className="w-12 flex-shrink-0 text-xs font-semibold text-slate-500 tabular-nums">
                                {start.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-900 truncate">{s.title}</p>
                                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                                  {s.dogName && <span className="inline-flex items-center gap-1"><Dog className="h-3 w-3" /> {s.dogName}</span>}
                                  {s.clientName && <>{s.dogName && <span className="text-slate-300">·</span>}<span className="truncate">{s.clientName}</span></>}
                                </div>
                              </div>
                            </Link>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {s.needsNotes && (
                                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                  <FileText className="h-3 w-3" /> Notes
                                </span>
                              )}
                              {!s.invoiced && (
                                <button
                                  type="button"
                                  onClick={() => markInvoiced(s.id)}
                                  disabled={isInvoicing}
                                  title={s.valueCents != null ? `Mark invoiced (${formatDollars(s.valueCents)})` : 'Mark as invoiced'}
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold pl-0.5 pr-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 hover:border-rose-300 transition-colors disabled:opacity-60"
                                >
                                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-white">
                                    {isInvoicing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <DollarSign className="h-2.5 w-2.5" strokeWidth={3} />}
                                  </span>
                                  {s.valueCents != null ? formatDollars(s.valueCents) : 'Invoice'}
                                </button>
                              )}
                              {s.invoiced && (
                                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <Check className="h-3 w-3" /> Invoiced
                                </span>
                              )}
                              <ChevronRight className="h-4 w-4 text-slate-300" />
                            </div>
                          </div>
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

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3 shadow-[0_-4px_20px_rgba(15,23,42,0.06)]">
          <div className="max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-slate-700">{selected.size} selected</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setSelected(new Set())} disabled={bulkBusy} className="text-sm text-slate-500 hover:text-slate-700 px-3 h-10 disabled:opacity-60">Clear</button>
              <button
                onClick={() => bulkUpdate({ invoiced: true })} disabled={bulkBusy}
                className="inline-flex items-center gap-2 rounded-xl bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 text-sm font-semibold px-4 h-10 disabled:opacity-60"
              >
                {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" strokeWidth={2.5} />}
                Mark invoiced
              </button>
              <button
                onClick={() => bulkUpdate({ status: 'COMPLETED', invoiced: true })} disabled={bulkBusy}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold px-4 h-10 disabled:opacity-60"
              >
                {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Mark complete &amp; invoiced
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
