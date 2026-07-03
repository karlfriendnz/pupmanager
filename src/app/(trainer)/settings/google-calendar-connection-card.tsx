'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, Loader2, AlertCircle } from 'lucide-react'

// Settings → Integrations card for the Google Calendar connection. Shows the
// connected state (or a connect CTA) and lets an owner disconnect. Sync itself
// is one-way and best-effort; this card is just the on/off.
export function GoogleCalendarConnectionCard({
  connected,
  configured,
}: {
  connected: boolean
  configured: boolean
}) {
  const params = useSearchParams()
  const [busy, setBusy] = useState(false)

  // Surface the outcome of the OAuth round-trip (set by the callback redirect).
  const flag = params.get('googlecalendar')

  async function disconnect() {
    if (!confirm('Disconnect Google Calendar? New sessions and changes will stop syncing.')) return
    setBusy(true)
    try {
      const res = await fetch('/api/google-calendar/disconnect', { method: 'POST' })
      // Full navigation (not router.refresh) so the server re-reads the now-gone
      // connection AND the stale ?googlecalendar=connected flag is cleared.
      if (res.ok) { window.location.assign('/settings?tab=googlecalendar'); return }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-slate-900">Google Calendar</h3>
        <p className="mt-0.5 text-sm text-slate-500">
          Push your sessions, classes and blocked-out time straight into your own Google Calendar.
        </p>

        {connected ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              <Check className="h-3.5 w-3.5" />
              Connected
            </span>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline disabled:opacity-50"
            >
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ) : configured ? (
          <a
            href="/api/google-calendar/connect"
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#4285F4] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3367d6]"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Connect Google Calendar
          </a>
        ) : (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <AlertCircle className="h-3.5 w-3.5" />
            Google Calendar isn’t configured for this environment yet.
          </p>
        )}

        {flag === 'error' && (
          <p className="mt-2 text-xs text-rose-600">Couldn’t connect to Google Calendar. Please try again.</p>
        )}
        {flag === 'unconfigured' && (
          <p className="mt-2 text-xs text-rose-600">Google Calendar isn’t configured for this environment yet.</p>
        )}

        {connected && (
          <p className="mt-4 text-xs text-slate-500">
            Sync is one-way — PupManager writes to your calendar, but changes you make in
            Google Calendar don’t flow back.
          </p>
        )}
      </div>
    </div>
  )
}
