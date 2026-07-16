'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, AlertTriangle } from 'lucide-react'

// "Leave class" affordance for an enrolled group class — withdraws the client
// from the WHOLE run (all its remaining sessions), promoting the next waitlister
// server-side. Shown once per class (on its soonest upcoming session). The
// cancellation fee (if any) is computed server-side from the run's next session
// and shown before the client commits.
export function LeaveClassButton({
  runId,
  className,
  feeCents,
  currency,
}: {
  runId: string
  className: string
  feeCents: number
  currency: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const feeStr = feeCents > 0 ? formatMoney(feeCents, currency) : null

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/my/classes/${runId}/cancel`, { method: 'POST' })
      if (res.ok) {
        setOpen(false)
        // Land on the sessions list (refresh re-fetches it without the class).
        router.push('/my-sessions')
        router.refresh()
      } else {
        const b = await res.json().catch(() => ({}))
        setError(typeof b.error === 'string' ? b.error : 'Could not leave this class.')
      }
    } catch {
      setError('Could not leave this class.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
        className="text-xs font-semibold text-rose-600 hover:text-rose-700"
      >
        Leave class
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 px-4 py-6" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-lg font-bold text-slate-900">Leave this class?</h3>
              <button type="button" onClick={() => !busy && setOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-sm text-slate-500">{className} — you'll be removed from all its remaining sessions.</p>

            {feeStr && (
              <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" />
                <span>Leaving now incurs a <strong>{feeStr}</strong> cancellation fee.</span>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
              >
                Stay enrolled
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {busy ? 'Leaving…' : feeStr ? `Leave & pay ${feeStr}` : 'Leave class'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`
  }
}
