import { it, expect, vi, beforeEach } from 'vitest'

// syncInvoiceToXero — mirrors a Payment's invoice into Xero. Contract:
//   - idempotent (existing xeroInvoiceId short-circuits, no create)
//   - no-op when the trainer isn't connected (status left NOT_SYNCED)
//   - resolves each line's account: product code → package code → default sales
//   - persists SYNCED on success; ERROR (+ message) when an account is missing
const h = vi.hoisted(() => ({
  paymentFindUnique: vi.fn(),
  paymentUpdate: vi.fn(),
  productFindMany: vi.fn(),
  clientPackageFindMany: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  createXeroInvoice: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: { findUnique: h.paymentFindUnique, update: h.paymentUpdate },
    product: { findMany: h.productFindMany },
    clientPackage: { findMany: h.clientPackageFindMany },
    // ensureClientXeroContact (same module) resolves the contact via clientProfile;
    // a cached xeroContactId lets it short-circuit to a known id.
    clientProfile: { findUnique: h.clientProfileFindUnique, update: vi.fn() },
  },
}))
vi.mock('@/lib/xero', () => ({ ensureXeroContact: vi.fn(), createXeroInvoice: h.createXeroInvoice }))

import { syncInvoiceToXero } from '@/lib/xero-sync'

const connection = { id: 'xc-1', salesAccountCode: '200', taxType: 'OUTPUT2', tenantId: 't' }

beforeEach(() => {
  vi.clearAllMocks()
  h.paymentUpdate.mockResolvedValue({})
  h.productFindMany.mockResolvedValue([])
  h.clientPackageFindMany.mockResolvedValue([])
  // Client already has a Xero contact → ensureClientXeroContact returns 'C-1'.
  h.clientProfileFindUnique.mockResolvedValue({ id: 'cp-1', xeroContactId: 'C-1' })
})

function seedPayment(over: Record<string, unknown> = {}) {
  h.paymentFindUnique.mockResolvedValue({
    id: 'pay-1',
    clientId: 'cp-1',
    xeroInvoiceId: null,
    items: [{ description: 'Puppy Course', unitAmount: 12500, quantity: 1, productId: null, clientPackageId: 'clp-1' }],
    trainer: { xeroConnection: connection },
    ...over,
  })
}

it('is idempotent when the payment already has a Xero invoice', async () => {
  seedPayment({ xeroInvoiceId: 'INV-EXIST' })
  const res = await syncInvoiceToXero('pay-1')
  expect(res).toEqual({ ok: true, invoiceId: 'INV-EXIST' })
  expect(h.createXeroInvoice).not.toHaveBeenCalled()
})

it('no-ops (leaves NOT_SYNCED) when the trainer is not connected', async () => {
  seedPayment({ trainer: { xeroConnection: null } })
  const res = await syncInvoiceToXero('pay-1')
  expect(res.ok).toBe(false)
  expect(res.error).toBe('not connected')
  expect(h.paymentUpdate).not.toHaveBeenCalled()
})

it('never syncs sandbox/demo payments into a real Xero org', async () => {
  seedPayment({ sandbox: true })
  const res = await syncInvoiceToXero('pay-1')
  expect(res.error).toBe('sandbox')
  expect(h.createXeroInvoice).not.toHaveBeenCalled()
  expect(h.paymentUpdate).not.toHaveBeenCalled()
})

it('resolves the package account code, creates the invoice, and marks SYNCED', async () => {
  seedPayment()
  h.clientPackageFindMany.mockResolvedValue([{ id: 'clp-1', package: { xeroAccountCode: '210' } }])
  h.createXeroInvoice.mockResolvedValue('INV-NEW')

  const res = await syncInvoiceToXero('pay-1')
  expect(res).toEqual({ ok: true, invoiceId: 'INV-NEW' })

  const arg = h.createXeroInvoice.mock.calls[0][1]
  expect(arg.contactId).toBe('C-1')
  expect(arg.hasTax).toBe(true)
  expect(arg.lines[0]).toMatchObject({ accountCode: '210', unitAmountMinor: 12500, taxType: 'OUTPUT2' })
  expect(h.paymentUpdate).toHaveBeenCalledWith({
    where: { id: 'pay-1' },
    data: { xeroInvoiceId: 'INV-NEW', xeroSyncStatus: 'SYNCED', xeroSyncError: null },
  })
})

it('falls back to the default sales account when the item has no mapping', async () => {
  seedPayment()
  h.clientPackageFindMany.mockResolvedValue([{ id: 'clp-1', package: { xeroAccountCode: null } }])
  h.createXeroInvoice.mockResolvedValue('INV-NEW')

  await syncInvoiceToXero('pay-1')
  expect(h.createXeroInvoice.mock.calls[0][1].lines[0].accountCode).toBe('200')
})

it('records ERROR when no account is mapped and no default is set', async () => {
  seedPayment({ trainer: { xeroConnection: { ...connection, salesAccountCode: null } } })
  h.clientPackageFindMany.mockResolvedValue([{ id: 'clp-1', package: { xeroAccountCode: null } }])

  const res = await syncInvoiceToXero('pay-1')
  expect(res.ok).toBe(false)
  expect(h.createXeroInvoice).not.toHaveBeenCalled()
  expect(h.paymentUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ xeroSyncStatus: 'ERROR' }) }),
  )
})
