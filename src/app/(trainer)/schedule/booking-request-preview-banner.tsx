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
  onSuggestAnother,
}: {
  requestId: string
  clientName: string | null
  packageName: string
  sessionCount: number
  /** Proposed times that overlap an existing session in the visible week. */
  clashCount: number
  /** YYYY-MM-DD to return to after acting / dismissing. */
  focusDate: string
  /** Opens the counter-offer composer with no time chosen yet. The keyboard /
   *  screen-reader route to the same thing the ghost drag and the slot tap do —
   *  a gesture that only exists as a gesture is a feature some people cannot
   *  reach. */
  onSuggestAnother?: () => void
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
    // One flat bordered block, hairline-split: explanation on top, actions
    // underneath. It used to be a single `flex flex-wrap` row — icon
    // (flex-shrink-0) + text (flex-1) + a 3-button cluster (flex-shrink-0).
    // `flex-1` is `flex: 1 1 0%`, so the text's hypothetical main size is 0 and
    // wrapping never triggered; the un-shrinkable ~250px of buttons took the
    // row and left the sentence about 20px wide — one word per line.
    <div
      data-testid="booking-request-preview"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <CalendarClock
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-700"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            Previewing {clientName} · {packageName}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            {sessionCount} proposed session{sessionCount === 1 ? '' : 's'}, shown as dashed blocks below.
          </p>
          {onSuggestAnother && (
            <p className="mt-0.5 text-sm text-slate-500">
              Doesn&rsquo;t suit? Drag the first block, or tap an empty slot, to suggest another time.
            </p>
          )}
          {clashCount > 0 && (
            <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
              <span>
                {clashCount} clash{clashCount === 1 ? 'es' : ''} an existing session
              </span>
            </p>
          )}
          {error && <p className="mt-1 text-sm text-red-600">That didn&rsquo;t go through. Try again.</p>}
        </div>
      </div>

      {/* Actions get their own full-width row so nothing has to shrink. */}
      <div className="flex items-stretch border-t border-slate-200 text-sm font-medium [&>*+*]:border-l [&>*+*]:border-slate-200">
        <button
          type="button"
          onClick={dismiss}
          disabled={pending !== null}
          className="min-h-11 flex-1 px-2 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        >
          Close
        </button>
        {onSuggestAnother && (
          <button
            type="button"
            data-testid="preview-suggest-another"
            onClick={onSuggestAnother}
            disabled={pending !== null}
            className="min-h-11 flex-1 px-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Suggest a time
          </button>
        )}
        <button
          type="button"
          onClick={() => act('DECLINE')}
          disabled={pending !== null}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 px-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {pending === 'DECLINE'
            ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            : <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
          Decline
        </button>
        <button
          type="button"
          onClick={() => act('CONFIRM')}
          disabled={pending !== null}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 px-2 text-[var(--pm-brand-700)] hover:bg-slate-50 disabled:opacity-50"
        >
          {pending === 'CONFIRM'
            ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            : <Check className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
          Approve
        </button>
      </div>
    </div>
  )
}
