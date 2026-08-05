'use client'

import { useCallback, useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import { FlaskConical, Loader2 } from 'lucide-react'

/**
 * The strip a trade-show visitor sees while they are inside a sandbox.
 *
 * Three jobs, in order of how much they matter:
 *
 * 1. TELL THEM IT IS A DEMO. Somebody is about to type a real client's name
 *    into this. The bar says, on every screen, that it is practice data and
 *    that it goes away.
 * 2. KEEP IT ALIVE while they are using it. The ping is what makes the idle
 *    timeout mean anything — without it every sandbox looks abandoned the
 *    moment it is made.
 * 3. LET THEM FINISH. The exit button destroys the workspace immediately, so
 *    the next person at the stand does not pick up the phone and find
 *    somebody else's business.
 *
 * Rendered only when the session carries the signed `isDemo` flag, which is
 * stamped server-side from the tenant's marker column. This component cannot
 * make a session a demo — it only reports one.
 */
export function DemoSessionBar({ expiresAt }: { expiresAt: string | null }) {
  const [ending, setEnding] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)

  // Countdown to the hard expiry. Purely informational — the sweep is what
  // actually ends it, and it is authoritative.
  useEffect(() => {
    if (!expiresAt) return
    const end = new Date(expiresAt).getTime()
    const tick = () => setRemaining(Math.max(0, end - Date.now()))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [expiresAt])

  // Heartbeat, but only while the tab is actually on screen. A phone in a
  // pocket is an abandoned sandbox, and pinging from a hidden tab is how a
  // stand ends up with forty live tenants at closing time.
  useEffect(() => {
    let cancelled = false
    const ping = () => {
      if (cancelled || document.visibilityState !== 'visible') return
      fetch('/api/try/heartbeat', { method: 'POST' }).catch(() => {})
    }
    ping()
    const id = setInterval(ping, 2 * 60_000)
    document.addEventListener('visibilitychange', ping)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', ping)
    }
  }, [])

  const finish = useCallback(async () => {
    setEnding(true)
    // Destroy the tenant first, then drop the session. The other order leaves a
    // sandbox standing with nobody signed into it until the sweep comes round.
    await fetch('/api/try/exit', { method: 'POST' }).catch(() => {})
    await signOut({ callbackUrl: '/try/finished' })
  }, [])

  const minutes = remaining === null ? null : Math.ceil(remaining / 60_000)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-200 bg-white px-4 py-2.5 text-xs">
      <FlaskConical className="h-4 w-4 shrink-0 text-slate-700" strokeWidth={1.75} />
      <span className="font-medium text-slate-900">Demo — practice data only</span>
      {minutes !== null && (
        <span className="text-slate-500">
          {minutes > 0 ? `about ${minutes} min left` : 'finishing up'}
        </span>
      )}
      <button
        type="button"
        onClick={finish}
        disabled={ending}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-900 transition-colors active:bg-slate-50 disabled:opacity-60"
      >
        {ending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />}
        Finish demo
      </button>
      <p className="w-full text-slate-500">
        Nothing here is real and nothing can be emailed to anyone. Everything is deleted when you finish.
      </p>
    </div>
  )
}
