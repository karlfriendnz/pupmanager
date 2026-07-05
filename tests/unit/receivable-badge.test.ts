import { describe, it, expect } from 'vitest'
import { receivableBadge } from '@/components/finances/receivable-document'

// receivableBadge — maps an invoice's (status, sentAt) to the pill label + colour
// shown in Finances + the client profile. Precedence: CANCELLED, PAID, PARTIAL,
// then sent-vs-unsent for an UNPAID invoice.
describe('receivableBadge', () => {
  it('CANCELLED → "Cancelled" (rose)', () => {
    expect(receivableBadge({ status: 'CANCELLED', sentAt: null })).toEqual({ label: 'Cancelled', cls: 'bg-rose-50 text-rose-600' })
  })

  it('PAID → "Paid" (emerald)', () => {
    expect(receivableBadge({ status: 'PAID', sentAt: '2026-07-01' })).toEqual({ label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' })
  })

  it('PARTIAL → "Partially paid" (amber)', () => {
    expect(receivableBadge({ status: 'PARTIAL', sentAt: '2026-07-01' })).toEqual({ label: 'Partially paid', cls: 'bg-amber-100 text-amber-700' })
  })

  it('UNPAID + not sent → "Unsent" (grey)', () => {
    expect(receivableBadge({ status: 'UNPAID', sentAt: null })).toEqual({ label: 'Unsent', cls: 'bg-slate-100 text-slate-500' })
  })

  it('UNPAID + sent → "Sent" (sky)', () => {
    expect(receivableBadge({ status: 'UNPAID', sentAt: '2026-07-01' })).toEqual({ label: 'Sent', cls: 'bg-sky-100 text-sky-700' })
  })

  it('CANCELLED wins even if it was sent', () => {
    expect(receivableBadge({ status: 'CANCELLED', sentAt: '2026-07-01' }).label).toBe('Cancelled')
  })
})
