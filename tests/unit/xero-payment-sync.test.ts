import { it, expect, vi, beforeEach } from 'vitest'

// syncPaymentToXero — reconciles a settled Payment into Xero. Since the Stripe
// clearing-account refactor its job is ORCHESTRATION, not posting: it resolves
// the client's Xero contact, lazy-creates the ACCREC invoice if the payment has
// none, then delegates the actual money movement (payment → clearing, fee/
// surcharge legs) to postPaymentThroughClearing in @/lib/xero-clearing (which is
// exhaustively covered by tests/unit/xero-clearing.test.ts). Contract here:
//   - idempotent only when ALL THREE ids are set (payment + both fee legs);
//     xeroPaymentId alone no longer short-circuits (a run that posted the
//     payment then died on a fee must be able to resume)
//   - no-op when the trainer isn't connected (stays NOT_SYNCED)
//   - never touches a real Xero org for sandbox/demo money
//   - lazy-creates the invoice first when the payment has none
//   - passes { pending } straight through, recording nothing (Stripe fee not
//     known yet — retriable, NOT an error)
//   - records ERROR when the clearing post throws (e.g. bad account mapping)
const h = vi.hoisted(() => ({
  paymentFindUnique: vi.fn(),
  paymentUpdate: vi.fn(),
  productFindMany: vi.fn(),
  clientPackageFindMany: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  createXeroInvoice: vi.fn(),
  ensureXeroContact: vi.fn(),
  postPaymentThroughClearing: vi.fn(),
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
  ensureXeroContact: h.ensureXeroContact,
  createXeroInvoice: h.createXeroInvoice,
}))
vi.mock('@/lib/xero-clearing', () => ({
  postPaymentThroughClearing: h.postPaymentThroughClearing,
  // The lazy-invoice path (syncInvoiceToXero) filters surcharge lines off the
  // invoice; default them all to sale lines here.
  isSurchargeItem: () => false,
}))

import { syncPaymentToXero } from '@/lib/xero-sync'

const connection = { id: 'xc-1', salesAccountCode: '200', taxType: 'OUTPUT2', bankAccountCode: '090', tenantId: 't' }
const contact = 'C-1'

beforeEach(() => {
  vi.clearAllMocks()
  h.paymentUpdate.mockResolvedValue({})
  h.productFindMany.mockResolvedValue([])
  h.clientPackageFindMany.mockResolvedValue([{ id: 'clp-1', package: { xeroAccountCode: '210' } }])
  // Contact resolves from the persisted id — no ensureXeroContact API call.
  h.clientProfileFindUnique.mockResolvedValue({ id: 'cp-1', xeroContactId: contact })
})

function seedPayment(over: Record<string, unknown> = {}) {
  h.paymentFindUnique.mockResolvedValue({
    id: 'pay-1',
    clientId: 'cp-1', // used to resolve the Xero contact + lazy-create the invoice
    xeroInvoiceId: 'INV-1',
    xeroPaymentId: null,
    xeroFeeTxnId: null,
    xeroPlatformFeeTxnId: null,
    sandbox: false,
    paidAt: new Date('2026-06-15T09:30:00Z'),
    items: [{ unitAmount: 12500, quantity: 1, productId: null, clientPackageId: 'clp-1' }],
    trainer: { xeroConnection: connection },
    ...over,
  })
}

it('is idempotent when the payment is already fully reconciled (all three ids set)', async () => {
  // Payment posted AND both fee legs recorded — the state after a successful run.
  seedPayment({ xeroPaymentId: 'PAY-EXIST', xeroFeeTxnId: 'BT-STRIPE', xeroPlatformFeeTxnId: 'BT-PUP' })
  const res = await syncPaymentToXero('pay-1')
  expect(res).toEqual({ ok: true, xeroPaymentId: 'PAY-EXIST' })
  expect(h.postPaymentThroughClearing).not.toHaveBeenCalled()
})

it('resumes (does NOT short-circuit) when only the payment id is set but fees are missing', async () => {
  // Payment posted, then the run died before the fee legs — must retry, not skip.
  seedPayment({ xeroPaymentId: 'PAY-EXIST', xeroFeeTxnId: null, xeroPlatformFeeTxnId: null })
  h.postPaymentThroughClearing.mockResolvedValue({ ok: true, xeroPaymentId: 'PAY-EXIST' })
  await syncPaymentToXero('pay-1')
  expect(h.postPaymentThroughClearing).toHaveBeenCalled()
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
  expect(h.postPaymentThroughClearing).not.toHaveBeenCalled()
  expect(h.paymentUpdate).not.toHaveBeenCalled()
})

it('delegates to the clearing account and marks SYNCED', async () => {
  seedPayment()
  h.postPaymentThroughClearing.mockResolvedValue({ ok: true, xeroPaymentId: 'PAY-NEW' })

  const res = await syncPaymentToXero('pay-1')
  expect(res).toEqual({ ok: true, xeroPaymentId: 'PAY-NEW' })

  expect(h.postPaymentThroughClearing).toHaveBeenCalledWith({
    connection,
    paymentId: 'pay-1',
    xeroInvoiceId: 'INV-1',
    clientContactId: contact,
  })
  // did NOT need to create an invoice (payment already had one)
  expect(h.createXeroInvoice).not.toHaveBeenCalled()
  // syncPaymentToXero flips status only; the clearing layer persists xeroPaymentId itself.
  expect(h.paymentUpdate).toHaveBeenCalledWith({
    where: { id: 'pay-1' },
    data: { xeroSyncStatus: 'SYNCED', xeroSyncError: null },
  })
})

it('passes a pending clearing result straight through and records nothing', async () => {
  // Stripe hasn't reported its fee yet — retriable, NOT an error, write nothing.
  seedPayment()
  h.postPaymentThroughClearing.mockResolvedValue({ ok: false, pending: true, error: 'Waiting for Stripe' })

  const res = await syncPaymentToXero('pay-1')
  expect(res).toMatchObject({ ok: false, pending: true, error: 'Waiting for Stripe' })
  expect(h.paymentUpdate).not.toHaveBeenCalled()
})

it('lazily creates the invoice first when the payment has none', async () => {
  seedPayment({ xeroInvoiceId: null })
  h.createXeroInvoice.mockResolvedValue('INV-LAZY')
  h.postPaymentThroughClearing.mockResolvedValue({ ok: true, xeroPaymentId: 'PAY-NEW' })

  const res = await syncPaymentToXero('pay-1')
  expect(res.ok).toBe(true)
  expect(h.createXeroInvoice).toHaveBeenCalled() // invoice created on the fly
  expect(h.postPaymentThroughClearing.mock.calls[0][0].xeroInvoiceId).toBe('INV-LAZY')
})

it('records ERROR when the clearing post fails (e.g. bad account mapping)', async () => {
  seedPayment()
  h.postPaymentThroughClearing.mockRejectedValue(new Error('No Stripe clearing account is set'))

  const res = await syncPaymentToXero('pay-1')
  expect(res.ok).toBe(false)
  expect(res.error).toBe('No Stripe clearing account is set')
  expect(h.paymentUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ xeroSyncStatus: 'ERROR' }) }),
  )
})
