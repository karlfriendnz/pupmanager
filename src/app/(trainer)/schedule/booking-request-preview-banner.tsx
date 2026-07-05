'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Check, X, Loader2, AlertTriangle } from 'lucide-react'

// Inline banner shown while previewing a pending booking request on the
// schedule. The proposed sessions are painted as ghost blocks on the grid;
// this keeps the Approve/Decline actions reachable and warns when any of the
// (currently visible) proposed times clash with an existing session. Confirm /
// decline hit the same /api/booking-requests/[id] endpoint as the dashboard
// panel, then drop the preview and land on the focused day.
export function BookingRequestPreviewBanner({
  requestId,
  clientName,
  packageName,
  sessionCount,
  clashCount,
  focusDate,
}: {
  requestId: string
  clientName: string
  packageName: string
  sessionCount: number
  /** Proposed times that overlap an existing session in the visible week. */
  clashCount: number
  /** YYYY-MM-DD to return to after acting / dismissing. */
  focusDate: string
}) {
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
        setPending(null)
        return
      }
      // Drop the preview; on confirm the now-real sessions render on this day.
      router.push(`/schedule?date=${focusDate}`)
      router.refresh()
    } catch {
      setError(true)
      setPending(null)
    }
  }

  function dismiss() {
    router.push(`/schedule?date=${focusDate}`)
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
          <CalendarClock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-indigo-900 truncate">
            Previewing: {clientName} · {packageName}
          </p>
          <p className="text-xs text-indigo-700/80">
            {sessionCount} proposed session{sessionCount === 1 ? '' : 's'} shown as dashed blocks below.
            {clashCount > 0 && (
              <span className="ml-1 inline-flex items-center gap-1 font-medium text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {clashCount} clash{clashCount === 1 ? 'es' : ''} an existing session
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={dismiss}
            disabled={pending !== null}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-white disabled:opacity-50"
          >
            Close preview
          </button>
          <button
            type="button"
            onClick={() => act('DECLINE')}
            disabled={pending !== null}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-white disabled:opacity-50"
          >
            {pending === 'DECLINE' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Decline
          </button>
          <button
            type="button"
            onClick={() => act('CONFIRM')}
            disabled={pending !== null}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {pending === 'CONFIRM' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve
          </button>
          {error && <span className="text-xs text-red-600">Failed</span>}
        </div>
      </div>
    </div>
  )
}
