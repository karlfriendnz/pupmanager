import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Stripe CLEARING model — the thing that makes a trainer's Xero actually
// reconcile against their bank feed.
//
// These are DIRECT charges: Stripe deducts its processing fee AND our
// application fee before any money reaches the trainer's bank. So the gross the
// client paid is posted to a clearing account, both fees are expensed out of it,
// and the balance left is exactly what Stripe pays out. Contract:
//   - gross goes to CLEARING, never the bank
//   - both fee expenses written, with the right amounts, to the fee account
//   - INVARIANT: gross − stripeFee − ourFee === what the bank receives
//   - works whether the CLIENT pays the card fee or the TRAINER absorbs it
//   - a missing clearing/fee mapping → actionable error, nothing posted
//   - stripeFeeAmount null → post NOTHING, never guess a fee
//   - idempotent: a webhook retry must not double-post any leg
const h = vi.hoisted(() => ({
  paymentFindUnique: vi.fn(),
  paymentUpdate: vi.fn(),
  createXeroPayment: vi.fn(),
  createXeroBankTransaction: vi.fn(),
  ensureXeroContactByName: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { payment: { findUnique: h.paymentFindUnique, update: h.paymentUpdate } },
}))
vi.mock('@/lib/xero', () => ({
  createXeroPayment: h.createXeroPayment,
  createXeroBankTransaction: h.createXeroBankTransaction,
  ensureXeroContactByName: h.ensureXeroContactByName,
}))

import {
  postPaymentThroughClearing,
  clearingBreakdown,
  requireClearingAccounts,
  surchargeMinor,
  invoiceMinor,
} from '@/lib/xero-clearing'
import type { XeroConnection } from '@/generated/prisma'

// A fully-mapped connection: real bank 090, Stripe clearing 091, fees to 404.
const connection = {
  id: 'xc-1',
  tenantId: 't',
  bankAccountCode: '090',
  clearingAccountCode: '091',
  feeAccountCode: '404',
  salesAccountCode: '200',
  surchargeAccountCode: null,
  taxType: 'OUTPUT2',
} as unknown as XeroConnection

// ─── The worked example ───────────────────────────────────────────────────────
// A $150 package, NZD, with the card fee passed to the client:
//   client's card charged  $155.75  (15000 sale + 575 surcharge)
//   Stripe fee             − $4.43
//   PupManager app fee     − $1.32
//   lands in bank           $150.00
const SALE = 15000
const SURCHARGE = 575
const GROSS = SALE + SURCHARGE // 15575
const STRIPE_FEE = 443
const APP_FEE = 132

const surchargeItem = { unitAmount: SURCHARGE, quantity: 1, intent: { surcharge: true } }
const saleItem = { unitAmount: SALE, quantity: 1, intent: null }

function seedPayment(over: Record<string, unknown> = {}) {
  h.paymentFindUnique.mockResolvedValue({
    id: 'pay-1',
    amountTotal: GROSS,
    applicationFeeAmount: APP_FEE,
    stripeFeeAmount: STRIPE_FEE,
    paidAt: new Date('2026-07-14T09:30:00Z'),
    xeroPaymentId: null,
    xeroSurchargeTxnId: null,
    xeroFeeTxnId: null,
    xeroPlatformFeeTxnId: null,
    items: [saleItem, surchargeItem],
    ...over,
  })
}

function post() {
  return postPaymentThroughClearing({
    connection,
    paymentId: 'pay-1',
    xeroInvoiceId: 'INV-1',
    clientContactId: 'C-1',
  })
}

/** The bank transactions created, keyed by their description. */
function txns() {
  return h.createXeroBankTransaction.mock.calls.map((c) => c[1])
}
function txnFor(description: string) {
  return txns().find((t) => t.description === description)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.paymentUpdate.mockResolvedValue({})
  h.createXeroPayment.mockResolvedValue('PAY-NEW')
  h.ensureXeroContactByName.mockImplementation((_c: unknown, name: string) =>
    Promise.resolve(name === 'Stripe' ? 'C-STRIPE' : 'C-PUP'),
  )
  h.createXeroBankTransaction.mockImplementation((_c: unknown, input: { type: string; description: string }) =>
    Promise.resolve(input.description.startsWith('Stripe') ? 'BT-STRIPE' : input.type === 'RECEIVE' ? 'BT-SUR' : 'BT-PUP'),
  )
})

// ─── Pure money math ──────────────────────────────────────────────────────────

