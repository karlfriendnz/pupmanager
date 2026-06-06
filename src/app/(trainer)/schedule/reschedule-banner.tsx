'use client'

import { useState, useEffect, useCallback } from 'react'
import { CalendarClock, Loader2, Send, X } from 'lucide-react'

// Sits above the schedule. When the trainer has moved sessions but the clients
// haven't been told, it shows a count and lets them batch-send (one summary per
// client) or dismiss. Refreshes on mount and whenever a drag fires the
// `reschedule-pending-changed` window event.
export function RescheduleBanner() {
  const [count, setCount] = useState({ sessions: 0, clients: 0 })
  const [busy, setBusy] = useState<null | 'send' | 'dismiss'>(null)
  const [sentNote, setSentNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/schedule/notify-reschedules')
      if (res.ok) setCount(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    const h = () => void refresh()
    window.addEventListener('reschedule-pending-changed', h)
    return () => window.removeEventListener('reschedule-pending-changed', h)
  }, [refresh])

  if (count.sessions === 0) {
    return sentNote ? (
      <div className="mb-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm px-4 py-2.5 flex items-center gap-2">
        <Send className="h-4 w-4" /> {sentNote}
      </div>
    ) : null
  }

  async function send() {
    setBusy('send')
    try {
      const res = await fetch('/api/schedule/notify-reschedules', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setSentNote(`Notified ${data.clients ?? 0} client${data.clients === 1 ? '' : 's'} about ${data.sessions ?? 0} rescheduled session${data.sessions === 1 ? '' : 's'}.`)
    } catch { /* ignore */ }
    setBusy(null)
    void refresh()
  }

  async function dismiss() {
    setBusy('dismiss')
    try { await fetch('/api/schedule/notify-reschedules', { method: 'DELETE' }) } catch { /* ignore */ }
    setBusy(null)
    setSentNote(null)
    void refresh()
  }

  const s = count.sessions === 1 ? '' : 's'
  const c = count.clients === 1 ? '' : 's'

  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <CalendarClock className="h-5 w-5 text-amber-600 shrink-0" />
      <span className="text-sm text-amber-900 font-medium">
        {count.sessions} session{s} rescheduled
      </span>
      <span className="text-sm text-amber-700">
        — {count.clients} client{c} haven&apos;t been told yet
      </span>
      <div className="flex items-center gap-2 ml-auto">
        <button
          type="button"
          onClick={dismiss}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 h-8 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          {busy === 'dismiss' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Dismiss
        </button>
        <button
          type="button"
          onClick={send}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Notify client{c}
        </button>
      </div>
    </div>
  )
}
