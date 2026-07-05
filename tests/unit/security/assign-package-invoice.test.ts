import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/clients/[clientId]/packages — assigning a package.
// Focus for the invoicing work: whether it raises a receivable.
//   - markInvoiced:false / absent → createInvoiceForAssignment IS called
//     (with the new ClientPackage id, PACKAGE source)
//   - markInvoiced:true (trainer invoiced externally) → it is NOT called
//   - ownership: non-editor / unauthenticated are rejected before any create
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getClientAccess: vi.fn(),
  safeEvaluate: vi.fn(),
  notifyClient: vi.fn(),
  createInvoiceForAssignment: vi.fn(),
  packageFindFirst: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  trainingSessionFindMany: vi.fn(),
  txClientPackageCreate: vi.fn(),
  txTrainingSessionCreateMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/trainer-access', () => ({ getClientAccess: h.getClientAccess }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/invoicing', () => ({ createInvoiceForAssignment: h.createInvoiceForAssignment }))
vi.mock('@/lib/google-calendar-sync', () => ({ syncSessionsToGoogle: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    package: { findFirst: h.packageFindFirst },
    clientProfile: { findUnique: h.clientProfileFindUnique },
    trainingSession: { findMany: h.trainingSessionFindMany },
    $transaction: h.transaction,
  },
}))

import { POST } from '@/app/api/clients/[clientId]/packages/route'

function req(body: unknown) {
  return new Request('http://x/api/clients/cp-1/packages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
const params = { params: Promise.resolve({ clientId: 'cp-1' }) }
// notify:false so the route skips the client-notification fan-out.
const baseBody = { packageId: 'pkg-1', sessionDates: ['2030-01-01T10:00:00Z'], notify: false }

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u-1' } })
  h.getClientAccess.mockResolvedValue({ canEdit: true, trainerId: 't-1', client: { userId: 'cu-1' } })
  h.packageFindFirst.mockResolvedValue({ id: 'pkg-1', trainerId: 't-1', name: 'Puppy', sessionCount: 1, durationMins: 60, sessionType: 'IN_PERSON', weeksBetween: 1, priceCents: 12500 })
  h.clientProfileFindUnique.mockResolvedValue({ assignedMembershipId: null })
  h.trainingSessionFindMany.mockResolvedValue([]) // no rows → Google sync skipped
  h.txClientPackageCreate.mockResolvedValue({ id: 'clp-new' })
  h.txTrainingSessionCreateMany.mockResolvedValue({})
  h.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ clientPackage: { create: h.txClientPackageCreate }, trainingSession: { createMany: h.txTrainingSessionCreateMany } }),
  )
  h.createInvoiceForAssignment.mockResolvedValue(null)
  h.safeEvaluate.mockResolvedValue(undefined)
})

describe('assign package → receivable', () => {
  it('raises a receivable when not already invoiced (markInvoiced absent)', async () => {
    const res = await POST(req(baseBody), params)
    expect(res.status).toBe(201)
    expect(h.createInvoiceForAssignment).toHaveBeenCalledTimes(1)
    expect(h.createInvoiceForAssignment).toHaveBeenCalledWith({ trainerId: 't-1', clientId: 'cp-1', sourceType: 'PACKAGE', clientPackageId: 'clp-new' })
  })

  it('raises a receivable when markInvoiced:false', async () => {
    const res = await POST(req({ ...baseBody, markInvoiced: false }), params)
    expect(res.status).toBe(201)
    expect(h.createInvoiceForAssignment).toHaveBeenCalledTimes(1)
  })

  it('does NOT raise a receivable when markInvoiced:true (invoiced externally)', async () => {
    const res = await POST(req({ ...baseBody, markInvoiced: true }), params)
    expect(res.status).toBe(201)
    expect(h.createInvoiceForAssignment).not.toHaveBeenCalled()
  })

  it('rejects a non-editor (403) before creating anything', async () => {
    h.getClientAccess.mockResolvedValue({ canEdit: false, trainerId: 't-1', client: {} })
    const res = await POST(req(baseBody), params)
    expect(res.status).toBe(403)
    expect(h.txClientPackageCreate).not.toHaveBeenCalled()
    expect(h.createInvoiceForAssignment).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request (401)', async () => {
    h.auth.mockResolvedValue(null)
    const res = await POST(req(baseBody), params)
    expect(res.status).toBe(401)
    expect(h.createInvoiceForAssignment).not.toHaveBeenCalled()
  })
})
