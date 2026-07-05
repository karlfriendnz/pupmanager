'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

/**
 * Turns an add-on on via /api/addons, then refreshes. Paid add-ons that need a
 * subscription first bounce the trainer to /billing/setup. Used as the CTA in a
 * FeaturePromo for non-Stripe add-ons (e.g. Marketing).
 *
 * `connectHref` — for add-ons that also need connecting (Google Calendar, Xero):
 * once enabled, navigate straight there (e.g. the OAuth start) so the trainer
 * connects from the popup instead of hunting for it in Settings.
 */
export function EnableAddonButton({ itemId, label, onEnabled, connectHref }: { itemId: string; label: string; onEnabled?: () => void; connectHref?: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function enable() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, active: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (body.needsSubscription) {
          window.location.href = '/billing/setup'
          return
        }
        setError(typeof body.error === 'string' ? body.error : 'Could not turn this on.')
        setLoading(false)
        return
      }
      onEnabled?.()
      // Enabled OK — if this add-on also needs connecting, go straight there
      // (full navigation so the server sees the now-enabled add-on).
      if (connectHref) { window.location.href = connectHref; return }
      router.refresh()
    } catch {
      setError('Could not turn this on.')
      setLoading(false)
    }
  }

  return (
    <div className="w-full">
      <Button type="button" onClick={enable} loading={loading} size="lg" className="w-full">{label}</Button>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </div>
  )
}
