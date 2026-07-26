'use client'

import { useState, useEffect, useCallback } from 'react'

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
      <div className="mb-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">
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
    // One flat block split by hairlines. It used to be a floating card
    // (rounded-2xl + its own shadow) holding a row of pill buttons — both things
    // AGENTS.md rules out, and on a phone the pills wrapped onto their own line.
    <div
      data-testid="reschedule-banner"
      className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <p className="px-4 py-3 text-sm">
        <span className="font-semibold text-slate-900">{sessions} session{sessions === 1 ? '' : 's'} rescheduled</span>
        <span className="text-slate-500"> · {expanded ? 'choose who to notify' : peopleLabel}</span>
      </p>

      {!expanded ? (
        <div className="flex items-stretch border-t border-slate-200 text-sm font-medium [&>*+*]:border-l [&>*+*]:border-slate-200">
          <button
            type="button"
            onClick={dismissAll}
            disabled={busy !== null}
            className="min-h-11 flex-1 px-2 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            disabled={busy !== null}
            className="min-h-11 flex-1 px-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Choose who
          </button>
          <button
            type="button"
            onClick={() => send(null)}
            disabled={busy !== null}
            className="min-h-11 flex-1 px-2 text-[var(--pm-brand-700)] hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === 'send' ? 'Notifying…' : 'Notify all'}
          </button>
        </div>
      ) : (
        <>
          {/* Rows, not a five-column table in a 224px-tall scroll box. The box
              was a second scrollbar on the page; the table was unreadable at
              390px. The whole block grows and the page scrolls once. */}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 border-t border-slate-200 px-4 py-2.5">
            <input
              type="checkbox"
              checked={allOn}
              onChange={toggleAll}
              className="h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span className="text-sm font-medium text-slate-700">Everyone</span>
          </label>
          {clients.map(c => (
            <label
              key={c.userId}
              className="flex min-h-11 cursor-pointer items-start gap-3 border-t border-slate-200 px-4 py-2.5"
            >
              <input
                type="checkbox"
                checked={selected.has(c.userId)}
                onChange={() => toggle(c.userId)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">{c.name}</span>
                <span className="block text-xs text-slate-500">
                  {[c.dogs.join(', '), c.plans.join(', ')].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
              <span className="text-xs tabular-nums text-slate-400">
                {c.count} session{c.count === 1 ? '' : 's'}
              </span>
            </label>
          ))}
          <div className="flex items-stretch border-t border-slate-200 text-sm font-medium [&>*+*]:border-l [&>*+*]:border-slate-200">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              disabled={busy !== null}
              className="min-h-11 flex-1 px-2 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => send([...selected])}
              disabled={busy !== null || selected.size === 0}
              className="min-h-11 flex-1 px-2 text-[var(--pm-brand-700)] hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === 'send' ? 'Notifying…' : `Notify ${selected.size}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
