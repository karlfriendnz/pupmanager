'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Check, Loader2 } from 'lucide-react'
import { ProposeTimeSheet } from './propose-time-sheet'

// A counter-offer, as it appears in the message thread.
//
// The negotiation lives in the conversation rather than in a screen of its own,
// so this is what a proposal LOOKS like: a card in the run of messages showing
// the time on offer, with Approve / Suggest another on the live one.
//
// ─── Only the newest card is actionable, and this is not what enforces it ───
// `isLatest` decides whether the buttons render. That is presentation. The
// guarantee is server-side — a superseded proposal is stamped SUPERSEDED the
// moment a newer one is written and the approve route refuses it with a 409 —
// because a card three messages up the thread is still on screen, and a stale
// tab is exactly the situation where the button would otherwise book a time
// everyone had moved on from.
//
// Shared by both threads. The trainer's and the client's card must say the same
// thing about the same offer; two copies would eventually disagree about which
// one of them is waiting.

export interface ThreadProposal {
  id: string
  requestId: string
  status: 'OPEN' | 'SUPERSEDED' | 'ACCEPTED' | 'WITHDRAWN'
  proposedBy: 'TRAINER' | 'CLIENT'
  /** ISO strings, the whole proposed series. */
  sessionDates: string[]
}

export function BookingProposalCard({
  proposal,
  viewerParty,
  isLatest,
  mine,
}: {
  proposal: ThreadProposal
  /** Which side the reader is on — decides who may approve. */
  viewerParty: 'TRAINER' | 'CLIENT'
  /** True only for the newest proposal on this request. */
  isLatest: boolean
  /** True when the reader is the one who sent it (aligns it like their bubble). */
  mine: boolean
}) {
  const router = useRouter()
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposing, setProposing] = useState(false)

  const dates = proposal.sessionDates
    .map(d => new Date(d))
    .filter(d => !Number.isNaN(d.getTime()))
  const first = dates[0] ?? null
  // The reader may approve only somebody ELSE's live offer.
  const canAct = isLatest && proposal.status === 'OPEN' && proposal.proposedBy !== viewerParty

  async function approve() {
    setApproving(true)
    setError(null)
    try {
      const res = await fetch(`/api/booking-proposals/${proposal.id}/approve`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'That didn’t go through.')
        return
      }
      router.refresh()
    } catch {
      setError('That didn’t go through.')
    } finally {
      setApproving(false)
    }
  }

  const statusLine =
    proposal.status === 'ACCEPTED' ? 'Approved — this is booked'
    : proposal.status === 'SUPERSEDED' ? 'A newer time was suggested after this'
    : proposal.status === 'WITHDRAWN' ? 'No longer on the table'
    : canAct ? null
    : 'Waiting for a reply'

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        data-testid="booking-proposal-card"
        data-proposal-id={proposal.id}
        data-status={proposal.status}
        className="w-full max-w-xs overflow-hidden rounded-xl border border-slate-200 bg-white md:max-w-sm"
      >
        <div className="flex items-start gap-2.5 px-3 py-2.5">
          <CalendarClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-700" strokeWidth={1.75} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {proposal.proposedBy === viewerParty ? 'You suggested' : 'Suggested time'}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">
              {first
                ? first.toLocaleString('en-NZ', {
                    weekday: 'short', day: 'numeric', month: 'short',
                    hour: 'numeric', minute: '2-digit',
                  })
                : 'No time on this suggestion'}
            </p>
            {dates.length > 1 && (
              <p className="mt-0.5 text-sm text-slate-500">
                Then {dates.length - 1} more session{dates.length === 2 ? '' : 's'} after it.
              </p>
            )}
            {statusLine && <p className="mt-1 text-sm text-slate-500">{statusLine}</p>}
            {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
          </div>
        </div>

        {canAct && (
          <div className="flex items-stretch border-t border-slate-200 text-sm font-medium [&>*+*]:border-l [&>*+*]:border-slate-200">
            <button
              type="button"
              data-testid="proposal-counter"
              onClick={() => setProposing(true)}
              disabled={approving}
              className="min-h-11 flex-1 px-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Suggest another
            </button>
            <button
              type="button"
              data-testid="proposal-approve"
              onClick={approve}
              disabled={approving}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 px-2 text-[var(--pm-brand-700,#1f7d87)] hover:bg-slate-50 disabled:opacity-50"
            >
              {approving
                ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                : <Check className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
              Approve
            </button>
          </div>
        )}

        {proposing && (
          <ProposeTimeSheet
            requestId={proposal.requestId}
            onClose={() => setProposing(false)}
            onSent={() => router.refresh()}
          />
        )}
      </div>
    </div>
  )
}
