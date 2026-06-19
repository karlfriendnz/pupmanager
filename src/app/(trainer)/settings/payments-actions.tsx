'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

// Client actions for the Payments panel. The heavy lifting (account create,
// link minting) is server-side; these just call the route and hand off to the
// Stripe-hosted URL it returns.

/** Starts or resumes Stripe Connect onboarding, then redirects to Stripe. */
export function ConnectButton({ label }: { label: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/connect/account', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) {
        setError(typeof body.error === 'string' ? body.error : 'Could not start payment setup.')
        setLoading(false)
        return
      }
      window.location.href = body.url
    } catch {
      setError('Could not start payment setup.')
      setLoading(false)
    }
  }

  return (
    <div>
      <Button type="button" onClick={start} loading={loading}>{label}</Button>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </div>
  )
}

/** Master switch: only enabled once the account can take charges. */
export function AcceptPaymentsToggle({ initial }: { initial: boolean }) {
  const router = useRouter()
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    const next = !on
    setSaving(true)
    setOn(next) // optimistic
    try {
      const res = await fetch('/api/connect/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptPaymentsEnabled: next }),
      })
      if (!res.ok) setOn(!next) // revert
      else router.refresh()
    } catch {
      setOn(!next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={saving}
      onClick={toggle}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}
