'use client'

import { useEffect, useState, useCallback } from 'react'

// Detects when this client is running stale JS from a previous deploy
// (e.g. an iPad/WebView that never reloaded) and prompts a reload —
// stale data on the schedule is dangerous, so this is deliberately
// prominent. Compares the build id baked into THIS bundle against the
// currently-deployed server's. No-ops in dev (build id churns) and when
// offline / on fetch failure.
const OWN = process.env.NEXT_PUBLIC_BUILD_ID

export function VersionGuard() {
  const [stale, setStale] = useState(false)

  const check = useCallback(async () => {
    if (!OWN || OWN === 'dev' || process.env.NODE_ENV !== 'production') return
    try {
      const res = await fetch('/api/version', { cache: 'no-store' })
      if (!res.ok) return
      const { v } = (await res.json()) as { v?: string }
      if (v && v !== 'dev' && v !== OWN) setStale(true)
    } catch {
      /* offline / transient — ignore */
    }
  }, [])

  useEffect(() => {
    // check() only setStates after an awaited fetch (never synchronously
    // in the effect) — the rule can't see across the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check()
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const id = window.setInterval(check, 5 * 60 * 1000) // every 5 min
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.clearInterval(id)
    }
  }, [check])

  if (!stale) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-sm font-medium text-white shadow-md">
      <span>A newer version of PupManager is available — reload to avoid out-of-date data.</span>
      <button
        onClick={() => window.location.reload()}
        className="rounded-lg bg-white/20 px-3 py-1 font-semibold hover:bg-white/30"
      >
        Reload
      </button>
    </div>
  )
}
