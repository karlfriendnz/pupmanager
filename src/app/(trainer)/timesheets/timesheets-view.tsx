'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Loader2, Clock, Trash2, ChevronRight, Mail, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { money, minutesToHours } from '@/lib/timesheets'

type Row = {
  id: string
  weekStart: string
  title: string | null
  status: string
  finalisedAt: string | null
  sentAt: string | null
  entryCount: number
  totalMinutes: number
  totalCents: number
}
type Rate = { id: string; name: string; rateCents: number; sortOrder: number }

function weekRange(weekStart: string): string {
  const a = new Date(weekStart)
  const b = new Date(a); b.setUTCDate(b.getUTCDate() + 6)
  const f = (d: Date) => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(a)} – ${f(b)} ${b.toLocaleDateString('en-NZ', { year: 'numeric', timeZone: 'UTC' })}`
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function TimesheetsView({ currency, isOwner }: { currency: string; isOwner: boolean }) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [rates, setRates] = useState<Rate[] | null>(null)
  const [week, setWeek] = useState(todayISO())
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reload() {
    fetch('/api/timesheets').then(r => r.json()).then(d => setRows(d.timesheets ?? [])).catch(() => setError('Failed to load timesheets.'))
    fetch('/api/time-rates').then(r => r.json()).then(d => setRates(d.rates ?? [])).catch(() => {})
  }
  useEffect(reload, [])

  async function create() {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/timesheets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekStart: week }) })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create')
      router.push(`/timesheets/${data.timesheet.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* New timesheet */}
      <div className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Start a new timesheet</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Any day in the week</label>
            <input type="date" value={week} onChange={e => setWeek(e.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <Button type="button" onClick={create} loading={creating}>
            {!creating && <Plus className="h-4 w-4" />} New timesheet
          </Button>
        </div>
        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
      </div>

      {/* Rates */}
      <RatesCard currency={currency} isOwner={isOwner} rates={rates} onChange={setRates} />

      {/* List */}
      <div>
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Your timesheets</h2>
        {rows === null && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {rows?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 grid place-items-center py-12 text-center text-sm text-slate-400">
            <div><Clock className="h-6 w-6 mx-auto mb-2 text-slate-300" />No timesheets yet — start one above.</div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {rows?.map(r => (
            <Link key={r.id} href={`/timesheets/${r.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-slate-300 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{weekRange(r.weekStart)}</span>
                  <StatusBadge status={r.status} sent={!!r.sentAt} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {r.title ? `${r.title} · ` : ''}{r.entryCount} {r.entryCount === 1 ? 'entry' : 'entries'} · {minutesToHours(r.totalMinutes).toFixed(2)}h
                </p>
              </div>
              <span className="text-sm font-semibold text-slate-900">{money(r.totalCents, currency)}</span>
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status, sent }: { status: string; sent: boolean }) {
  if (sent) return <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-100 text-sky-700"><Mail className="h-3 w-3" /> Sent</span>
  if (status === 'FINALISED') return <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Finalised</span>
  return <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Draft</span>
}

function RatesCard({ currency, isOwner, rates, onChange }: { currency: string; isOwner: boolean; rates: Rate[] | null; onChange: (r: Rate[]) => void }) {
  const [name, setName] = useState('')
  const [dollars, setDollars] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    const rateCents = Math.round(parseFloat(dollars) * 100)
    if (!name.trim() || !Number.isFinite(rateCents) || rateCents < 0) { setErr('Enter a name and an hourly rate.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/time-rates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), rateCents }) })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? 'Failed to add rate')
      onChange([...(rates ?? []), data.rate])
      setName(''); setDollars('')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to add rate') } finally { setBusy(false) }
  }

  async function remove(id: string) {
    if (!confirm('Remove this rate? Existing entries keep their saved rate.')) return
    const res = await fetch(`/api/time-rates/${id}`, { method: 'DELETE' })
    if (res.ok) onChange((rates ?? []).filter(r => r.id !== id))
  }

  return (
    <div className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-5">
      <h2 className="text-sm font-semibold text-slate-900">Hourly rates</h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-3">Named rates you apply to time entries. {isOwner ? '' : 'Only the owner can change these.'}</p>
      {rates === null ? (
        <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rates.length === 0 && <p className="text-sm text-slate-400">No rates yet.</p>}
          {rates.map(r => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
              <span className="flex-1 text-sm text-slate-800">{r.name}</span>
              <span className="text-sm font-medium text-slate-900">{money(r.rateCents, currency)}/hr</span>
              {isOwner && (
                <button type="button" onClick={() => remove(r.id)} className="text-slate-400 hover:text-rose-600" aria-label="Remove rate">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {isOwner && (
        <div className="flex flex-wrap items-end gap-2 mt-3 pt-3 border-t border-slate-100">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-slate-600 mb-1">Rate name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Training" className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div className="w-28">
            <label className="block text-xs font-medium text-slate-600 mb-1">$ / hour</label>
            <input value={dollars} onChange={e => setDollars(e.target.value)} inputMode="decimal" placeholder="80" className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={add} loading={busy}>{!busy && <Plus className="h-4 w-4" />} Add</Button>
        </div>
      )}
      {err && <p className="text-sm text-rose-600 mt-2">{err}</p>}
    </div>
  )
}
