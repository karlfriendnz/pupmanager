import { it, expect, vi, beforeEach, describe } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// ADVERSARIAL / abuse-case tests for the Xero + Google Calendar sync engines.
// "What if the user does something stupid / a hacker pokes at it": cross-tenant
// routing, idempotency (no double invoice / double payment), un-reconciled
// payments, overpay protection, disconnect mid-flight, malformed data, and
// swallowed-failure guarantees. Everything is mocked — no DB / no network.
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  // shared prisma
  sessionFindUnique: vi.fn(),
  sessionUpdate: vi.fn(),
  availFindUnique: vi.fn(),
  availUpdate: vi.fn(),
  gcalFindUnique: vi.fn(),
  membershipFindFirst: vi.fn(),
  membershipFindUnique: vi.fn(),
  busyDeleteMany: vi.fn(),
  busyCreateMany: vi.fn(),
  paymentFindUnique: vi.fn(),
  paymentUpdate: vi.fn(),
  productFindMany: vi.fn(),
  clientPackageFindMany: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  clientProfileUpdate: vi.fn(),
  // billing
  hasAddon: vi.fn(),
  // google low-level
  upsertCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  fetchFreeBusy: vi.fn(),
  fetchCalendarEvents: vi.fn(),
  // xero low-level
  ensureXeroContact: vi.fn(),
  createXeroInvoice: vi.fn(),
  createXeroPayment: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: { findUnique: h.sessionFindUnique, update: h.sessionUpdate, findMany: vi.fn() },
    availabilitySlot: { findUnique: h.availFindUnique, update: h.availUpdate },
    blackoutPeriod: { findUnique: vi.fn(), update: vi.fn() },
    googleCalendarConnection: { findUnique: h.gcalFindUnique, findMany: vi.fn() },
    trainerMembership: { findFirst: h.membershipFindFirst, findUnique: h.membershipFindUnique },
    googleBusyBlock: { deleteMany: h.busyDeleteMany, createMany: h.busyCreateMany },
    payment: { findUnique: h.paymentFindUnique, update: h.paymentUpdate },
    product: { findMany: h.productFindMany },
    clientPackage: { findMany: h.clientPackageFindMany },
    clientProfile: { findUnique: h.clientProfileFindUnique, update: h.clientProfileUpdate },
  },
}))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/google-calendar', () => ({
  upsertCalendarEvent: h.upsertCalendarEvent,
  deleteCalendarEvent: h.deleteCalendarEvent,
  fetchFreeBusy: h.fetchFreeBusy,
  fetchCalendarEvents: h.fetchCalendarEvents,
}))
vi.mock('@/lib/xero', () => ({
  ensureXeroContact: h.ensureXeroContact,
  createXeroInvoice: h.createXeroInvoice,
  createXeroPayment: h.createXeroPayment,
}))

import {
  syncSessionToGoogle,
  syncAvailabilitySlotToGoogle,
  refreshBusyForMembership,
  deleteGoogleEvents,
} from '@/lib/google-calendar-sync'
import { syncInvoiceToXero, syncPaymentToXero } from '@/lib/xero-sync'

// ─── Google Calendar abuse cases ─────────────────────────────────────────────

const ownerConn = { id: 'gc-o', membershipId: 'mem-owner', companyId: 'co-1', calendarId: 'primary', refreshToken: 'r' }