describe('the money breakdown', () => {
  it('splits the gross into sale + surcharge', () => {
    expect(surchargeMinor([saleItem, surchargeItem])).toBe(575)
    expect(invoiceMinor([saleItem, surchargeItem])).toBe(15000)
  })

  it('counts no surcharge when the trainer absorbs the card fee', () => {
    expect(surchargeMinor([saleItem])).toBe(0)
    expect(invoiceMinor([saleItem])).toBe(15000)
  })

  it('holds the invariant: gross − stripeFee − ourFee === what the bank receives', () => {
    const b = clearingBreakdown({
      amountTotal: GROSS,
      applicationFeeAmount: APP_FEE,
      stripeFeeAmount: STRIPE_FEE,
      items: [saleItem, surchargeItem],
    })
    expect(b).toEqual({
      grossMinor: 15575,
      invoiceMinor: 15000,
      surchargeMinor: 575,
      stripeFeeMinor: 443,
      platformFeeMinor: 132,
      netToBankMinor: 15000, // the trainer nets the full $150 they sold
    })
    // Money in to clearing minus money out of it IS the payout that hits the bank.
    expect(b.invoiceMinor + b.surchargeMinor - b.stripeFeeMinor - b.platformFeeMinor).toBe(b.netToBankMinor)
  })

  it('holds the same invariant when the TRAINER absorbs the fee (bank gets less than the invoice)', () => {
    const b = clearingBreakdown({
      amountTotal: SALE, // client charged only the $150 — no surcharge
      applicationFeeAmount: APP_FEE,
      stripeFeeAmount: STRIPE_FEE,
      items: [saleItem],
    })
    expect(b.grossMinor).toBe(15000)
    expect(b.surchargeMinor).toBe(0)
    // The bank receives $144.25 — LESS than the $150 invoice. This is the case the
    // old code got wrong every single time: it told Xero $150.00 hit the bank.
    expect(b.netToBankMinor).toBe(14425)
    expect(b.invoiceMinor + b.surchargeMinor - b.stripeFeeMinor - b.platformFeeMinor).toBe(b.netToBankMinor)
  })

  it('refuses to compute a breakdown with an unknown Stripe fee', () => {
    expect(() =>
      clearingBreakdown({ amountTotal: GROSS, applicationFeeAmount: APP_FEE, stripeFeeAmount: null, items: [] }),
    ).toThrow(/isn’t known yet/)
  })
})

// ─── Account mapping guards ───────────────────────────────────────────────────

describe('account mapping', () => {
  it('errors actionably when no clearing account is mapped', () => {
    expect(() => requireClearingAccounts({ ...connection, clearingAccountCode: null } as XeroConnection))
      .toThrow(/No Stripe clearing account is set.*Settings → Integrations/s)
  })

  it('errors actionably when no fee expense account is mapped', () => {
    expect(() => requireClearingAccounts({ ...connection, feeAccountCode: null } as XeroConnection))
      .toThrow(/No Xero expense account is set for payment fees/)
  })

  it('refuses a clearing account that IS the bank account (the broken posting it exists to prevent)', () => {
    expect(() => requireClearingAccounts({ ...connection, clearingAccountCode: '090' } as XeroConnection))
      .toThrow(/same/)
  })

  it('falls back to the default sales account for surcharge income', () => {
    expect(requireClearingAccounts(connection).surchargeAccountCode).toBe('200')
    const explicit = { ...connection, surchargeAccountCode: '260' } as XeroConnection
    expect(requireClearingAccounts(explicit).surchargeAccountCode).toBe('260')
  })
})

// ─── Posting ──────────────────────────────────────────────────────────────────

