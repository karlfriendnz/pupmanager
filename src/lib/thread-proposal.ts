// Turning a BookingProposal row into the shape the message thread renders.
//
// Both threads (trainer and client) and the SSE stream all hand the same object
// to <BookingProposalCard>, so the mapping lives once. It is also the boundary
// where `sessionDates` stops being a Json column of unknown shape and becomes a
// `string[]` — the card must never be the thing that discovers a bad row.
//
// Prisma-free on purpose: a server page, a route handler and a client component
// all import it.

export interface ThreadProposalRow {
  id: string
  requestId: string
  status: string
  proposedBy: string
  sessionDates: unknown
}

export interface ThreadProposalDto {
  id: string
  requestId: string
  status: 'OPEN' | 'SUPERSEDED' | 'ACCEPTED' | 'WITHDRAWN'
  proposedBy: 'TRAINER' | 'CLIENT'
  sessionDates: string[]
}

/** The select every caller uses, so no thread accidentally fetches less. */
export const THREAD_PROPOSAL_SELECT = {
  id: true,
  requestId: true,
  status: true,
  proposedBy: true,
  sessionDates: true,
} as const

export function toThreadProposal(row: ThreadProposalRow | null | undefined): ThreadProposalDto | null {
  if (!row) return null
  const dates = (Array.isArray(row.sessionDates) ? row.sessionDates : [])
    .map(d => String(d))
    .filter(s => !Number.isNaN(new Date(s).getTime()))
  return {
    id: row.id,
    requestId: row.requestId,
    status: row.status as ThreadProposalDto['status'],
    proposedBy: row.proposedBy as ThreadProposalDto['proposedBy'],
    sessionDates: dates,
  }
}

/**
 * Which proposal in a thread is the live one for its request.
 *
 * The thread is in chronological order, so the LAST proposal seen for a given
 * request is the newest. Returns the set of ids that may show buttons — the
 * server refuses the rest regardless, but a card offering a dead Approve is a
 * lie even when the click is safely rejected.
 */
export function latestProposalIds(proposals: ThreadProposalDto[]): Set<string> {
  const newestByRequest = new Map<string, string>()
  for (const p of proposals) newestByRequest.set(p.requestId, p.id)
  return new Set(newestByRequest.values())
}
