import { describe, it, expect } from 'vitest'
import { summarizeBulkResult } from '@/app/(trainer)/clients/bulk-email-modal'

describe('summarizeBulkResult', () => {
  it('reports a plain sent count with no skips', () => {
    expect(summarizeBulkResult({ broadcastId: 'b1', sent: 5, skipped: [] }))
      .toBe('Sent to 5 clients')
  })

  it('singularises a single recipient', () => {
    expect(summarizeBulkResult({ broadcastId: 'b1', sent: 1, skipped: [] }))
      .toBe('Sent to 1 client')
  })

  it('appends a skip breakdown grouped by reason', () => {
    const summary = summarizeBulkResult({
      broadcastId: 'b1',
      sent: 3,
      skipped: [
        { clientId: 'c1', reason: 'NO_EMAIL' },
        { clientId: 'c2', reason: 'OPTED_OUT' },
        { clientId: 'c3', reason: 'OPTED_OUT' },
      ],
    })
    expect(summary).toBe('Sent to 3 clients · 3 skipped (1 no email address, 2 unsubscribed)')
  })

  it('maps every known skip reason to a human label', () => {
    const summary = summarizeBulkResult({
      broadcastId: 'b1',
      sent: 0,
      skipped: [
        { clientId: 'c1', reason: 'NOT_FOUND' },
        { clientId: 'c2', reason: 'SAMPLE' },
      ],
    })
    expect(summary).toBe('Sent to 0 clients · 2 skipped (1 not found, 1 sample client)')
  })

  it('falls back to a lowercased reason for unknown codes', () => {
    const summary = summarizeBulkResult({
      broadcastId: 'b1',
      sent: 1,
      skipped: [{ clientId: 'c1', reason: 'MYSTERY' }],
    })
    expect(summary).toBe('Sent to 1 client · 1 skipped (1 mystery)')
  })
})
