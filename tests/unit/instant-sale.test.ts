import { describe, it, expect, vi, beforeEach } from 'vitest'

// createManualSaleInvoice — the ad-hoc receivable behind the "instant sale"
// (POS) flow. Covers the arithmetic (multi-line totals), the idempotency that
// stops a double-tap double-charging, and the fail-loud contract that separates
// it from its best-effort siblings in this file.
const h = vi.hoisted(() => ({
  clientFindFirst: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceCreate: vi.fn(),
  trainerFindUnique: vi.fn(),
  after: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findFirst: h.clientFindFirst },
    invoice: { findFirst: h.invoiceFindFirst, create: h.invoiceCreate },
    trainerProfile: { findUnique: h.trainerFindUnique },
  },
}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: h.after,
}))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/push', () => ({ sendPush: vi.fn() }))
vi.mock('@/lib/xero', () => ({ createXeroInvoice: vi.fn(), fetchXeroInvoiceState: vi.fn() }))
vi.mock('@/lib/xero-sync', () => ({ ensureClientXeroContact: vi.fn() }))
vi.mock('@/lib/xero-clearing', () => ({ postPaymentThroughClearing: vi.fn(), isSurchargeItem: vi.fn() }))

import { createManualSaleInvoice } from '@/lib/invoicing'

const input = (over: Record<string, unknown> = {}) => ({
  trainerId: 'co_1',
  clientId: 'cl_1',
  lines: [{ description: 'Ball thrower', quantity: 1, unitAmountCents: 2500 }],
  idempotencyKey: 'sale_abcdef123456',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.clientFindFirst.mockResolvedValue({ id: 'cl_1' })
  h.invoiceFindFirst.mockResolvedValue(null)
  h.trainerFindUnique.mockResolvedValue({
    autoSendInvoices: false,
    payoutCurrency: 'nzd',
    businessName: 'Pawsome',
    sandboxBilling: false,
    xeroConnection: null,
  })
  h.invoiceCreate.mockImplementation(({ data }: { data: { amountCents: number } }) =>
    Promise.resolve({ id: 'inv_1', payToken: 'tok_1', amountCents: data.amountCents }),
  )
})

describe('createManualSaleInvoice — totals', () => {
  it('multiplies quantity by unit price on every line and sums them', async () => {
    await createManualSaleInvoice(input({
      lines: [
        { description: 'Ball thrower', quantity: 2, unitAmountCents: 2500 }, // 5000
        { description: 'Treat pouch', quantity: 3, unitAmountCents: 1200 },  // 3600
      ],
    }))

    const { data } = h.invoiceCreate.mock.calls[0][0]
    expect(data.amountCents).toBe(8600)
    expect(data.lines.create).toEqual([
      expect.objectContaining({ description: 'Ball thrower', quantity: 2, unitAmountCents: 2500, amountCents: 5000, sortOrder: 0 }),
      expect.objectContaining({ description: 'Treat pouch', quantity: 3, unitAmountCents: 1200, amountCents: 3600, sortOrder: 1 }),
    ])
  })

  it('raises the invoice UNPAID in the trainer’s payout currency', async () => {
    h.trainerFindUnique.mockResolvedValue({
      autoSendInvoices: false, payoutCurrency: 'aud', businessName: 'Pawsome',
      sandboxBilling: false, xeroConnection: null,
    })

    await createManualSaleInvoice(input())

    const { data } = h.invoiceCreate.mock.calls[0][0]
    expect(data.status).toBe('UNPAID')
    expect(data.currency).toBe('aud')
  })

  it('falls back to nzd when the trainer has no payout currency set', async () => {
    h.trainerFindUnique.mockResolvedValue({
      autoSendInvoices: false, payoutCurrency: null, businessName: 'Pawsome',
      sandboxBilling: false, xeroConnection: null,
    })

    await createManualSaleInvoice(input())

    expect(h.invoiceCreate.mock.calls[0][0].data.currency).toBe('nzd')
  })

  it('tags the sale MANUAL so it is distinguishable from assignment invoices', async () => {
    await createManualSaleInvoice(input())

    const { data } = h.invoiceCreate.mock.calls[0][0]
    expect(data.sourceType).toBe('MANUAL')
    expect(data.sourceId).toBe('sale_abcdef123456')
  })
})

