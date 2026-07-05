import { it, expect, vi, beforeEach, describe } from 'vitest'

// createInvoiceForAssignment — raises a payment-method-agnostic receivable when
// a priced package/product is assigned. Contract:
//   - creates an UNPAID Invoice for specialPriceCents ?? priceCents
//   - idempotent per (trainer, client, sourceType, sourceId)
//   - skips zero / unpriced items
//   - autoSendInvoices toggles sentAt + client notification
//   - pushes to Xero only when the trainer is connected
//   - never throws — a failure returns null and never breaks the assignment
const h = vi.hoisted(() => ({
  clientPackageFindFirst: vi.fn(),
  clientPackageFindUnique: vi.fn(),
  productFindFirst: vi.fn(),
  productFindUnique: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceFindUnique: vi.fn(),
  invoiceFindMany: vi.fn(),
  invoiceCreate: vi.fn(),
  invoiceUpdate: vi.fn(),
  trainerFindUnique: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  notificationCreate: vi.fn(),
  sendEmail: vi.fn(),
  sendPush: vi.fn(),
  ensureClientXeroContact: vi.fn(),
  createXeroInvoice: vi.fn(),
  fetchXeroInvoiceState: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientPackage: { findFirst: h.clientPackageFindFirst, findUnique: h.clientPackageFindUnique },
    product: { findFirst: h.productFindFirst, findUnique: h.productFindUnique },
    invoice: { findFirst: h.invoiceFindFirst, findUnique: h.invoiceFindUnique, findMany: h.invoiceFindMany, create: h.invoiceCreate, update: h.invoiceUpdate },
    trainerProfile: { findUnique: h.trainerFindUnique },
    clientProfile: { findUnique: h.clientProfileFindUnique },
    notification: { create: h.notificationCreate },
  },
}))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail }))
vi.mock('@/lib/push', () => ({ sendPush: h.sendPush }))
vi.mock('@/lib/xero-sync', () => ({ ensureClientXeroContact: h.ensureClientXeroContact }))
vi.mock('@/lib/xero', () => ({ createXeroInvoice: h.createXeroInvoice, fetchXeroInvoiceState: h.fetchXeroInvoiceState }))
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }))

import {
  createInvoiceForAssignment,
  applyPaidAmount,
  reconcileXeroPayment,
  reconcileTrainerXeroPayments,
  reconcileAllXeroPayments,
  sendReceivable,
} from '@/lib/invoicing'

const PKG = { name: 'Puppy Course', priceCents: 12500, specialPriceCents: null, xeroAccountCode: null }

