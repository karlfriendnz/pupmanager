'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EnableAddonButton } from './enable-addon-button'

// The Google Calendar add-on promo CTA. Google Calendar has no settings page —
// connect AND disconnect both live here in the add-on popup. Shows a Connect
// button when disconnected, and a Connected badge + Disconnect when connected.
export function GoogleCalendarConnectCta() {
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected'>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/google-calendar/status')
      .then((r) => r.json())
      .then((d) => { if (live) setStatus(d.connected ? 'connected' : 'disconnected') })
      .catch(() => { if (live) setStatus('disconnected') })
    return () => { live = false }
  }, [])

  async function disconnect() {
    if (!confirm('Disconnect Google Calendar? New sessions and changes will stop syncing.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/google-calendar/disconnect', { method: 'POST' })
      if (!res.ok) { setError('Could not disconnect. Please try again.'); return }
      window.location.reload()
    } catch {
      setError('Could not disconnect. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') {
    return <div className="w-full"><Button type="button" size="lg" className="w-full" disabled><Loader2 className="h-4 w-4 animate-spin" /></Button></div>
  }

  if (status === 'connected') {
    return (
      <div className="flex w-full flex-col items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">
          <Check className="h-4 w-4" /> Connected
        </span>
        <button
          type="button"
          onClick={disconnect}
          disabled={busy}
          className="text-sm font-medium text-slate-500 underline-offset-2 hover:text-rose-600 hover:underline disabled:opacity-50"
        >
          {busy ? 'Disconnecting…' : 'Disconnect'}
        </button>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    )
  }

  // Disconnected → enable (if needed) + start OAuth, returning to the current page.
  const returnTo = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/schedule'
  return (
    <EnableAddonButton
      itemId="googlecalendar"
      label="Connect Google Calendar"
      connectHref={`/api/google-calendar/connect?returnTo=${encodeURIComponent(returnTo)}`}
    />
  )
}
