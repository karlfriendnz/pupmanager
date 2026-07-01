import { it, expect, vi, beforeEach } from 'vitest'

// syncPaymentToXero — records a settled Payment against its Xero invoice.
// Contract:
//   - idempotent (existing xeroPaymentId → no-op)
//   - no-op when the trainer isn't connected
//   - applies exactly the invoice total (sum of line items), NOT amountTotal
//   - lazy-creates the invoice first when the payment has none
//   - ERROR when no bank account is configured
const h = vi.hoisted(() => ({
  paymentFindUnique: vi.fn(),
  paymentUpdate: vi.fn(),
  productFindMany: vi.fn(),
  clientPackageFindMany: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  createXeroInvoice: vi.fn(),
  createXeroPayment: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: { findUnique: h.paymentFindUnique, update: h.paymentUpdate },
    product: { findMany: h.productFindMany },
    clientPackage: { findMany: h.clientPackageFindMany },
    clientProfile: { findUnique: h.clientProfileFindUnique, update: vi.fn() },
  },
}))
vi.mock('@/lib/xero', () => ({
  ensureXeroContact: vi.fn(),
  createXeroInvoice: h.createXeroInvoice,
  createXeroPayment: h.createXeroPayment,
}))

import { syncPaymentToXero } from '@/lib/xero-sync'

const connection = { id: 'xc-1', salesAccountCode: '200', taxType: 'OUTPUT2', bankAccountCode: '090', tenantId: 't' }

beforeEach(() => {
  vi.clearAllMocks()
  h.paymentUpdate.mockResolvedValue({})
  h.productFindMany.mockResolvedValue([])
  h.clientPackageFindMany.mockResolvedValue([{ id: 'clp-1', package: { xeroAccountCode: '210' } }])
  h.clientProfileFindUnique.mockResolvedValue({ id: 'cp-1', xeroContactId: 'C-1' })
})

function seedPayment(over: Record<string, unknown> = {}) {
  h.paymentFindUnique.mockResolvedValue({
    id: 'pay-1',
    clientId: 'cp-1', // used when the invoice is lazily created via syncInvoiceToXero
    xeroInvoiceId: 'INV-1',
    xeroPaymentId: null,
    paidAt: new Date('2026-06-15T09:30:00Z'),
    items: [{ unitAmount: 12500, quantity: 1, productId: null, clientPackageId: 'clp-1' }],
    trainer: { xeroConnection: connection },
    ...over,
  })
}

it('is idempotent when the payment is already reconciled', async () => {
  seedPayment({ xeroPaymentId: 'PAY-EXIST' })
  const res = await syncPaymentToXero('pay-1')
  expect(res).toEqual({ ok: true, xeroPaymentId: 'PAY-EXIST' })
  expect(h.createXeroPayment).not.toHaveBeenCalled()
})

it('no-ops when the trainer is not connected', async () => {
  seedPayment({ trainer: { xeroConnection: null } })
  const res = await syncPaymentToXero('pay-1')
  expect(res.error).toBe('not connected')
  expect(h.paymentUpdate).not.toHaveBeenCalled()
})

it('never reconciles sandbox/demo payments into a real Xero org', async () => {
  seedPayment({ sandbox: true })
  const res = await syncPaymentToXero('pay-1')
  expect(res.error).toBe('sandbox')
  expect(h.createXeroPayment).not.toHaveBeenCalled()
  expect(h.paymentUpdate).not.toHaveBeenCalled()
})

it('applies the invoice-total payment and marks SYNCED', async () => {
  seedPayment()
  h.createXeroPayment.mockResolvedValue('PAY-NEW')

  const res = await syncPaymentToXero('pay-1')
  expect(res).toEqual({ ok: true, xeroPaymentId: 'PAY-NEW' })

  const arg = h.createXeroPayment.mock.calls[0][1]
  expect(arg).toMatchObject({ invoiceId: 'INV-1', accountCode: '090', amountMinor: 12500 })
  // did NOT need to create an invoice (payment already had one)
  expect(h.createXeroInvoice).not.toHaveBeenCalled()
  expect(h.paymentUpdate).toHaveBeenCalledWith({
    where: { id: 'pay-1' },
    data: { xeroPaymentId: 'PAY-NEW', xeroSyncStatus: 'SYNCED', xeroSyncError: null },
  })
})

it('sums multiple line items for the payment amount', async () => {
  seedPayment({ items: [{ unitAmount: 5000, quantity: 2 }, { unitAmount: 2500, quantity: 1 }] })
  h.createXeroPayment.mockResolvedValue('PAY-NEW')
  await syncPaymentToXero('pay-1')
  expect(h.createXeroPayment.mock.calls[0][1].amountMinor).toBe(12500) // 5000*2 + 2500
})

it('lazily creates the invoice first when the payment has none', async () => {
  seedPayment({ xeroInvoiceId: null })
  h.createXeroInvoice.mockResolvedValue('INV-LAZY')
  h.createXeroPayment.mockResolvedValue('PAY-NEW')

  const res = await syncPaymentToXero('pay-1')
  expect(res.ok).toBe(true)
  expect(h.createXeroInvoice).toHaveBeenCalled() // invoice created on the fly
  expect(h.createXeroPayment.mock.calls[0][1].invoiceId).toBe('INV-LAZY')
})

it('records ERROR when no bank account is configured', async () => {
  seedPayment({ trainer: { xeroConnection: { ...connection, bankAccountCode: null } } })
  const res = await syncPaymentToXero('pay-1')
  expect(res.ok).toBe(false)
  expect(h.createXeroPayment).not.toHaveBeenCalled()
  expect(h.paymentUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ xeroSyncStatus: 'ERROR' }) }),
  )
})