function seedTrainer(over: Record<string, unknown> = {}) {
  h.trainerFindUnique.mockResolvedValue({
    autoSendInvoices: false,
    payoutCurrency: 'nzd',
    businessName: 'Pawsome',
    sandboxBilling: false,
    xeroConnection: null,
    ...over,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.clientPackageFindFirst.mockResolvedValue({ package: PKG })
  h.invoiceFindFirst.mockResolvedValue(null)
  h.invoiceCreate.mockResolvedValue({ id: 'inv-1' })
  h.invoiceUpdate.mockResolvedValue({})
  h.clientProfileFindUnique.mockResolvedValue({ userId: 'u-1', user: { email: 'c@x.com' } })
  h.notificationCreate.mockResolvedValue({})
  h.sendEmail.mockResolvedValue(undefined)
  h.sendPush.mockResolvedValue(undefined)
  seedTrainer()
})

describe('createInvoiceForAssignment', () => {
  it('creates an UNPAID invoice for a priced package (special price wins)', async () => {
    h.clientPackageFindFirst.mockResolvedValue({ package: { ...PKG, specialPriceCents: 9900 } })
    const id = await createInvoiceForAssignment({ trainerId: 't-1', clientId: 'cp-1', sourceType: 'PACKAGE', clientPackageId: 'clp-1' })

    expect(id).toBe('inv-1')
    const data = h.invoiceCreate.mock.calls[0][0].data
    expect(data).toMatchObject({
      trainerId: 't-1', clientId: 'cp-1', amountCents: 9900, currency: 'nzd',
      status: 'UNPAID', description: 'Puppy Course', sourceType: 'PACKAGE', sourceId: 'clp-1',
    })
    expect(data.sentAt).toBeNull()
    // Every invoice is created with >=1 line (matching the total).
    expect(data.lines.create).toEqual([
      { description: 'Puppy Course', quantity: 1, unitAmountCents: 9900, amountCents: 9900, sortOrder: 0 },
    ])
  })

  it('is idempotent — a repeat assignment returns the existing invoice and never re-creates', async () => {
    h.invoiceFindFirst.mockResolvedValue({ id: 'inv-existing' })
    const id = await createInvoiceForAssignment({ trainerId: 't-1', clientId: 'cp-1', sourceType: 'PACKAGE', clientPackageId: 'clp-1' })
    expect(id).toBe('inv-existing')
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('skips zero / unpriced items', async () => {
    h.clientPackageFindFirst.mockResolvedValue({ package: { ...PKG, priceCents: null, specialPriceCents: null } })
    const id = await createInvoiceForAssignment({ trainerId: 't-1', clientId: 'cp-1', sourceType: 'PACKAGE', clientPackageId: 'clp-1' })
    expect(id).toBeNull()
    expect(h.invoiceCreate).not.toHaveBeenCalled()
  })

  it('leaves sentAt null and does NOT notify when autoSendInvoices is off', async () => {
    await createInvoiceForAssignment({ trainerId: 't-1', clientId: 'cp-1', sourceType: 'PACKAGE', clientPackageId: 'clp-1' })
    expect(h.invoiceCreate.mock.calls[0][0].data.sentAt).toBeNull()
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.notificationCreate).not.toHaveBeenCalled()
  })

  it('stamps sentAt and notifies the client when autoSendInvoices is on', async () => {
    seedTrainer({ autoSendInvoices: true })
    await createInvoiceForAssignment({ trainerId: 't-1', clientId: 'cp-1', sourceType: 'PACKAGE', clientPackageId: 'clp-1' })
    expect(h.invoiceCreate.mock.calls[0][0].data.sentAt).toBeInstanceOf(Date)
    expect(h.notificationCreate).toHaveBeenCalledTimes(1)
    expect(h.sendPush).toHaveBeenCalledTimes(1)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('pushes to Xero only when the trainer is connected', async () => {
    // Not connected → no Xero call.
    await createInvoiceForAssignment({ trainerId: 't-1', clientId: 'cp-1', sourceType: 'PACKAGE', clientPackageId: 'clp-1' })
    expect(h.createXeroInvoice).not.toHaveBeenCalled()

    // Connected → invoice mirrored into Xero.
    vi.clearAllMocks()
    h.clientPackageFindFirst.mockResolvedValue({ package: PKG })
    h.invoiceFindFirst.mockResolvedValue(null)
    h.invoiceCreate.mockResolvedValue({ id: 'inv-1' })
    h.invoiceUpdate.mockResolvedValue({})
    const connection = { id: 'xc-1', salesAccountCode: '200', taxType: 'OUTPUT2' }
    seedTrainer({ xeroConnection: { id: 'xc-1' } })
    h.invoiceFindUnique.mockResolvedValue({
      id: 'inv-1', clientId: 'cp-1', description: 'Puppy Course', amountCents: 12500,
      sourceType: 'PACKAGE', sourceId: 'clp-1', xeroInvoiceId: null,
      lines: [{ description: 'Puppy Course', quantity: 1, unitAmountCents: 12500, xeroAccountCode: null }],
      trainer: { sandboxBilling: false, xeroConnection: connection },
    })
    h.ensureClientXeroContact.mockResolvedValue('C-1')
    h.clientPackageFindUnique.mockResolvedValue({ package: { xeroAccountCode: null } })
    h.createXeroInvoice.mockResolvedValue('XINV-1')

    await createInvoiceForAssignment({ trainerId: 't-1', clientId: 'cp-1', sourceType: 'PACKAGE', clientPackageId: 'clp-1' })
    expect(h.createXeroInvoice).toHaveBeenCalledTimes(1)
    // Falls back to the connection's default sales account.
    expect(h.createXeroInvoice.mock.calls[0][1].lines[0].accountCode).toBe('200')
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { xeroInvoiceId: 'XINV-1', xeroSyncStatus: 'SYNCED', xeroSyncError: null },
    })
  })

  it('pushes ALL lines to Xero, resolving each line’s account (line → source → default)', async () => {
    const connection = { id: 'xc-1', salesAccountCode: '200', taxType: 'OUTPUT2' }
    seedTrainer({ xeroConnection: { id: 'xc-1' } })
    h.invoiceFindUnique.mockResolvedValue({
      id: 'inv-1', clientId: 'cp-1', description: '2 items', amountCents: 15000,
      sourceType: 'PACKAGE', sourceId: 'clp-1', xeroInvoiceId: null,
      lines: [
        { description: 'Course', quantity: 1, unitAmountCents: 12500, xeroAccountCode: null }, // → source/default
        { description: 'Treats', quantity: 2, unitAmountCents: 1250, xeroAccountCode: '215' }, // → own code
      ],
      trainer: { sandboxBilling: false, xeroConnection: connection },
    })
    h.ensureClientXeroContact.mockResolvedValue('C-1')
    h.clientPackageFindUnique.mockResolvedValue({ package: { xeroAccountCode: '210' } })
    h.createXeroInvoice.mockResolvedValue('XINV-1')

    await createInvoiceForAssignment({ trainerId: 't-1', clientId: 'cp-1', sourceType: 'PACKAGE', clientPackageId: 'clp-1' })
    const lines = h.createXeroInvoice.mock.calls[0][1].lines
    expect(lines).toHaveLength(2)
    // Line 1: no own code → invoice source (package) code 210.
    expect(lines[0]).toMatchObject({ description: 'Course', quantity: 1, unitAmountMinor: 12500, accountCode: '210' })
    // Line 2: its own code 215 wins, quantity preserved.
    expect(lines[1]).toMatchObject({ description: 'Treats', quantity: 2, unitAmountMinor: 1250, accountCode: '215' })
  })

  it('never throws — a DB failure returns null so the assignment still succeeds', async () => {
    h.invoiceCreate.mockRejectedValue(new Error('db down'))
    const id = await createInvoiceForAssignment({ trainerId: 't-1', clientId: 'cp-1', sourceType: 'PACKAGE', clientPackageId: 'clp-1' })
    expect(id).toBeNull()
  })

  it('handles priced products via productId', async () => {
    h.productFindFirst.mockResolvedValue({ name: 'Long Line', priceCents: 4500, xeroAccountCode: null })
    const id = await createInvoiceForAssignment({ trainerId: 't-1', clientId: 'cp-1', sourceType: 'PRODUCT', productId: 'prod-1' })
    expect(id).toBe('inv-1')
    expect(h.invoiceCreate.mock.calls[0][0].data).toMatchObject({ amountCents: 4500, description: 'Long Line', sourceType: 'PRODUCT', sourceId: 'prod-1' })
  })
})

describe('applyPaidAmount', () => {
  it('full payment → PAID + paidAt stamped, clamped to total', () => {
    const r = applyPaidAmount({ amountCents: 38000 }, 38000)
    expect(r.status).toBe('PAID')
    expect(r.amountPaidCents).toBe(38000)
    expect(r.paidAt).toBeInstanceOf(Date)
  })
  it('overpayment → PAID, amount clamped to total', () => {
    const r = applyPaidAmount({ amountCents: 38000 }, 50000)
    expect(r.status).toBe('PAID')
    expect(r.amountPaidCents).toBe(38000)
  })
  it('0 < paid < total → PARTIAL, no paidAt', () => {
    const r = applyPaidAmount({ amountCents: 38000 }, 15000)
    expect(r.status).toBe('PARTIAL')
    expect(r.amountPaidCents).toBe(15000)
    expect(r.paidAt).toBeNull()
  })
  it('nothing paid → UNPAID', () => {
    expect(applyPaidAmount({ amountCents: 38000 }, 0)).toMatchObject({ status: 'UNPAID', amountPaidCents: 0, paidAt: null })
  })
})

describe('reconcileXeroPayment', () => {
  function seedInvoice(over: Record<string, unknown> = {}) {
    h.invoiceFindUnique.mockResolvedValue({
      id: 'inv-1', amountCents: 38000, amountPaidCents: 0, status: 'UNPAID', paidAt: null, xeroInvoiceId: 'XINV-1',
      trainer: { sandboxBilling: false, xeroConnection: { id: 'xc-1', tenantId: 't' } },
      ...over,
    })
  }

  it('applies a partial payment pulled from Xero (→ PARTIAL)', async () => {
    seedInvoice()
    h.fetchXeroInvoiceState.mockResolvedValue({ amountPaidCents: 15000, amountDueCents: 23000, status: 'AUTHORISED' })
    const r = await reconcileXeroPayment('inv-1')
    expect(r).toMatchObject({ ok: true, changed: true, status: 'PARTIAL', amountPaidCents: 15000 })
    expect(h.invoiceUpdate).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { amountPaidCents: 15000, status: 'PARTIAL', paidAt: null, xeroSyncStatus: 'SYNCED', xeroSyncError: null },
    })
  })

  it('marks PAID + stamps paidAt on full payment', async () => {
    seedInvoice()
    h.fetchXeroInvoiceState.mockResolvedValue({ amountPaidCents: 38000, amountDueCents: 0, status: 'PAID' })
    const r = await reconcileXeroPayment('inv-1')
    expect(r).toMatchObject({ ok: true, changed: true, status: 'PAID' })
    const data = h.invoiceUpdate.mock.calls[0][0].data
    expect(data.status).toBe('PAID')
    expect(data.paidAt).toBeInstanceOf(Date)
  })

  it('is a no-op when nothing changed', async () => {
    seedInvoice({ amountPaidCents: 15000, status: 'PARTIAL' })
    h.fetchXeroInvoiceState.mockResolvedValue({ amountPaidCents: 15000, amountDueCents: 23000, status: 'AUTHORISED' })
    const r = await reconcileXeroPayment('inv-1')
    expect(r).toMatchObject({ ok: true, changed: false })
    expect(h.invoiceUpdate).not.toHaveBeenCalled()
  })

  it('no-ops when the invoice was never synced to Xero', async () => {
    seedInvoice({ xeroInvoiceId: null })
    const r = await reconcileXeroPayment('inv-1')
    expect(r.ok).toBe(false)
    expect(h.fetchXeroInvoiceState).not.toHaveBeenCalled()
  })

  it('skips CANCELLED invoices without hitting Xero', async () => {
    seedInvoice({ status: 'CANCELLED' })
    const r = await reconcileXeroPayment('inv-1')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('cancelled')
    expect(h.fetchXeroInvoiceState).not.toHaveBeenCalled()
    expect(h.invoiceUpdate).not.toHaveBeenCalled()
  })

  it('skips sandbox/demo trainers (prod guard) without touching Xero', async () => {
    // vitest runs with NODE_ENV=test, so the dev bypass is off → sandbox is skipped.
    seedInvoice({ trainer: { sandboxBilling: true, xeroConnection: { id: 'xc-1', tenantId: 't' } } })
    const r = await reconcileXeroPayment('inv-1')
    expect(r.error).toBe('sandbox')
    expect(h.fetchXeroInvoiceState).not.toHaveBeenCalled()
  })

  it('no-ops when the trainer is not connected', async () => {
    seedInvoice({ trainer: { sandboxBilling: false, xeroConnection: null } })
    const r = await reconcileXeroPayment('inv-1')
    expect(r.error).toBe('not connected')
    expect(h.fetchXeroInvoiceState).not.toHaveBeenCalled()
  })

  it('is a no-op when the invoice no longer exists in Xero (fetch → null)', async () => {
    seedInvoice()
    h.fetchXeroInvoiceState.mockResolvedValue(null)
    const r = await reconcileXeroPayment('inv-1')
    expect(r).toMatchObject({ ok: true, changed: false })
    expect(h.invoiceUpdate).not.toHaveBeenCalled()
  })

  it('best-effort: a Xero error records ERROR status and never throws', async () => {
    seedInvoice()
    h.fetchXeroInvoiceState.mockRejectedValue(new Error('429 rate limited'))
    const r = await reconcileXeroPayment('inv-1')
    expect(r.ok).toBe(false)
    expect(h.invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-1' }, data: expect.objectContaining({ xeroSyncStatus: 'ERROR' }) }),
    )
  })

  it('preserves the original paidAt when settling an invoice that already had one', async () => {
    const original = new Date('2026-06-01T00:00:00Z')
    seedInvoice({ status: 'PARTIAL', amountPaidCents: 15000, paidAt: original })
    h.fetchXeroInvoiceState.mockResolvedValue({ amountPaidCents: 38000, amountDueCents: 0, status: 'PAID' })
    await reconcileXeroPayment('inv-1')
    expect(h.invoiceUpdate.mock.calls[0][0].data.paidAt).toBe(original)
  })
})

