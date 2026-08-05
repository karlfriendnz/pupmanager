import { describe, it, expect } from 'vitest'
import { toThreadProposal, latestProposalIds } from '@/lib/thread-proposal'

// The mapping that decides which counter-offer card shows buttons.
//
// This is PRESENTATION — the approve route refuses a superseded proposal
// regardless, and that is where the guarantee lives. It is tested anyway
// because a card offering a dead Approve is a lie even when the click is safely
// rejected: the trainer taps it, gets a 409, and learns not to trust the
// screen. The two have to agree.

describe('a proposal row becomes something the thread can render', () => {
  it('turns the Json column into real ISO strings', () => {
    const dto = toThreadProposal({
      id: 'p1',
      requestId: 'r1',
      status: 'OPEN',
      proposedBy: 'TRAINER',
      sessionDates: ['2026-09-01T21:00:00.000Z', '2026-09-08T21:00:00.000Z'],
    })
    expect(dto).toEqual({
      id: 'p1',
      requestId: 'r1',
      status: 'OPEN',
      proposedBy: 'TRAINER',
      sessionDates: ['2026-09-01T21:00:00.000Z', '2026-09-08T21:00:00.000Z'],
    })
  })

  it('drops entries that are not dates rather than handing the card a NaN', () => {
    // These are Json columns. A row half-written by a script must render as
    // fewer sessions, never as "Invalid Date" in a client's messages.
    const dto = toThreadProposal({
      id: 'p1', requestId: 'r1', status: 'OPEN', proposedBy: 'CLIENT',
      sessionDates: ['2026-09-01T21:00:00.000Z', 'not a date', ''],
    })
    expect(dto?.sessionDates).toEqual(['2026-09-01T21:00:00.000Z'])
  })

  it('survives a column that is not an array at all', () => {
    const dto = toThreadProposal({
      id: 'p1', requestId: 'r1', status: 'OPEN', proposedBy: 'CLIENT',
      sessionDates: { nope: true },
    })
    expect(dto?.sessionDates).toEqual([])
  })

  it('maps a message with no proposal to null', () => {
    expect(toThreadProposal(null)).toBeNull()
    expect(toThreadProposal(undefined)).toBeNull()
  })
})

describe('only the newest proposal per request is offered as actionable', () => {
  const p = (id: string, requestId: string) => ({
    id, requestId, status: 'OPEN' as const, proposedBy: 'TRAINER' as const, sessionDates: [],
  })

  it('picks the last one seen, because the thread is in order', () => {
    const live = latestProposalIds([p('a', 'r1'), p('b', 'r1'), p('c', 'r1')])
    expect(live).toEqual(new Set(['c']))
  })

  it('keeps one live proposal PER request, not one overall', () => {
    // A client can have two requests open at once. The newest offer on each is
    // still live; collapsing them to one would kill a perfectly good card on
    // the other booking.
    const live = latestProposalIds([p('a', 'r1'), p('b', 'r2'), p('c', 'r1')])
    expect(live).toEqual(new Set(['c', 'b']))
  })

  it('offers nothing on an empty thread', () => {
    expect(latestProposalIds([])).toEqual(new Set())
  })
})
