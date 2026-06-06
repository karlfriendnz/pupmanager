'use client'

import { useState, useEffect, useCallback } from 'react'

type PendingClient = { userId: string; name: string; count: number }

// Sits above the schedule. Flat alert (matches the app's Alert language) —
// Notify everyone, or Customise to pick specific clients. Only lists clients
// who've set up their account (the API filters by activation).
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
      <div className="mb-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{note}</div>
    ) : null
  }

  const toggle = (uid: string) => setSelected(prev => {
    const n = new Set(prev)
    if (n.has(uid)) n.delete(uid); else n.add(uid)
    return n
  })
  const allOn = clients.length > 0 && clients.every(c => selected.has(c.userId))
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(clients.map(c => c.userId)))

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

  const peopleLabel = clients.length === 1 ? "1 client hasn't been told" : `${clients.length} clients haven't been told`

  return (
    <div className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-amber-900">
      <div className="flex items-center gap-x-2 gap-y-2 flex-wrap">
        <p className="text-sm">
          <span className="font-semibold">{sessions} session{sessions === 1 ? '' : 's'} rescheduled</span>
          <span className="text-amber-700"> · {expanded ? 'choose who to notify' : peopleLabel}</span>
        </p>

        {!expanded && (
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={dismissAll} disabled={busy !== null}
              className="text-sm font-medium text-amber-700 hover:text-amber-900 px-2.5 py-1.5 rounded-lg hover:bg-amber-100/70 disabled:opacity-50">
              Dismiss
            </button>
            <button type="button" onClick={() => setExpanded(true)} disabled={busy !== null}
              className="text-sm font-medium text-amber-800 px-2.5 py-1.5 rounded-lg hover:bg-amber-100/70 disabled:opacity-50">
              Customise
            </button>
            <button type="button" onClick={() => send(null)} disabled={busy !== null}
              className="text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3.5 py-1.5 rounded-lg disabled:opacity-60">
              {busy === 'send' ? 'Sending…' : 'Notify clients'}
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <>
          <div className="mt-3 rounded-lg bg-white divide-y divide-slate-100 max-h-52 overflow-auto">
            <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer">
              <input type="checkbox" checked={allOn} onChange={toggleAll} className="h-4 w-4 accent-amber-600 cursor-pointer" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Everyone</span>
            </label>
            {clients.map(c => (
              <label key={c.userId} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={selected.has(c.userId)} onChange={() => toggle(c.userId)} className="h-4 w-4 accent-amber-600 cursor-pointer" />
                <span className="text-sm text-slate-800 flex-1 truncate">{c.name}</span>
                <span className="text-xs text-slate-400 shrink-0">{c.count} session{c.count === 1 ? '' : 's'}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-1 mt-3 justify-end">
            <button type="button" onClick={() => setExpanded(false)} disabled={busy !== null}
              className="text-sm font-medium text-amber-700 px-2.5 py-1.5 rounded-lg hover:bg-amber-100/70 disabled:opacity-50">
              Back
            </button>
            <button type="button" onClick={() => send([...selected])} disabled={busy !== null || selected.size === 0}
              className="text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3.5 py-1.5 rounded-lg disabled:opacity-50">
              {busy === 'send' ? 'Sending…' : `Notify ${selected.size} selected`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