describe('reconcileTrainerXeroPayments', () => {
  it('scopes to the trainer’s still-open synced invoices and counts changes', async () => {
    h.invoiceFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    // Each reconcile loads the invoice + Xero state → both flip UNPAID → PARTIAL.
    h.invoiceFindUnique.mockResolvedValue({
      id: 'a', amountCents: 38000, amountPaidCents: 0, status: 'UNPAID', paidAt: null, xeroInvoiceId: 'XINV',
      trainer: { sandboxBilling: false, xeroConnection: { id: 'xc-1', tenantId: 't' } },
    })
    h.fetchXeroInvoiceState.mockResolvedValue({ amountPaidCents: 15000, amountDueCents: 23000, status: 'AUTHORISED' })

    const res = await reconcileTrainerXeroPayments('t-1')
    expect(res).toEqual({ checked: 2, updated: 2 })
    const where = h.invoiceFindMany.mock.calls[0][0].where
    expect(where).toMatchObject({ trainerId: 't-1', xeroInvoiceId: { not: null }, status: { in: ['UNPAID', 'PARTIAL'] } })
    expect(h.invoiceFindMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' })
  })

  it('reports 0 updated when nothing changed', async () => {
    h.invoiceFindMany.mockResolvedValue([{ id: 'a' }])
    h.invoiceFindUnique.mockResolvedValue({
      id: 'a', amountCents: 38000, amountPaidCents: 15000, status: 'PARTIAL', paidAt: null, xeroInvoiceId: 'XINV',
      trainer: { sandboxBilling: false, xeroConnection: { id: 'xc-1', tenantId: 't' } },
    })
    h.fetchXeroInvoiceState.mockResolvedValue({ amountPaidCents: 15000, amountDueCents: 23000, status: 'AUTHORISED' })
    expect(await reconcileTrainerXeroPayments('t-1')).toEqual({ checked: 1, updated: 0 })
  })
})

describe('reconcileAllXeroPayments', () => {
  it('scopes to all still-open synced invoices (no trainerId filter)', async () => {
    h.invoiceFindMany.mockResolvedValue([])
    const res = await reconcileAllXeroPayments()
    expect(res).toEqual({ checked: 0, updated: 0 })
    const where = h.invoiceFindMany.mock.calls[0][0].where
    expect(where).toEqual({ xeroInvoiceId: { not: null }, status: { in: ['UNPAID', 'PARTIAL'] } })
    expect(where).not.toHaveProperty('trainerId')
  })
})

describe('sendReceivable', () => {
  function seedSendable(over: Record<string, unknown> = {}) {
    h.invoiceFindFirst.mockResolvedValue({
      id: 'inv-1', clientId: 'cp-1', description: 'Puppy Course', amountCents: 12500, currency: 'nzd', status: 'UNPAID',
      trainer: { businessName: 'Pawsome' },
      ...over,
    })
  }

  it('scopes the lookup by (id, trainerId), stamps sentAt and notifies the client', async () => {
    seedSendable()
    const ok = await sendReceivable('inv-1', 't-1')
    expect(ok).toBe(true)
    expect(h.invoiceFindFirst.mock.calls[0][0].where).toEqual({ id: 'inv-1', trainerId: 't-1' })
    expect(h.invoiceUpdate.mock.calls[0][0]).toMatchObject({ where: { id: 'inv-1' } })
    expect(h.invoiceUpdate.mock.calls[0][0].data.sentAt).toBeInstanceOf(Date)
    expect(h.notificationCreate).toHaveBeenCalledTimes(1)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('returns false (no send) for a CANCELLED invoice', async () => {
    seedSendable({ status: 'CANCELLED' })
    expect(await sendReceivable('inv-1', 't-1')).toBe(false)
    expect(h.invoiceUpdate).not.toHaveBeenCalled()
  })

  it('returns false when the invoice is not the trainer’s (findFirst null)', async () => {
    h.invoiceFindFirst.mockResolvedValue(null)
    expect(await sendReceivable('inv-1', 't-1')).toBe(false)
    expect(h.invoiceUpdate).not.toHaveBeenCalled()
  })
})
