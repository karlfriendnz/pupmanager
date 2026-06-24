'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Pencil, Trash2, CheckCircle2, Mail, Download, Lock, Unlock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { money, minutesToHours, hoursToMinutes, amountFor } from '@/lib/timesheets'

type Rate = { id: string; name: string; rateCents: number }
type ClientOpt = { id: string; name: string }
type Entry = {
  id: string; date: string; task: string; minutes: number
  rateId: string | null; rateName: string | null; rateCents: number | null; amountCents: number
  clientId: string | null; clientName: string | null; category: string | null; notes: string | null
}
type Sheet = { id: string; weekStart: string; title: string | null; status: string; notes: string | null; recipientEmail: string | null; finalisedAt: string | null; sentAt: string | null }
type Data = { timesheet: Sheet; entries: Entry[]; rates: Rate[]; clients: ClientOpt[]; currency: string; businessName: string; ownerEmail: string | null }

type Draft = { id: string | null; date: string; task: string; hours: string; rateId: string; manualDollars: string; clientId: string; category: string; notes: string }

function weekRange(weekStart: string): string {
  const a = new Date(weekStart); const b = new Date(a); b.setUTCDate(b.getUTCDate() + 6)
  const f = (d: Date) => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(a)} – ${f(b)} ${b.toLocaleDateString('en-NZ', { year: 'numeric', timeZone: 'UTC' })}`
}
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', timeZone: 'UTC' })

export function TimesheetDetail({ id }: { id: string }) {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [recipient, setRecipient] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  async function load() {
    const res = await fetch(`/api/timesheets/${id}`)
    if (!res.ok) { setError('Timesheet not found.'); return }
    const d: Data = await res.json()
    setData(d)
    setRecipient(d.timesheet.recipientEmail ?? d.ownerEmail ?? '')
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (error) return <p className="text-sm text-rose-600">{error}</p>
  if (!data) return <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>

  const { timesheet: ts, entries, rates, clients, currency } = data
  const locked = ts.status === 'FINALISED'
  const totalMinutes = entries.reduce((n, e) => n + e.minutes, 0)
  const totalCents = entries.reduce((n, e) => n + e.amountCents, 0)

  // Report: subtotal by rate.
  const byRate = new Map<string, { minutes: number; cents: number }>()
  for (const e of entries) {
    const k = e.rateName ?? 'Unrated'
    const c = byRate.get(k) ?? { minutes: 0, cents: 0 }
    c.minutes += e.minutes; c.cents += e.amountCents; byRate.set(k, c)
  }

  const newDraft = (): Draft => ({ id: null, date: ts.weekStart.slice(0, 10), task: '', hours: '', rateId: rates[0]?.id ?? '', manualDollars: '', clientId: '', category: '', notes: '' })
  const editDraft = (e: Entry): Draft => ({ id: e.id, date: e.date.slice(0, 10), task: e.task, hours: String(minutesToHours(e.minutes)), rateId: e.rateId ?? '', manualDollars: e.rateId ? '' : (e.amountCents / 100).toFixed(2), clientId: e.clientId ?? '', category: e.category ?? '', notes: e.notes ?? '' })

  function draftAmountCents(d: Draft): number {
    const minutes = hoursToMinutes(parseFloat(d.hours) || 0)
    const rate = rates.find(r => r.id === d.rateId)
    return rate ? amountFor(minutes, rate.rateCents) : Math.round((parseFloat(d.manualDollars) || 0) * 100)
  }

  async function saveEntry() {
    if (!draft) return
    if (!draft.task.trim() || !(parseFloat(draft.hours) >= 0)) { setNotice('Enter a task and hours.'); return }
    setBusy('entry'); setNotice(null)
    const body = {
      date: draft.date,
      task: draft.task.trim(),
      minutes: hoursToMinutes(parseFloat(draft.hours) || 0),
      rateId: draft.rateId || null,
      amountCents: draft.rateId ? null : Math.round((parseFloat(draft.manualDollars) || 0) * 100),
      clientId: draft.clientId || null,
      category: draft.category.trim() || null,
      notes: draft.notes.trim() || null,
    }
    try {
      const url = draft.id ? `/api/timesheets/${id}/entries/${draft.id}` : `/api/timesheets/${id}/entries`
      const res = await fetch(url, { method: draft.id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error?.formErrors?.[0] ?? (typeof d?.error === 'string' ? d.error : 'Failed to save entry'))
      setDraft(null)
      await load()
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Failed to save entry') } finally { setBusy(null) }
  }

  async function deleteEntry(entryId: string) {
    if (!confirm('Delete this entry?')) return
    const res = await fetch(`/api/timesheets/${id}/entries/${entryId}`, { method: 'DELETE' })
    if (res.ok) load()
  }

  async function patchSheet(patch: Record<string, unknown>) {
    await fetch(`/api/timesheets/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
  }

  async function finalise() {
    setBusy('finalise'); setNotice(null)
    try {
      const res = await fetch(`/api/timesheets/${id}/finalise`, { method: 'POST' })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error ?? 'Failed to finalise')
      await load()
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Failed to finalise') } finally { setBusy(null) }
  }
  async function reopen() {
    setBusy('finalise')
    try { await fetch(`/api/timesheets/${id}/finalise`, { method: 'DELETE' }); await load() } finally { setBusy(null) }
  }
  async function send() {
    if (!recipient.trim()) { setNotice('Enter a recipient email.'); return }
    setBusy('send'); setNotice(null)
    try {
      const res = await fetch(`/api/timesheets/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipientEmail: recipient.trim() }) })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error ?? 'Failed to send')
      setNotice(`Emailed to ${d.sentTo}.`)
      await load()
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Failed to send') } finally { setBusy(null) }
  }
  async function remove() {
    if (!confirm('Delete this whole timesheet?')) return
    const res = await fetch(`/api/timesheets/${id}`, { method: 'DELETE' })
    if (res.ok) router.push('/timesheets')
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">{weekRange(ts.weekStart)}</h1>
              {locked
                ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700"><Lock className="h-3 w-3" /> Finalised</span>
                : <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Draft</span>}
              {ts.sentAt && <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-100 text-sky-700"><Mail className="h-3 w-3" /> Sent</span>}
            </div>
            <input
              defaultValue={ts.title ?? ''}
              disabled={locked}
              onBlur={e => patchSheet({ title: e.target.value })}
              placeholder="Add a title (optional)"
              className="mt-1 w-full max-w-sm text-sm text-slate-600 bg-transparent border-0 border-b border-transparent focus:border-slate-200 focus:outline-none disabled:opacity-70"
            />
          </div>
          <button type="button" onClick={remove} className="text-xs text-slate-400 hover:text-rose-600">Delete</button>
        </div>
      </div>

      {/* Entries */}
      <div className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Entries</h2>
          {!locked && !draft && <Button type="button" size="sm" variant="secondary" onClick={() => setDraft(newDraft())}><Plus className="h-4 w-4" /> Add entry</Button>}
        </div>

        {/* table */}
        <div className="divide-y divide-slate-50">
          {entries.length === 0 && !draft && <p className="px-5 py-6 text-sm text-slate-400 text-center">No entries yet.</p>}
          {entries.map(e => (
            <div key={e.id} className="px-5 py-3 flex items-center gap-3">
              <div className="w-14 text-xs text-slate-500 shrink-0">{fmtDate(e.date)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-900 truncate">{e.task}</p>
                <p className="text-xs text-slate-400 truncate">
                  {[e.clientName, e.category, e.rateName].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <div className="text-xs text-slate-500 w-14 text-right shrink-0">{minutesToHours(e.minutes).toFixed(2)}h</div>
              <div className="text-sm font-medium text-slate-900 w-20 text-right shrink-0">{money(e.amountCents, currency)}</div>
              {!locked && (
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => setDraft(editDraft(e))} className="text-slate-400 hover:text-slate-700 p-1" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => deleteEntry(e.id)} className="text-slate-400 hover:text-rose-600 p-1" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* entry form */}
        {draft && (
          <div className="px-5 py-4 bg-slate-50/70 border-t border-slate-100">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date"><input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} className={inp} /></Field>
              <Field label="Hours"><input inputMode="decimal" value={draft.hours} onChange={e => setDraft({ ...draft, hours: e.target.value })} placeholder="1.5" className={inp} /></Field>
              <Field label="Task" full><input value={draft.task} onChange={e => setDraft({ ...draft, task: e.target.value })} placeholder="What did you do?" className={inp} /></Field>
              <Field label="Rate">
                <select value={draft.rateId} onChange={e => setDraft({ ...draft, rateId: e.target.value })} className={inp}>
                  <option value="">No rate / manual amount</option>
                  {rates.map(r => <option key={r.id} value={r.id}>{r.name} ({money(r.rateCents, currency)}/hr)</option>)}
                </select>
              </Field>
              {draft.rateId
                ? <Field label="Amount"><div className="h-9 flex items-center text-sm font-medium text-slate-700">{money(draftAmountCents(draft), currency)}</div></Field>
                : <Field label="Amount ($)"><input inputMode="decimal" value={draft.manualDollars} onChange={e => setDraft({ ...draft, manualDollars: e.target.value })} placeholder="0.00" className={inp} /></Field>}
              <Field label="Client (optional)">
                <select value={draft.clientId} onChange={e => setDraft({ ...draft, clientId: e.target.value })} className={inp}>
                  <option value="">—</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Category (optional)"><input value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} placeholder="Travel, admin…" className={inp} /></Field>
              <Field label="Notes (optional)" full><input value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} className={inp} /></Field>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Button type="button" size="sm" onClick={saveEntry} loading={busy === 'entry'}>{busy !== 'entry' && <CheckCircle2 className="h-4 w-4" />} {draft.id ? 'Save entry' : 'Add entry'}</Button>
              <button type="button" onClick={() => setDraft(null)} className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"><X className="h-3.5 w-3.5" /> Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Report / totals */}
      <div className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Summary</h2>
        <div className="flex flex-col gap-1.5 max-w-sm ml-auto">
          {[...byRate.entries()].map(([name, v]) => (
            <div key={name} className="flex items-center justify-between text-sm">
              <span className="text-slate-500">{name} · {minutesToHours(v.minutes).toFixed(2)}h</span>
              <span className="text-slate-800">{money(v.cents, currency)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-slate-200 pt-2 mt-1">
            <span className="font-semibold text-slate-900">Total · {minutesToHours(totalMinutes).toFixed(2)}h</span>
            <span className="font-bold text-slate-900">{money(totalCents, currency)}</span>
          </div>
        </div>
      </div>

      {/* Finalise + send */}
      <div className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-5 flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-slate-900">Finalise &amp; send</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-slate-600 mb-1">Email the PDF to</label>
            <input
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              onBlur={e => patchSheet({ recipientEmail: e.target.value })}
              placeholder="owner@business.com"
              className={inp}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!locked
            ? <Button type="button" onClick={finalise} loading={busy === 'finalise'} disabled={entries.length === 0}><Lock className="h-4 w-4" /> Finalise</Button>
            : <Button type="button" variant="secondary" onClick={reopen} loading={busy === 'finalise'}><Unlock className="h-4 w-4" /> Reopen</Button>}
          <Button type="button" onClick={send} loading={busy === 'send'} disabled={!locked} className="bg-accent hover:opacity-90"><Mail className="h-4 w-4" /> Email PDF</Button>
          <a href={`/api/timesheets/${id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300"><Download className="h-4 w-4" /> Download PDF</a>
        </div>
        {!locked && <p className="text-xs text-slate-400">Finalise to lock the entries, then email the PDF. You can reopen later if you need to change something.</p>}
        {notice && <p className="text-sm text-slate-600">{notice}</p>}
      </div>
    </div>
  )
}

const inp = 'w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
