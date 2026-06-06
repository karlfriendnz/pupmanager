'use client'

import { useState, useEffect, useCallback } from 'react'
import { CalendarClock, Loader2, Send } from 'lucide-react'

type PendingClient = { userId: string; name: string; count: number }

// Sits above the schedule. After moving sessions, the trainer picks which
// clients to tell (default all) and batch-sends one summary each, or dismisses.
// Refreshes on mount and whenever a drag/edit fires `reschedule-pending-changed`.
export function RescheduleBanner() {
  const [sessions, setSessions] = useState(0)
  const [clients, setClients] = useState<PendingClient[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<null | 'send' | 'dismiss'>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/schedule/notify-reschedules')
      if (!res.ok) return
      const data = await res.json()
      setSessions(data.sessions ?? 0)
      setClients(data.clients ?? [])
      // Default to everyone selected.
      setSelected(new Set((data.clients ?? []).map((c: PendingClient) => c.userId)))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    const h = () => void refresh()
    window.addEventListener('reschedule-pending-changed', h)
    return () => window.removeEventListener('reschedule-pending-changed', h)
  }, [refresh])

  if (sessions === 0) {
    return note ? (
      <div className="mb-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm px-4 py-2.5 flex items-center gap-2">
        <Send className="h-4 w-4" /> {note}
      </div>
    ) : null
  }

  const toggle = (uid: string) => setSelected(prev => {
    const n = new Set(prev)
    if (n.has(uid)) n.delete(uid); else n.add(uid)
    return n
  })
  const allOn = clients.length > 0 && clients.every(c => selected.has(c.userId))
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(clients.map(c => c.userId)))

  async function send() {
    if (selected.size === 0) return
    setBusy('send')
    try {
      const res = await fetch('/api/schedule/notify-reschedules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientUserIds: [...selected] }),
      })
      const data = await res.json().catch(() => ({}))
      setNote(`Notified ${data.clients ?? 0} client${data.clients === 1 ? '' : 's'}.`)
    } catch { /* ignore */ }
    setBusy(null)
    void refresh()
  }

  async function dismissAll() {
    setBusy('dismiss')
    try { await fetch('/api/schedule/notify-reschedules', { method: 'DELETE' }) } catch { /* ignore */ }
    setBusy(null)
    setNote(null)
    void refresh()
  }

  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2.5">
        <CalendarClock className="h-5 w-5 text-amber-600 shrink-0" />
        <span className="text-sm font-medium text-amber-900">
          {sessions} session{sessions === 1 ? '' : 's'} rescheduled
        </span>
        <span className="text-sm text-amber-700">— choose who to notify</span>
      </div>

      <div className="rounded-lg bg-white/70 ring-1 ring-amber-100 divide-y divide-amber-100/70 max-h-52 overflow-auto">
        <label className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer">
          <input type="checkbox" checked={allOn} onChange={toggleAll} className="h-4 w-4 accent-amber-600 cursor-pointer" />
          <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">Everyone</span>
        </label>
        {clients.map(c => (
          <label key={c.userId} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-amber-50/60">
            <input type="checkbox" checked={selected.has(c.userId)} onChange={() => toggle(c.userId)} className="h-4 w-4 accent-amber-600 cursor-pointer" />
            <span className="text-sm text-slate-800 flex-1 truncate">{c.name}</span>
            <span className="text-xs text-slate-400 shrink-0">{c.count} session{c.count === 1 ? '' : 's'}</span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-2.5 justify-end">
        <button
          type="button"
          onClick={dismissAll}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 h-8 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          {busy === 'dismiss' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Dismiss all
        </button>
        <button
          type="button"
          onClick={send}
          disabled={busy !== null || selected.size === 0}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Notify {selected.size} selected
        </button>
      </div>
    </div>
  )
}
