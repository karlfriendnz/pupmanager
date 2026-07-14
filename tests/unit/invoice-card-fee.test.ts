import { describe, it, expect, vi } from 'vitest'

// @/lib/connect validates the whole env on import; stub it so this stays a pure
// maths test (mirrors tests/unit/payments-fees.test.ts).
const h = vi.hoisted(() => ({ env: { PLATFORM_FEE_BPS: 0, NEXT_PUBLIC_APP_URL: 'https://app.test' } }))
vi.mock('@/lib/env', () => ({ env: h.env }))

import { estimateProcessingSurcharge } from '@/lib/connect'

// When a trainer passes the card fee on, the client is quoted the invoice amount
// in THREE places — the emailed "Pay $X" button, the pay page total, and Stripe's
// checkout — and they must all be the same number. They weren't: the surcharge
// was only added when the Stripe session was created, so a client read "$1.00",
// clicked pay, and was asked for $1.04 by a page they'd already committed to.
//
// The pay page (src/app/pay/[token]/page.tsx), the invoice email
// (src/lib/invoicing.ts) and the checkout (src/lib/connect-checkout.ts) all now
// derive the surcharge from this one function. These tests pin its behaviour so
// the three can't silently drift apart again.
describe('card surcharge — what the client is asked to pay', () => {
  it('grosses up so the trainer still nets the invoice amount', () => {
    // NZD: 3.5% + 30c. On a $1.00 invoice the 30c FIXED fee dominates — the
    // client pays $1.35 to have the trainer receive $1.00. That's not a bug, it's
    // what a card costs on a tiny amount, and it's why the fee has to be visible
    // BEFORE they click rather than sprung on them at Stripe.
    const surcharge = estimateProcessingSurcharge(100, 'nzd')
    expect(surcharge).toBe(35)
    const clientPays = 100 + surcharge
    // Stripe takes 3.5% of the gross + 30c; what's left is the invoice amount.
    const stripeFee = Math.round(clientPays * 0.035) + 30
    expect(clientPays - stripeFee).toBe(100)
  })

  it('scales on a realistic invoice', () => {
    // $150.00 session package.
    const surcharge = estimateProcessingSurcharge(15_000, 'nzd')
    const clientPays = 15_000 + surcharge
    const stripeFee = Math.round(clientPays * 0.035) + 30
    expect(clientPays - stripeFee).toBeGreaterThanOrEqual(15_000 - 1) // ±1c rounding
    expect(clientPays - stripeFee).toBeLessThanOrEqual(15_000 + 1)
  })

  it('is zero for a zero balance, so a paid invoice never sprouts a fee', () => {
    expect(estimateProcessingSurcharge(0, 'nzd')).toBe(0)
    expect(estimateProcessingSurcharge(-100, 'nzd')).toBe(0)
  })

  it('uses the trainer’s own currency rate', () => {
    // Different rates per payout currency — the client is quoted in theirs.
    expect(estimateProcessingSurcharge(10_000, 'nzd')).not.toBe(
      estimateProcessingSurcharge(10_000, 'gbp'),
    )
  })
})