describe('createManualSaleInvoice — labelling', () => {
  it('labels a single-line sale with that line', async () => {
    await createManualSaleInvoice(input())

    expect(h.invoiceCreate.mock.calls[0][0].data.description).toBe('Ball thrower')
  })

  it('summarises a multi-line sale as "first +N more"', async () => {
    await createManualSaleInvoice(input({
      lines: [
        { description: 'Ball thrower', quantity: 1, unitAmountCents: 2500 },
        { description: 'Treat pouch', quantity: 1, unitAmountCents: 1200 },
        { description: 'Long line', quantity: 1, unitAmountCents: 800 },
      ],
    }))

    expect(h.invoiceCreate.mock.calls[0][0].data.description).toBe('Ball thrower +2 more')
  })
})

describe('createManualSaleInvoice — idempotency', () => {
  it('returns the existing invoice and creates nothing on a repeat key', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv_existing', payToken: 'tok_existing', amountCents: 2500 })

    const res = await createManualSaleInvoice(input())

    expect(res).toEqual({ id: 'inv_existing', payToken: 'tok_existing', amountCents: 2500 })
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('looks the key up scoped to trainer + client + MANUAL', async () => {
    await createManualSaleInvoice(input())

    expect(h.invoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          trainerId: 'co_1',
          clientId: 'cl_1',
          sourceType: 'MANUAL',
          sourceId: 'sale_abcdef123456',
        },
      }),
    )
  })
})

describe('createManualSaleInvoice — fails loudly', () => {
  it('throws (never silently returns) when the client is not this trainer’s', async () => {
    h.clientFindFirst.mockResolvedValue(null)

    await expect(createManualSaleInvoice(input())).rejects.toThrow(/client not found/i)
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('throws when there are no lines', async () => {
    await expect(createManualSaleInvoice(input({ lines: [] }))).rejects.toThrow(/at least one line/i)
  })

  it('throws when the sale totals zero', async () => {
    await expect(
      createManualSaleInvoice(input({ lines: [{ description: 'Freebie', quantity: 1, unitAmountCents: 0 }] })),
    ).rejects.toThrow(/above zero/i)
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('throws when the trainer cannot be resolved', async () => {
    h.trainerFindUnique.mockResolvedValue(null)

    await expect(createManualSaleInvoice(input())).rejects.toThrow(/trainer not found/i)
  })
})

describe('createManualSaleInvoice — sending', () => {
  it('leaves sentAt null when the trainer has auto-send off', async () => {
    await createManualSaleInvoice(input())

    expect(h.invoiceCreate.mock.calls[0][0].data.sentAt).toBeNull()
  })

  it('stamps sentAt when the trainer has auto-send on', async () => {
    h.trainerFindUnique.mockResolvedValue({
      autoSendInvoices: true, payoutCurrency: 'nzd', businessName: 'Pawsome',
      sandboxBilling: false, xeroConnection: null,
    })

    await createManualSaleInvoice(input())

    expect(h.invoiceCreate.mock.calls[0][0].data.sentAt).toBeInstanceOf(Date)
  })

  it('defers side effects rather than blocking the sale on email/Xero', async () => {
    await createManualSaleInvoice(input())

    // The trainer is standing in front of the client — the response must not
    // wait on Resend/Xero round-trips.
    expect(h.after).toHaveBeenCalledTimes(1)
  })

  it('returns the payToken so the caller can render the QR pay link', async () => {
    const res = await createManualSaleInvoice(input())

    expect(res.payToken).toBe('tok_1')
  })
})
