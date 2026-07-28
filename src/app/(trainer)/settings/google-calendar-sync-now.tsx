'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * "Sync my calendar now" — force this company's already-scheduled sessions into
 * Google.
 *
 * Connecting does this by itself now, but only for people connecting from here
 * on. Anyone who connected earlier has a calendar missing every class that was
 * already in the diary, and no way to ask for it: the catch-up endpoint is
 * CRON_SECRET-guarded, and that secret is write-only in Vercel, so not even we
 * can read it. A button the trainer can press is the honest answer.
 *
 * Safe to press twice — the sync only ever touches sessions with no mirrored
 * event, so pressing it again adds nothing and duplicates nothing.
 */
export function GoogleCalendarSyncNow() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  async function run() {
    setBusy(true)
    setMsg(null)
    setFailed(false)
    try {
      const res = await fetch('/api/google-calendar/backfill', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFailed(true)
        setMsg(typeof body.error === 'string' ? body.error : 'Could not sync just now.')
        return
      }
      const { synced, remaining } = body as { synced: number; remaining: number }
      setMsg(
        synced === 0 && remaining === 0
          ? 'Everything is already in your Google Calendar.'
          : remaining > 0
            // A big diary needs more than one pass; say so rather than leaving
            // them to wonder why some classes are still missing.
            ? `Added ${synced} session${synced === 1 ? '' : 's'}. ${remaining} still to go — press it again.`
            : `Added ${synced} session${synced === 1 ? '' : 's'} to your Google Calendar.`,
      )
    } catch {
      setFailed(true)
      setMsg('Could not sync just now.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3">
      <Button variant="secondary" size="sm" onClick={run} loading={busy}>
        <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
        Sync my calendar now
      </Button>
      <p className="mt-2 text-sm text-slate-500">
        Adds classes and sessions that were already booked before you connected. Nothing is
        duplicated if you press it twice.
      </p>
      {msg && (
        <p className={`mt-2 text-sm font-medium ${failed ? 'text-red-600' : 'text-emerald-700'}`}>
          {msg}
        </p>
      )}
    </div>
  )
}
