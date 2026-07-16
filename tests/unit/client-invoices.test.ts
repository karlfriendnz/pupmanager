import { describe, it, expect, vi } from 'vitest'

// @/lib/connect (via @/lib/client-invoices) validates the whole env on import;
// stub it so this stays a pure shaping test. Prisma is never touched by the
// pure helper but the module imports it, so mock it too.
const h = vi.hoisted(() => ({ env: { PLATFORM_FEE_BPS: 0, NEXT_PUBLIC_APP_URL: 'https://app.test' } }))
vi.mock('@/lib/env', () => ({ env: h.env }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/client-context', () => ({ getActiveClient: vi.fn() }))

import { buildClientInvoiceSummary, formatMoney, type ClientInvoiceRecord } from '@/lib/client-invoices'
import { estimateProcessingSurcharge } from '@/lib/connect'

const D = (iso: string) => new Date(iso)

function invoice(over: Partial<ClientInvoiceRecord> = {}): ClientInvoiceRecord {
  return {
    id: 'inv1',
    description: 'Puppy Course',
    amountCents: 20_000,
    amountPaidCents: 0,
    currency: 'nzd',
    status: 'UNPAID',
    sentAt: D('2026-06-01'),
    paidAt: null,
    createdAt: D('2026-06-01'),
    payToken: 'tok1',
    lines: [{ id: 'l1', description: 'Consult', quantity: 1, amountCents: 20_000 }],
    ...over,
  }
}

const CARD_ON_FEE_ON = { canTakeCard: true, passProcessingFeeToClient: true }
const CARD_ON_FEE_OFF = { canTakeCard: true, passProcessingFeeToClient: false }

describe('buildClientInvoiceSummary — outstanding vs paid', () => {
  it('splits unpaid/partial from paid, and drops cancelled entirely', () => {
    const { outstanding, paid } = buildClientInvoiceSummary([
      invoice({ id: 'unpaid', status: 'UNPAID' }),
      invoice({ id: 'partial', status: 'PARTIAL', amountPaidCents: 5_000 }),
      invoice({ id: 'paid', status: 'PAID', amountPaidCents: 20_000, paidAt: D('2026-06-10') }),
      invoice({ id: 'cancelled', status: 'CANCELLED' }),
    ], CARD_ON_FEE_OFF)

    expect(outstanding.map(i => i.id)).toEqual(['unpaid', 'partial'])
    expect(paid.map(i => i.id)).toEqual(['paid'])
  })

  it('treats a zero balance as paid even if the status still says UNPAID', () => {
    // Reconciliation can settle the balance before the status flips; the client
    // must never be asked to pay $0.00.
    const { outstanding, paid } = buildClientInvoiceSummary(
      [invoice({ status: 'UNPAID', amountPaidCents: 20_000 })],
      CARD_ON_FEE_ON,
    )
    expect(outstanding).toHaveLength(0)
    expect(paid[0].payableTotalCents).toBe(0)
    expect(paid[0].surchargeCents).toBe(0) // a settled invoice never sprouts a fee
  })

  it('orders outstanding oldest-first and paid newest-first', () => {
    const { outstanding, paid } = buildClientInvoiceSummary([
      invoice({ id: 'new', sentAt: D('2026-06-20'), createdAt: D('2026-06-20') }),
      invoice({ id: 'old', sentAt: D('2026-05-01'), createdAt: D('2026-05-01') }),
      invoice({ id: 'paid-old', status: 'PAID', amountPaidCents: 20_000, paidAt: D('2026-04-01') }),
      invoice({ id: 'paid-new', status: 'PAID', amountPaidCents: 20_000, paidAt: D('2026-06-15') }),
    ], CARD_ON_FEE_OFF)

    expect(outstanding.map(i => i.id)).toEqual(['old', 'new'])
    expect(paid.map(i => i.id)).toEqual(['paid-new', 'paid-old'])
  })
})

describe('buildClientInvoiceSummary — the number the client is quoted', () => {
  it('adds the SAME surcharge the pay page/checkout adds when the trainer passes the fee on', () => {
    const { outstanding } = buildClientInvoiceSummary([invoice()], CARD_ON_FEE_ON)
    const inv = outstanding[0]
    // Single source of truth — not a hand-rolled percentage.
    expect(inv.surchargeCents).toBe(estimateProcessingSurcharge(20_000, 'nzd'))
    expect(inv.payableTotalCents).toBe(20_000 + inv.surchargeCents)
  })

  it('adds no surcharge when the trainer absorbs the fee', () => {
    const { outstanding } = buildClientInvoiceSummary([invoice()], CARD_ON_FEE_OFF)
    expect(outstanding[0].surchargeCents).toBe(0)
    expect(outstanding[0].payableTotalCents).toBe(20_000)
  })

  it('surcharges the REMAINING balance on a partial, not the original total', () => {
    const { outstanding } = buildClientInvoiceSummary(
      [invoice({ status: 'PARTIAL', amountPaidCents: 15_000 })],
      CARD_ON_FEE_ON,
    )
    const inv = outstanding[0]
    expect(inv.balanceCents).toBe(5_000)
    expect(inv.surchargeCents).toBe(estimateProcessingSurcharge(5_000, 'nzd'))
    expect(inv.payableTotalCents).toBe(5_000 + inv.surchargeCents)
  })

  it('totals what the client owes across every outstanding invoice, incl. surcharge', () => {
    const { totalOutstandingCents, outstanding } = buildClientInvoiceSummary([
      invoice({ id: 'a', amountCents: 10_000 }),
      invoice({ id: 'b', amountCents: 5_000 }),
      invoice({ id: 'c', status: 'PAID', amountPaidCents: 9_900, amountCents: 9_900 }),
    ], CARD_ON_FEE_ON)
    expect(totalOutstandingCents).toBe(outstanding.reduce((s, i) => s + i.payableTotalCents, 0))
    expect(totalOutstandingCents).toBeGreaterThan(15_000) // fee is included
  })
})

describe('buildClientInvoiceSummary — pay links', () => {
  it('opens each invoice at its in-app page (no second invoice view/checkout)', () => {
    const { outstanding } = buildClientInvoiceSummary([invoice({ payToken: 'abc123' })], CARD_ON_FEE_ON)
    expect(outstanding[0].href).toBe('/my-invoices/abc123')
    expect(outstanding[0].canPayOnline).toBe(true)
  })

  it('a PAID invoice still opens (it reads as a receipt) but can’t be paid again', () => {
    const { paid } = buildClientInvoiceSummary(
      [invoice({ payToken: 'abc123', status: 'PAID', amountPaidCents: 20_000, paidAt: D('2026-06-10') })],
      CARD_ON_FEE_ON,
    )
    expect(paid[0].href).toBe('/my-invoices/abc123')
    expect(paid[0].canPayOnline).toBe(false)
  })

  it('still opens the invoice, but can’t take a card, when the trainer has no Stripe', () => {
    const noCard = buildClientInvoiceSummary([invoice()], { canTakeCard: false, passProcessingFeeToClient: false })
    expect(noCard.outstanding[0].href).toBe('/my-invoices/tok1')
    expect(noCard.outstanding[0].canPayOnline).toBe(false)
    expect(noCard.outstanding[0].surchargeCents).toBe(0) // no card → no card fee
  })

  it('offers no link at all when the invoice has no pay token', () => {
    const noToken = buildClientInvoiceSummary([invoice({ payToken: null })], CARD_ON_FEE_ON)
    expect(noToken.outstanding[0].href).toBeNull()
    expect(noToken.outstanding[0].canPayOnline).toBe(false)
  })
})

describe('formatMoney', () => {
  it('formats in the invoice currency', () => {
    expect(formatMoney(20_000, 'nzd')).toBe('$200.00')
    expect(formatMoney(1_234, 'gbp')).toBe('£12.34')
  })
})