describe('posting a payment through the clearing account', () => {
  it('posts the payment to CLEARING, never the bank', async () => {
    seedPayment()
    await post()

    const payment = h.createXeroPayment.mock.calls[0][1]
    expect(payment.accountCode).toBe('091') // the clearing account
    expect(payment.accountCode).not.toBe('090') // NOT the bank account
    expect(payment.invoiceId).toBe('INV-1')
    // The payment settles the invoice total — the surcharge rides in separately,
    // so the invoice is never overpaid (Xero would reject that).
    expect(payment.amountMinor).toBe(15000)
  })

  it('writes BOTH fee expenses out of clearing, with the right amounts and account', async () => {
    seedPayment()
    await post()

    const stripeFee = txnFor('Stripe card processing fee')
    expect(stripeFee).toMatchObject({
      type: 'SPEND',
      bankAccountCode: '091', // out of clearing
      accountCode: '404', // the fee expense account
      amountMinor: 443,
      contactId: 'C-STRIPE',
    })

    const ourFee = txnFor('PupManager payment fee')
    expect(ourFee).toMatchObject({
      type: 'SPEND',
      bankAccountCode: '091',
      accountCode: '404',
      amountMinor: 132,
      contactId: 'C-PUP',
    })
  })

  it('books the client-paid surcharge as income RECEIVED into clearing', async () => {
    seedPayment()
    await post()

    expect(txnFor('Card processing fee recovered from client')).toMatchObject({
      type: 'RECEIVE',
      bankAccountCode: '091',
      accountCode: '200', // revenue — the trainer received this money
      amountMinor: 575,
      contactId: 'C-1',
    })
  })

  it('leaves the clearing account holding exactly what Stripe pays into the bank', async () => {
    seedPayment()
    await post()

    const into = h.createXeroPayment.mock.calls[0][1].amountMinor
      + txns().filter((t) => t.type === 'RECEIVE').reduce((s, t) => s + t.amountMinor, 0)
    const outOf = txns().filter((t) => t.type === 'SPEND').reduce((s, t) => s + t.amountMinor, 0)

    expect(into).toBe(GROSS) // everything the client's card was charged
    expect(outOf).toBe(STRIPE_FEE + APP_FEE)
    expect(into - outOf).toBe(15000) // === the payout that lands in the bank feed
  })

  it('TRAINER ABSORBS THE FEE: no surcharge entry, and clearing nets less than the invoice', async () => {
    seedPayment({ amountTotal: SALE, items: [saleItem] })
    await post()

    // No surcharge to receive — the client only ever paid the $150.
    expect(txnFor('Card processing fee recovered from client')).toBeUndefined()
    expect(h.createXeroPayment.mock.calls[0][1].amountMinor).toBe(15000)

    // Both fees still come out of clearing, so it settles at $144.25 — exactly
    // what Stripe will pay out, and exactly what the bank feed will show.
    const outOf = txns().filter((t) => t.type === 'SPEND').reduce((s, t) => s + t.amountMinor, 0)
    expect(SALE - outOf).toBe(14425)
  })

  it('POSTS NOTHING when Stripe has not reported its fee yet — never guesses a number', async () => {
    seedPayment({ stripeFeeAmount: null })

    const res = await post()
    expect(res).toMatchObject({ ok: false, pending: true })
    expect(res.error).toMatch(/Waiting for Stripe/)

    // Not one entry may be written: a payment posted without its fees would leave
    // the clearing account permanently out of balance.
    expect(h.createXeroPayment).not.toHaveBeenCalled()
    expect(h.createXeroBankTransaction).not.toHaveBeenCalled()
    expect(h.paymentUpdate).not.toHaveBeenCalled()
  })

  it('posts nothing when the clearing account is not mapped, and says so actionably', async () => {
    seedPayment()
    await expect(
      postPaymentThroughClearing({
        connection: { ...connection, clearingAccountCode: null } as XeroConnection,
        paymentId: 'pay-1',
        xeroInvoiceId: 'INV-1',
        clientContactId: 'C-1',
      }),
    ).rejects.toThrow(/No Stripe clearing account is set/)

    expect(h.createXeroPayment).not.toHaveBeenCalled()
    expect(h.createXeroBankTransaction).not.toHaveBeenCalled()
  })

  it('posts nothing when the fee expense account is not mapped', async () => {
    seedPayment()
    await expect(
      postPaymentThroughClearing({
        connection: { ...connection, feeAccountCode: null } as XeroConnection,
        paymentId: 'pay-1',
        xeroInvoiceId: 'INV-1',
        clientContactId: 'C-1',
      }),
    ).rejects.toThrow(/No Xero expense account is set for payment fees/)

    expect(h.createXeroPayment).not.toHaveBeenCalled()
    expect(h.createXeroBankTransaction).not.toHaveBeenCalled()
  })

  it('IDEMPOTENT: a webhook retry re-posts nothing', async () => {
    // Every leg already has its Xero id — the state after a successful first run.
    seedPayment({
      xeroPaymentId: 'PAY-EXIST',
      xeroSurchargeTxnId: 'BT-SUR',
      xeroFeeTxnId: 'BT-STRIPE',
      xeroPlatformFeeTxnId: 'BT-PUP',
    })

    const res = await post()
    expect(res).toMatchObject({ ok: true, xeroPaymentId: 'PAY-EXIST' })
    expect(h.createXeroPayment).not.toHaveBeenCalled()
    expect(h.createXeroBankTransaction).not.toHaveBeenCalled()
  })

  it('resumes a part-posted payment without duplicating the legs that landed', async () => {
    // The payment + Stripe fee posted, then the run died before our fee.
    seedPayment({ xeroPaymentId: 'PAY-EXIST', xeroSurchargeTxnId: 'BT-SUR', xeroFeeTxnId: 'BT-STRIPE' })

    await post()
    expect(h.createXeroPayment).not.toHaveBeenCalled() // not re-paid
    expect(h.createXeroBankTransaction).toHaveBeenCalledTimes(1) // only the missing leg
    expect(h.createXeroBankTransaction.mock.calls[0][1]).toMatchObject({
      description: 'PupManager payment fee',
      amountMinor: 132,
    })
  })

  it('persists each leg id as it is created, so a crash mid-way is resumable', async () => {
    seedPayment()
    await post()

    const written = Object.assign({}, ...h.paymentUpdate.mock.calls.map((c) => c[0].data))
    expect(written).toEqual({
      xeroPaymentId: 'PAY-NEW',
      xeroSurchargeTxnId: 'BT-SUR',
      xeroFeeTxnId: 'BT-STRIPE',
      xeroPlatformFeeTxnId: 'BT-PUP',
    })
  })
})