describe('Google Calendar — cross-tenant & abuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.hasAddon.mockResolvedValue(true)
    h.sessionUpdate.mockResolvedValue({})
    h.membershipFindFirst.mockResolvedValue({ id: 'mem-owner' })
  })

  function session(over = {}) {
    return { id: 's1', trainerId: 'co-1', assignedMembershipId: 'mem-assigned', title: 'X', description: null, location: null, scheduledAt: new Date('2026-07-06T02:00:00Z'), durationMins: 60, googleCalendarEventId: null, ...over }
  }

  it('REFUSES to write into a connection owned by ANOTHER company (defence-in-depth), falls back to owner', async () => {
    // The assigned member's connection belongs to a DIFFERENT company.
    const foreign = { id: 'gc-x', membershipId: 'mem-assigned', companyId: 'ATTACKER-CO', calendarId: 'primary', refreshToken: 'r' }
    h.gcalFindUnique.mockImplementation(({ where }: { where: { membershipId: string } }) =>
      Promise.resolve(where.membershipId === 'mem-assigned' ? foreign : where.membershipId === 'mem-owner' ? ownerConn : null),
    )
    h.sessionFindUnique.mockResolvedValue(session())
    h.upsertCalendarEvent.mockResolvedValue('evt-1')

    await syncSessionToGoogle('s1')

    // Never the foreign (cross-tenant) connection — only the owner's, same company.
    expect(h.upsertCalendarEvent).toHaveBeenCalledTimes(1)
    expect(h.upsertCalendarEvent).toHaveBeenCalledWith(ownerConn, null, expect.anything())
  })

  it('no-ops when the trainer DISCONNECTS between the session load and the sync', async () => {
    h.sessionFindUnique.mockResolvedValue(session({ assignedMembershipId: null }))
    h.gcalFindUnique.mockResolvedValue(null) // owner connection just deleted
    await syncSessionToGoogle('s1')
    expect(h.upsertCalendarEvent).not.toHaveBeenCalled()
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })

  it('does not persist an event id when Google returns none (garbage response)', async () => {
    h.gcalFindUnique.mockResolvedValue(ownerConn)
    h.sessionFindUnique.mockResolvedValue(session({ assignedMembershipId: null }))
    h.upsertCalendarEvent.mockResolvedValue(null) // no id back
    await syncSessionToGoogle('s1')
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })

  it('malformed availability slot (no weekday AND no date) is a no-op, not a crash', async () => {
    h.gcalFindUnique.mockResolvedValue(ownerConn)
    h.membershipFindUnique.mockResolvedValue({ user: { timezone: 'UTC' } })
    h.availFindUnique.mockResolvedValue({ id: 'av1', trainerId: 'co-1', title: null, dayOfWeek: null, date: null, startTime: '09:00', endTime: '10:00', cadenceWeeks: 1, firstDate: null, googleEventId: null })
    await expect(syncAvailabilitySlotToGoogle('av1')).resolves.toBeUndefined()
    expect(h.upsertCalendarEvent).not.toHaveBeenCalled()
  })

  it('deleteGoogleEvents swallows a Google 500 and never throws', async () => {
    h.gcalFindUnique.mockResolvedValue(ownerConn)
    h.deleteCalendarEvent.mockRejectedValue(new Error('Google 500'))
    await expect(deleteGoogleEvents('co-1', ['evt-a', 'evt-b'])).resolves.toBeUndefined()
  })

  it('busy refresh clears stale blocks even when Google now returns NOTHING', async () => {
    h.gcalFindUnique.mockResolvedValue(ownerConn)
    h.busyDeleteMany.mockResolvedValue({})
    h.fetchCalendarEvents.mockResolvedValue([]) // calendar cleared out
    const n = await refreshBusyForMembership('mem-owner')
    expect(n).toBe(0)
    expect(h.busyDeleteMany).toHaveBeenCalledWith({ where: { membershipId: 'mem-owner' } })
    expect(h.busyCreateMany).not.toHaveBeenCalled()
  })
})

// ─── Xero abuse cases ────────────────────────────────────────────────────────

const xeroConn = { id: 'xc', salesAccountCode: '200', bankAccountCode: '090', taxType: 'OUTPUT2', tenantId: 't' }

