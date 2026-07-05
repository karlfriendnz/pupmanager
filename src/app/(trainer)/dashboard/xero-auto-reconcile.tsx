'use client'

import { useEffect } from 'react'

const KEY = 'pm-xero-reconcile-last'
const THROTTLE_MS = 10 * 60 * 1000 // 10 minutes

// Fire-and-forget: on dashboard mount, kick off a Xero payment reconciliation so
// invoice statuses are fresh on landing — without waiting for the poll cron or
// the manual button. Throttled per-browser (localStorage timestamp) so hopping
// around the app doesn't hammer Xero's rate limits. Renders no UI and never
// blocks the dashboard.
export function XeroAutoReconcile({ xeroConnected }: { xeroConnected: boolean }) {
  useEffect(() => {
    if (!xeroConnected) return
    try {
      const last = Number(localStorage.getItem(KEY) ?? '0')
      if (Number.isFinite(last) && Date.now() - last < THROTTLE_MS) return
      // Stamp BEFORE firing so a fast re-mount / double render can't double-post.
      localStorage.setItem(KEY, String(Date.now()))
    } catch {
      // localStorage unavailable (private mode etc.) — skip the throttle but
      // still fire once for this mount.
    }
    // Fire-and-forget; the result is irrelevant here (the list re-fetches its own
    // data). keepalive lets it complete even if the trainer navigates away.
    fetch('/api/trainer/finances/receivables/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true,
    }).catch(() => {})
  }, [xeroConnected])

  return null
}
