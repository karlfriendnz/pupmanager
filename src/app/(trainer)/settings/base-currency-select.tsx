'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CURRENCIES } from '@/lib/pricing'

/**
 * Base currency selector — the currency every price, invoice and client charge
 * is shown and taken in. This drives DISPLAY app-wide (packages, classes, shop,
 * invoices), not just Stripe payouts, so it lives on the general Profile
 * settings and works even for trainers who never take payments.
 *
 * Instant-save (like the Payments toggles) via the general trainer-profile
 * PATCH. Always editable — Stripe charges in this presentment currency and
 * settles to the connected payout account (with FX where they differ).
 */
export function BaseCurrencySelect({ initial }: { initial: string }) {
  const router = useRouter()
  const [value, setValue] = useState(initial.toLowerCase())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(next: string) {
    const prev = value
    setValue(next) // optimistic
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/trainer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payoutCurrency: next }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(typeof b.error === 'string' ? b.error : 'Could not change currency.')
        setValue(prev) // revert
      } else {
        router.refresh()
      }
    } catch {
      setError('Could not change currency.')
      setValue(prev)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label="Base currency"
        value={value}
        disabled={saving}
        onChange={e => change(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        {CURRENCIES.map(c => (
          <option key={c.code} value={c.code.toLowerCase()}>{c.symbol} {c.code}</option>
        ))}
      </select>
      {error && <span className="text-[11px] text-rose-500">{error}</span>}
    </div>
  )
}