describe('Xero — idempotency, un-reconcile, overpay & abuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.paymentUpdate.mockResolvedValue({})
    h.productFindMany.mockResolvedValue([])
    h.clientPackageFindMany.mockResolvedValue([])
    h.clientProfileFindUnique.mockResolvedValue({ id: 'cp', xeroContactId: 'C-1' })
  })

  it('NEVER creates a second invoice for an already-synced payment (double-submit / retry storm)', async () => {
    h.paymentFindUnique.mockResolvedValue({ id: 'p1', clientId: 'cp', sandbox: false, xeroInvoiceId: 'INV-EXISTING', items: [], trainer: { xeroConnection: xeroConn } })
    const r = await syncInvoiceToXero('p1')
    expect(r).toEqual({ ok: true, invoiceId: 'INV-EXISTING' })
    expect(h.createXeroInvoice).not.toHaveBeenCalled()
  })

  it('NEVER records a second payment for an already-reconciled payment', async () => {
    h.paymentFindUnique.mockResolvedValue({ id: 'p1', sandbox: false, xeroInvoiceId: 'INV-1', xeroPaymentId: 'PAY-EXISTING', paidAt: new Date(), items: [{ unitAmount: 5000, quantity: 1 }], trainer: { xeroConnection: xeroConn } })
    const r = await syncPaymentToXero('p1')
    expect(r).toEqual({ ok: true, xeroPaymentId: 'PAY-EXISTING' })
    expect(h.createXeroPayment).not.toHaveBeenCalled()
  })

  it('settles EXACTLY the invoice line total — a client processing surcharge can never overpay Xero', async () => {
    h.paymentFindUnique.mockResolvedValue({
      id: 'p1', sandbox: false, xeroInvoiceId: 'INV-1', xeroPaymentId: null, paidAt: new Date('2026-07-01T00:00:00Z'),
      // Two lines summing to 12500 — even if amountTotal (with surcharge) were larger.
      items: [{ unitAmount: 10000, quantity: 1 }, { unitAmount: 2500, quantity: 1 }],
      trainer: { xeroConnection: xeroConn },
    })
    h.createXeroPayment.mockResolvedValue('PAY-NEW')
    await syncPaymentToXero('p1')
    expect(h.createXeroPayment.mock.calls[0][1].amountMinor).toBe(12500)
  })

  it('a disconnected trainer never leaks money into a stale Xero org (no-op, stays NOT_SYNCED)', async () => {
    h.paymentFindUnique.mockResolvedValue({ id: 'p1', sandbox: false, xeroInvoiceId: null, xeroPaymentId: null, items: [{ unitAmount: 5000, quantity: 1 }], trainer: { xeroConnection: null } })
    const r = await syncPaymentToXero('p1')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('not connected')
    expect(h.createXeroPayment).not.toHaveBeenCalled()
    expect(h.paymentUpdate).not.toHaveBeenCalled() // must NOT flip status
  })

  it('records ERROR (retriable) — never a silent success — when the bank account is unmapped', async () => {
    h.paymentFindUnique.mockResolvedValue({ id: 'p1', sandbox: false, xeroInvoiceId: 'INV-1', xeroPaymentId: null, paidAt: new Date(), items: [{ unitAmount: 5000, quantity: 1 }], trainer: { xeroConnection: { ...xeroConn, bankAccountCode: null } } })
    const r = await syncPaymentToXero('p1')
    expect(r.ok).toBe(false)
    expect(h.createXeroPayment).not.toHaveBeenCalled()
    expect(h.paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ xeroSyncStatus: 'ERROR' }) }))
  })

  it('sandbox/demo money is NEVER pushed into a real Xero org', async () => {
    h.paymentFindUnique.mockResolvedValue({ id: 'p1', sandbox: true, xeroInvoiceId: null, xeroPaymentId: null, items: [{ unitAmount: 5000, quantity: 1 }], trainer: { xeroConnection: xeroConn } })
    const r = await syncPaymentToXero('p1')
    expect(r.error).toBe('sandbox')
    expect(h.createXeroPayment).not.toHaveBeenCalled()
    expect(h.paymentUpdate).not.toHaveBeenCalled()
  })
})
