'use client'

import { useState } from 'react'
import { Clock, Plus, Pencil, Trash2, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type TimeEntry = {
  id: string
  membershipId: string
  memberName: string
  minutes: number
  rateCents: number | null
  amountCents: number | null
  note: string | null
  createdAt: string
}
export type TeamMember = { id: string; name: string }

function fmtHours(min: number): string {
  const h = min / 60
  const s = (h % 1 === 0) ? String(h) : h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${s} h`
}
function fmtMoney(cents: number): string {
  const d = cents / 100
  return d % 1 === 0 ? `$${d}` : `$${d.toFixed(2)}`
}
function hoursToMinutes(hours: string): number | null {
  const n = parseFloat(hours)
  if (!isFinite(n) || n <= 0) return null
  return Math.round(n * 60)
}
function dollarsToCents(rate: string): number | null {
  const t = rate.trim()
  if (t === '') return null
  const n = parseFloat(t)
  if (!isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

type Draft = { membershipId: string; hours: string; rate: string; note: string }

function blankDraft(members: TeamMember[]): Draft {
  return { membershipId: members[0]?.id ?? '', hours: '', rate: '', note: '' }
}

// The shared field row used for both adding and editing an entry.
function EntryForm({
  members, draft, setDraft, onSave, onCancel, busy, saveLabel,
}: {
  members: TeamMember[]
  draft: Draft
  setDraft: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
  busy: boolean
  saveLabel: string
}) {
  const valid = !!draft.membershipId && hoursToMinutes(draft.hours) != null
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 flex flex-col gap-2.5">
      <div className="flex flex-col gap-2.5">
        <select
          value={draft.membershipId}
          onChange={e => setDraft({ ...draft, membershipId: e.target.value })}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 h-10 text-sm text-slate-800"
        >
          {members.length === 0 && <option value="">No team members</option>}
          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <label className="relative block">
          <input
            type="number" inputMode="decimal" step="0.25" min="0" placeholder="Hours"
            value={draft.hours}
            onChange={e => setDraft({ ...draft, hours: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white pl-3 pr-7 h-10 text-sm text-slate-800"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">h</span>
        </label>
        <label className="relative block">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
          <input
            type="number" inputMode="decimal" step="1" min="0" placeholder="Rate/hr"
            value={draft.rate}
            onChange={e => setDraft({ ...draft, rate: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white pl-6 pr-3 h-10 text-sm text-slate-800"
          />
        </label>
      </div>
      <input
        type="text" placeholder="Note (optional)"
        value={draft.note}
        onChange={e => setDraft({ ...draft, note: e.target.value })}
        className="rounded-lg border border-slate-200 bg-white px-3 h-10 text-sm text-slate-800"
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={onSave} loading={busy} disabled={!valid || busy}>
          <Check className="h-4 w-4" /> {saveLabel}
        </Button>
      </div>
    </div>
  )
}

export function SessionTimeTracking({
  sessionId, initialEntries, members,
}: {
  sessionId: string
  initialEntries: TimeEntry[]
  members: TeamMember[]
}) {
  const [entries, setEntries] = useState<TimeEntry[]>(initialEntries)
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState<Draft>(blankDraft(members))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(blankDraft(members))
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0)
  const totalBillable = entries.reduce((s, e) => s + (e.amountCents ?? 0), 0)

  async function addEntry() {
    const minutes = hoursToMinutes(addDraft.hours)
    if (!addDraft.membershipId || minutes == null) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/time-entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          membershipId: addDraft.membershipId,
          minutes,
          rateCents: dollarsToCents(addDraft.rate),
          note: addDraft.note.trim() || null,
        }),
      })
      if (!res.ok) { setError('Could not add time entry.'); return }
      const created: TimeEntry = await res.json()
      setEntries(prev => [...prev, created])
      setAdding(false); setAddDraft(blankDraft(members))
    } finally { setBusy(false) }
  }

  function startEdit(e: TimeEntry) {
    setEditingId(e.id)
    setEditDraft({
      membershipId: e.membershipId,
      hours: String(e.minutes / 60),
      rate: e.rateCents != null ? String(e.rateCents / 100) : '',
      note: e.note ?? '',
    })
  }

  async function saveEdit() {
    const minutes = hoursToMinutes(editDraft.hours)
    if (!editingId || !editDraft.membershipId || minutes == null) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/time-entries`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          membershipId: editDraft.membershipId,
          minutes,
          rateCents: dollarsToCents(editDraft.rate),
          note: editDraft.note.trim() || null,
        }),
      })
      if (!res.ok) { setError('Could not save changes.'); return }
      const updated: TimeEntry = await res.json()
      setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))
      setEditingId(null)
    } finally { setBusy(false) }
  }

  async function remove(id: string) {
    setDeletingId(id); setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/time-entries`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) { setError('Could not delete entry.'); return }
      setEntries(prev => prev.filter(e => e.id !== id))
    } finally { setDeletingId(null) }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      {entries.length === 0 && !adding && (
        <p className="text-sm text-slate-400">No time logged yet.</p>
      )}

      {entries.length > 0 && (
        <div className="rounded-xl border border-slate-100 divide-y divide-slate-100">
          {entries.map(e => editingId === e.id ? (
            <div key={e.id} className="p-3">
              <EntryForm members={members} draft={editDraft} setDraft={setEditDraft} onSave={saveEdit} onCancel={() => setEditingId(null)} busy={busy} saveLabel="Save" />
            </div>
          ) : (
            <div key={e.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700 text-xs font-bold">
                {e.memberName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{e.memberName}</p>
                {e.note && <p className="text-xs text-slate-400 truncate">{e.note}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold text-slate-800 tabular-nums">{fmtHours(e.minutes)}</p>
                {e.amountCents != null && <p className="text-xs text-slate-500 tabular-nums">{fmtMoney(e.amountCents)}</p>}
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button type="button" onClick={() => startEdit(e)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Edit entry">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => remove(e.id)} disabled={deletingId === e.id} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50" aria-label="Delete entry">
                  {deletingId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <EntryForm members={members} draft={addDraft} setDraft={setAddDraft} onSave={addEntry} onCancel={() => { setAdding(false); setError(null) }} busy={busy} saveLabel="Add" />
      ) : (
        <button
          type="button"
          onClick={() => { setAddDraft(blankDraft(members)); setAdding(true) }}
          className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-teal-700 hover:text-teal-800"
        >
          <Plus className="h-4 w-4" /> Log time
        </button>
      )}

      {entries.length > 0 && (
        <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-1">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Clock className="h-4 w-4 text-slate-400" /> {fmtHours(totalMinutes)} total
          </span>
          {totalBillable > 0 && (
            <span className="text-sm font-semibold text-slate-700 tabular-nums">{fmtMoney(totalBillable)} billable</span>
          )}
        </div>
      )}
    </div>
  )
}
