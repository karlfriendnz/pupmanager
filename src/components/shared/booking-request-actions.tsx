'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2 } from 'lucide-react'

// Confirm / decline buttons for a pending self-booking request. Confirm
// turns it into a real ClientPackage + sessions (server-side); decline
// closes it. Refreshes the dashboard so the panel updates.
export function BookingRequestActions({ requestId }: { requestId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState<'CONFIRM' | 'DECLINE' | null>(null)
  const [error, setError] = useState(false)

  async function act(action: 'CONFIRM' | 'DECLINE') {
    setPending(action)
    setError(false)
    try {
      const res = await fetch(`/api/booking-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        setError(true)
        return
      }
      router.refresh()
    } catch {
      setError(true)
    } finally {
      setPending(null)
    }
  }

  return (
    // Full-width split buttons on a phone (proper tap targets); compact and
    // right-aligned from sm: up where they sit beside the request details.
    <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0">
      <button
        type="button"
        onClick={() => act('DECLINE')}
        disabled={pending !== null}
        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 sm:flex-none sm:text-xs"
      >
        {pending === 'DECLINE' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        Decline
      </button>
      <button
        type="button"
        onClick={() => act('CONFIRM')}
        disabled={pending !== null}
        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 sm:flex-none sm:text-xs"
      >
        {pending === 'CONFIRM' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Confirm
      </button>
      {error && <span className="w-full text-right text-xs text-red-600 sm:w-auto">Failed</span>}
    </div>
  )
}
