'use client'

import { useState, useEffect, useCallback } from 'react'
import { CalendarClock, Loader2, Send, SlidersHorizontal, X } from 'lucide-react'

type PendingClient = { userId: string; name: string; count: number }

// Sits above the schedule. By default a clean alert — Notify everyone, or
// Customise to pick specific clients. Only lists clients who've set up their
// account (the API filters by activation). Refreshes on mount and whenever a
// drag/edit fires `reschedule-pending-changed`.
export function RescheduleBanner() {
  const [sessions, setSessions] = useState(0)
  const [clients, setClients] = useState<PendingClient[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<null | 'send' | 'dismiss'>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/schedule/notify-reschedules')
      if (!res.ok) return
      const data = await res.json()
      setSessions(data.sessions ?? 0)
      setClients(data.clients ?? [])
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
      <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(16,185,129,0.25)]">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shrink-0">
          <Send className="h-[18px] w-[18px]" />
        </span>
        <span className="text-sm font-medium text-emerald-800">{note}</span>
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

  // ids: the chosen clients when customising, otherwise everyone.
  async function send(ids: string[] | null) {
    if (ids && ids.length === 0) return
    setBusy('send')
    try {
      const res = await fetch('/api/schedule/notify-reschedules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { clientUserIds: ids } : {}),
      })
      const data = await res.json().catch(() => ({}))
      setNote(`Notified ${data.clients ?? 0} client${data.clients === 1 ? '' : 's'}.`)
    } catch { /* ignore */ }
    setBusy(null)
    setExpanded(false)
    void refresh()
  }

  async function dismissAll() {
    setBusy('dismiss')
    try { await fetch('/api/schedule/notify-reschedules', { method: 'DELETE' }) } catch { /* ignore */ }
    setBusy(null)
    setExpanded(false)
    setNote(null)
    void refresh()
  }

  const peopleLabel = clients.length === 1 ? "1 client hasn't been told yet" : `${clients.length} clients haven't been told yet`

  return (
    <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(217,119,6,0.25)]">
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-600 shrink-0">
          <CalendarClock className="h-[18px] w-[18px]" />
        </span>
        <span className="text-sm font-semibold text-amber-900">
          {sessions} session{sessions === 1 ? '' : 's'} rescheduled
        </span>
        <span className="text-sm text-amber-700">— {expanded ? 'choose who to notify' : peopleLabel}</span>

        {!expanded && (
          <div className="flex items-center gap-2 ml-auto">
            <button type="button" onClick={dismissAll} disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 h-8 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50">
              {busy === 'dismiss' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Dismiss
            </button>
            <button type="button" onClick={() => setExpanded(true)} disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-xs font-medium border border-amber-300 text-amber-800 bg-white hover:bg-amber-50 disabled:opacity-50">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Customise
            </button>
            <button type="button" onClick={() => send(null)} disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
              {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Notify clients
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <>
          <div className="mt-2.5 rounded-lg bg-white/70 ring-1 ring-amber-100 divide-y divide-amber-100/70 max-h-52 overflow-auto">
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
            <button type="button" onClick={() => setExpanded(false)} disabled={busy !== null}
              className="inline-flex items-center rounded-lg px-2.5 h-8 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50">
              Back
            </button>
            <button type="button" onClick={() => send([...selected])} disabled={busy !== null || selected.size === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
              {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Notify {selected.size} selected
            </button>
          </div>
        </>
      )}
    </div>
  )
}
