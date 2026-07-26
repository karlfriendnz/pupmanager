import { describe, it, expect } from 'vitest'
import { txDerived, type Tx } from '@/app/(trainer)/finances/finances-view'
import { money } from '@/components/finances/receivable-document'

// Two things the Finances list rows depend on:
//
//  1. money() — the invoice list shows several trainers' currencies in one
//     column (Karl's own list has NZD and GBP side by side), so nothing may
//     assume a dollar sign.
//  2. txDerived() — the phone's payment row no longer prints "Card fee … Net
//     …", but the figures were NOT deleted: they still drive the transaction
//     detail. If this maths ever changes, the row line is one line to restore.
const PAYMENT: Tx = {
  id: 'p1', description: 'test', clientName: 'Karl Test',
  amountTotal: 134, currency: 'nzd', applicationFeeAmount: 0,
  stripeFeeAmount: 36, amountRefunded: 0, status: 'PAID', paidAt: null,
}

describe('money', () => {
  it('renders each currency with its own symbol', () => {
    expect(money(2500, 'nzd')).toBe('$25.00')
    expect(money(2500, 'aud')).toBe('$25.00')
    expect(money(2500, 'gbp')).toBe('£25.00')
    expect(money(2500, 'eur')).toBe('€25.00')
    expect(money(2500, 'zar')).toBe('R25.00')
  })

  it('is case-insensitive about the ISO code', () => {
    expect(money(1000, 'GBP')).toBe('£10.00')
  })

  it('always shows two decimals and groups thousands', () => {
    expect(money(124000, 'nzd')).toBe('$1,240.00')
    expect(money(5, 'nzd')).toBe('$0.05')
    expect(money(0, 'gbp')).toBe('£0.00')
  })

  it('falls back to no symbol rather than guessing a dollar', () => {
    expect(money(2500, 'jpy')).toBe('25.00')
  })
})

describe('txDerived — still computed after the row line was removed', () => {
  it('net is gross minus the card fee (the reported $1.34 / $0.36 / $0.98 row)', () => {
    expect(txDerived(PAYMENT)).toEqual({ cardFee: 36, net: 98, refundable: true })
  })

  it('a missing Stripe fee counts as zero rather than breaking the net', () => {
    expect(txDerived({ ...PAYMENT, stripeFeeAmount: null })).toEqual({ cardFee: 0, net: 134, refundable: true })
  })

  it('subtracts refunds, and prorates any legacy platform fee against them', () => {
    const t: Tx = { ...PAYMENT, amountTotal: 10000, stripeFeeAmount: 320, applicationFeeAmount: 100, amountRefunded: 5000, status: 'PARTIALLY_REFUNDED' }
    // 10000 − 5000 refunded − 320 card fee − 50 (half the platform fee) = 4630
    expect(txDerived(t)).toEqual({ cardFee: 320, net: 4630, refundable: true })
  })

  it('a fully refunded payment cannot be refunded again', () => {
    expect(txDerived({ ...PAYMENT, status: 'REFUNDED' }).refundable).toBe(false)
    expect(txDerived({ ...PAYMENT, status: 'DISPUTED' }).refundable).toBe(false)
  })

  it('never divides by zero on a zero-amount payment', () => {
    const t: Tx = { ...PAYMENT, amountTotal: 0, stripeFeeAmount: 0, applicationFeeAmount: 0 }
    expect(txDerived(t).net).toBe(0)
  })
})
