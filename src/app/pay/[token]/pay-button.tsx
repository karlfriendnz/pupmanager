'use client'

import { useState } from 'react'

// Kicks off the public checkout, then hands off to the Stripe-hosted page.
export function PayButton({ token, label }: { token: string; label: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pay/${token}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.url) {
        window.location.href = body.url
        return
      }
      setError(typeof body.error === 'string' ? body.error : 'Could not start payment. Please try again.')
    } catch {
      setError('Could not start payment. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={pay}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-accent hover:bg-accent-strong text-white text-base font-semibold disabled:opacity-60"
      >
        {loading ? 'Starting secure checkout…' : label}
      </button>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <p className="text-center text-xs text-slate-400">Secure card payment powered by Stripe. No account needed.</p>
    </div>
  )
}
