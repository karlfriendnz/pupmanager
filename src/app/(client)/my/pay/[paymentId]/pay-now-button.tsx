'use client'

import { useState } from 'react'
import { CreditCard, Loader2 } from 'lucide-react'
import { openExternal } from '@/lib/external-link'

export function PayNowButton({ paymentId }: { paymentId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/my/pay/${paymentId}`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.url) {
        openExternal(body.url)
        return // keep the spinner up while we leave for Stripe
      }
      setError(typeof body.error === 'string' ? body.error : 'Could not start checkout.')
      setLoading(false)
    } catch {
      setError('Could not start checkout.')
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={pay}
        disabled={loading}
        className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CreditCard className="h-4 w-4" /> Pay now</>}
      </button>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </div>
  )
}
