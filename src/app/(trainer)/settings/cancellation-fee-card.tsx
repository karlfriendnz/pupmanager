'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

// Trainer control for the client self-cancellation fee. Saved via the general
// trainer-profile PATCH route (the same one autoSendInvoices / defaultRequirePayment
// use). Amount is entered in major units and converted to cents; an empty or zero
// amount means "no cancellation fee". The window governs WHEN the fee bites: any
// cancellation, or only late ones within N hours of the session start.
export function CancellationFeeCard({
  initialFeeCents,
  initialWindowHours,
  currency,
}: {
  initialFeeCents: number | null
  initialWindowHours: number | null
  currency: string
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(initialFeeCents && initialFeeCents > 0 ? (initialFeeCents / 100).toFixed(2) : '')
  // "" = always (null window); otherwise the number of hours as a string.
  const [window, setWindow] = useState<string>(initialWindowHours != null ? String(initialWindowHours) : '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cur = currency.toUpperCase()
  const parsed = Math.round(parseFloat(amount) * 100)
  const feeCents = amount.trim() === '' || Number.isNaN(parsed) || parsed <= 0 ? 0 : parsed
  const hasFee = feeCents > 0

  async function save() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/trainer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 0 → null so the column reads cleanly as "no fee".
          cancellationFeeCents: hasFee ? feeCents : null,
          cancellationFeeWindowHours: hasFee && window !== '' ? Number(window) : null,
        }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(typeof b.error === 'string' ? b.error : 'Could not save.')
      } else {
        setSaved(true)
        router.refresh()
      }
    } catch {
      setError('Could not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cancellation fee</p>
      <p className="mt-2 text-sm text-slate-600 max-w-md">
        Charge clients a fee when they cancel a booking or leave a class from their app. The fee is
        raised as an invoice they pay like any other. Leave the amount blank for no fee.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-500">Fee amount</span>
          <div className="flex items-center rounded-xl border border-slate-200 bg-white px-3 focus-within:border-slate-300">
            <span className="text-sm text-slate-400">{cur}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setSaved(false) }}
              placeholder="0.00"
              className="w-24 bg-transparent px-2 py-2 text-sm text-slate-900 outline-none"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-500">When it applies</span>
          <select
            value={window}
            onChange={(e) => { setWindow(e.target.value); setSaved(false) }}
            disabled={!hasFee}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-300 disabled:opacity-50"
          >
            <option value="">Any cancellation</option>
            <option value="12">Within 12 hours of the start</option>
            <option value="24">Within 24 hours of the start</option>
            <option value="48">Within 48 hours of the start</option>
            <option value="72">Within 72 hours of the start</option>
          </select>
        </label>

        <Button type="button" onClick={save} loading={saving} size="sm">Save</Button>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {hasFee
          ? window === ''
            ? `Clients are charged ${cur} ${(feeCents / 100).toFixed(2)} whenever they cancel.`
            : `Clients are charged ${cur} ${(feeCents / 100).toFixed(2)} only when they cancel within ${window} hours of the start.`
          : 'No cancellation fee — clients can cancel for free.'}
      </p>

      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      {saved && !error && <p className="mt-2 text-sm text-emerald-600">Saved.</p>}
    </div>
  )
}
