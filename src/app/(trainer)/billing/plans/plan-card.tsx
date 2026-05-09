'use client'

import { useState } from 'react'
import { openExternal } from '@/lib/external-link'

type Variant = 'growth' | 'default'

interface Props {
  planId: string
  planName: string
  isCurrent: boolean
  purchasable: boolean
  free: boolean
  variant?: Variant
}

// Per-plan CTA. Posts to /api/billing/checkout, takes the returned Stripe
// URL and either navigates the tab (web) or opens it in Safari (mobile).
// Two visual variants matched to the marketing pricing page:
//   - 'growth' (middle card on amber fill): pill-rounded white button
//     with brand-amber text — sits inside the accented card.
//   - 'default' (side cards): pill-rounded brand-teal button with
//     white text.
export function PlanCard({ planId, planName, isCurrent, purchasable, free, variant = 'default' }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const baseClasses = 'block w-full rounded-full px-6 py-3 text-center text-sm font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed'

  const variantClasses = variant === 'growth'
    ? 'bg-white hover:bg-white/95'
    : 'text-white hover:opacity-95'

  const variantStyle = variant === 'growth'
    ? { color: 'var(--pm-accent-500)' }
    : { background: 'var(--pm-brand-600)' }

  if (isCurrent) {
    return (
      <button disabled className={`${baseClasses} ${variantClasses}`} style={variantStyle}>
        You&apos;re on this plan
      </button>
    )
  }

  if (free) {
    return (
      <button disabled className={`${baseClasses} ${variantClasses}`} style={variantStyle}>
        Free tier — no purchase
      </button>
    )
  }

  if (!purchasable) {
    return (
      <button disabled className={`${baseClasses} ${variantClasses}`} style={variantStyle}>
        Coming soon
      </button>
    )
  }

  async function startCheckout() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Checkout failed (${res.status})`)
      }
      const { url } = await res.json()
      if (!url) throw new Error('Stripe did not return a URL')
      openExternal(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={startCheckout}
        disabled={busy}
        className={`${baseClasses} ${variantClasses}`}
        style={variantStyle}
      >
        {busy ? 'Opening checkout…' : `Start ${planName}`}
      </button>
      {error && (
        <p className="mt-2 text-xs text-center" style={{ color: variant === 'growth' ? 'rgba(255,255,255,0.95)' : '#dc2626' }}>
          {error}
        </p>
      )}
    </>
  )
}
