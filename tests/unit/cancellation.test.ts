import { describe, it, expect } from 'vitest'
import { resolveCancellationFeeCents } from '@/lib/cancellation'

// Pure fee-decision logic shared by both client cancel routes.
describe('resolveCancellationFeeCents', () => {
  const now = new Date('2026-07-16T12:00:00Z')
  const in2h = new Date('2026-07-16T14:00:00Z')
  const in48h = new Date('2026-07-18T12:00:00Z')
  const past = new Date('2026-07-16T10:00:00Z')

  it('returns 0 when no fee is configured', () => {
    expect(resolveCancellationFeeCents({ cancellationFeeCents: null, cancellationFeeWindowHours: null }, in2h, now)).toBe(0)
    expect(resolveCancellationFeeCents({ cancellationFeeCents: 0, cancellationFeeWindowHours: 24 }, in2h, now)).toBe(0)
  })

  it('charges the fee for ANY cancellation when the window is null', () => {
    expect(resolveCancellationFeeCents({ cancellationFeeCents: 5000, cancellationFeeWindowHours: null }, in48h, now)).toBe(5000)
    expect(resolveCancellationFeeCents({ cancellationFeeCents: 5000, cancellationFeeWindowHours: null }, in2h, now)).toBe(5000)
  })

  it('charges only inside the window when one is set', () => {
    // 2h away, window 24h → within → charged.
    expect(resolveCancellationFeeCents({ cancellationFeeCents: 5000, cancellationFeeWindowHours: 24 }, in2h, now)).toBe(5000)
    // 48h away, window 24h → outside → free.
    expect(resolveCancellationFeeCents({ cancellationFeeCents: 5000, cancellationFeeWindowHours: 24 }, in48h, now)).toBe(0)
  })

  it('treats a past start as inside the window (late cancel)', () => {
    expect(resolveCancellationFeeCents({ cancellationFeeCents: 5000, cancellationFeeWindowHours: 24 }, past, now)).toBe(5000)
  })
})
