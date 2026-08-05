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
  awaitingClient = false,
  clientProposalId = null,
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
  /** The trainer's own counter-offer is the live one, so the ball is in the
   *  client's court and there is nothing here to approve — only to replace. */
  awaitingClient?: boolean
  /** Set when the live offer came from the CLIENT. Approving THAT goes through
   *  the proposal route, which books the times on the table and re-checks the
   *  diary first; the request's blanket confirm would book the hour the client
   *  originally asked for, which is not what the ghosts below are showing. */
  clientProposalId?: string | null
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'CONFIRM' | 'DECLINE' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(action: 'CONFIRM' | 'DECLINE') {
    setPending(action)
    setError(null)
    try {
      // Approving the CLIENT's counter-offer books the times on the table, and
      // the proposal route re-checks the diary before it does. Only a request
      // with no live counter-offer goes through the blanket confirm.
      const res =
        action === 'CONFIRM' && clientProposalId
          ? await fetch(`/api/booking-proposals/${clientProposalId}/approve`, { method: 'POST' })
          : await fetch(`/api/booking-requests/${requestId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action }),
            })
      if (!res.ok) {
        // The refusals here are worth reading — "that hour has been booked
        // since" tells the trainer what to do next, and "failed" does not.
        const body = await res.json().catch(() => ({}))
        setError(typeof body?.error === 'string' ? body.error : 'That didn’t go through. Try again.')
        setPending(null)
        return
      }
      // Drop the preview; on confirm the now-real sessions render on this day.
      router.push(`/schedule?date=${focusDate}`)
      router.refresh()
    } catch {
      setError('That didn’t go through. Try again.')
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
          {awaitingClient ? (
            <p className="mt-0.5 text-sm text-slate-500">
              You suggested this time — waiting for {clientName ?? 'them'} to reply. You can suggest
              a different one instead.
            </p>
          ) : (
            onSuggestAnother && (
              <p className="mt-0.5 text-sm text-slate-500">
                Doesn&rsquo;t suit? Drag the first block, or tap an empty slot, to suggest another time.
              </p>
            )
          )}
          {clashCount > 0 && (
            <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
              <span>
                {clashCount} clash{clashCount === 1 ? 'es' : ''} an existing session
              </span>
            </p>
          )}
          {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
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
        {/* No Approve while the trainer's own suggestion is the live one —
            there is nothing on the table that is theirs to accept, and a button
            that books the hour they are still waiting on an answer for is the
            "superseded card" bug wearing different clothes. */}
        {!awaitingClient && (
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
        )}
      </div>
    </div>
  )
}
