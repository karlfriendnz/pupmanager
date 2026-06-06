'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'

type PendingClient = { userId: string; name: string; count: number; dogs: string[]; plans: string[] }

// Sits above the schedule. Uses the app's card + brand-button language (white
// card, teal primary) rather than a coloured alert band. Notify everyone, or
// Customise to pick clients. Only lists clients who've activated their account.
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
      <div className="mb-3 rounded-2xl bg-white ring-1 ring-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] px-4 py-3 text-sm font-medium text-slate-700">
        {note}
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
    <div className="mb-3 rounded-2xl bg-white ring-1 ring-slate-100 shadow-[0_2px_16px_rgba(15,31,36,0.05)] px-4 py-3">
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
        <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
        <p className="text-sm">
          <span className="font-semibold text-slate-900">{sessions} session{sessions === 1 ? '' : 's'} rescheduled</span>
          <span className="text-slate-400"> · {expanded ? 'choose who to notify' : peopleLabel}</span>
        </p>

        {!expanded && (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={dismissAll} disabled={busy !== null}>Dismiss</Button>
            <Button variant="secondary" size="sm" onClick={() => setExpanded(true)} disabled={busy !== null}>Customise</Button>
            <Button variant="primary" size="sm" onClick={() => send(null)} loading={busy === 'send'}>Notify clients</Button>
          </div>
        )}
      </div>

      {expanded && (
        <>
          <div className="mt-3 rounded-xl ring-1 ring-slate-100 max-h-56 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50/95 backdrop-blur">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 w-9">
                    <input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all" className="h-4 w-4 accent-[var(--accent)] cursor-pointer align-middle" />
                  </th>
                  <th className="px-2 py-2">Client</th>
                  <th className="px-2 py-2">Dog</th>
                  <th className="px-2 py-2">Package / class</th>
                  <th className="px-2 py-2 text-right">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.userId} onClick={() => toggle(c.userId)} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(c.userId)} onChange={() => toggle(c.userId)} onClick={e => e.stopPropagation()} className="h-4 w-4 accent-[var(--accent)] cursor-pointer align-middle" />
                    </td>
                    <td className="px-2 py-2 font-medium text-slate-800 whitespace-nowrap">{c.name}</td>
                    <td className="px-2 py-2 text-slate-600">{c.dogs.join(', ') || '—'}</td>
                    <td className="px-2 py-2 text-slate-600">{c.plans.join(', ') || '—'}</td>
                    <td className="px-2 py-2 text-right text-slate-400 tabular-nums">{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 mt-3 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setExpanded(false)} disabled={busy !== null}>Back</Button>
            <Button variant="primary" size="sm" onClick={() => send([...selected])} disabled={busy !== null || selected.size === 0} loading={busy === 'send'}>
              Notify {selected.size} selected
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
