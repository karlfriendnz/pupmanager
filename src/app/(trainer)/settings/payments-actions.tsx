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

/** Full refund of a single payment. */
export function RefundButton({ paymentId }: { paymentId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refund() {
    if (!confirm('Refund this payment in full? The money is returned to the client.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/trainer/payments/${paymentId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (res.ok) {
        router.refresh()
      } else {
        const b = await res.json().catch(() => ({}))
        setError(typeof b.error === 'string' ? b.error : 'Could not refund.')
      }
    } catch {
      setError('Could not refund.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button onClick={refund} disabled={busy} className="text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50">
        {busy ? 'Refunding…' : 'Refund'}
      </button>
      {error && <span className="mt-0.5 text-[10px] text-rose-500">{error}</span>}
    </span>
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
      aria-label="Accept payments"
      disabled={saving}
      onClick={toggle}
      // minHeight inline: the app's global `button { min-height:44px }` is
      // unlayered, so it beats Tailwind's layered min-h-* by cascade layer.
      style={{ minHeight: 0 }}
      className={`flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-40 ${on ? 'justify-end bg-emerald-500' : 'justify-start bg-slate-300'}`}
    >
      <span className="block h-5 w-5 rounded-full bg-white shadow" />
    </button>
  )
}
