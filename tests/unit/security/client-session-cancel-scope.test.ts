import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/my/sessions/[sessionId]/cancel — a client cancels ONE upcoming
// self-booked 1:1 session. Guards under test:
//   - must be a signed-in client (getActiveClient)
//   - preview mode (a trainer previewing) can never cancel a real booking
//   - the session must be the ACTIVE client's own UPCOMING session (never the
//     URL id alone) — a foreign/class session 404s and nothing is deleted
//   - a session that has already started can't be cancelled
//   - the fee is raised only when configured AND within the window; the trainer
//     is notified either way
const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionDeleteMany: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  trainerProfileFindUnique: vi.fn(),
  clientPackageUpdateMany: vi.fn(),
  createCancellationFeeInvoice: vi.fn(),
  notifyTrainer: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: { findFirst: h.sessionFindFirst, deleteMany: h.sessionDeleteMany },
    clientProfile: { findUnique: h.clientProfileFindUnique },
    trainerProfile: { findUnique: h.trainerProfileFindUnique },
    clientPackage: { updateMany: h.clientPackageUpdateMany },
  },
}))
vi.mock('@/lib/invoicing', () => ({ createCancellationFeeInvoice: h.createCancellationFeeInvoice }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))

import { POST } from '@/app/api/my/sessions/[sessionId]/cancel/route'

const ctx = (sessionId = 's1') => ({ params: Promise.resolve({ sessionId }) })
const req = () => new Request('https://app.pupmanager.com/api/my/sessions/s1/cancel', { method: 'POST' })

// 48h in the future by default (outside a 24h window).
const future = () => new Date(Date.now() + 48 * 3_600_000)

beforeEach(() => {
  vi.clearAllMocks()
  h.getActiveClient.mockResolvedValue({ clientId: 'cp-1', userId: 'u-client', isPreview: false, actualUserId: 'u-client' })
  h.sessionFindFirst.mockResolvedValue({
    id: 's1', title: 'Loose-lead walk', scheduledAt: future(), clientPackageId: 'pkg-1', trainerId: 'trainer-1',
  })
  h.sessionDeleteMany.mockResolvedValue({ count: 1 })
  h.clientProfileFindUnique.mockResolvedValue({
    user: { name: 'Karl' }, dog: { name: 'Biscuit' },
    trainer: { user: { id: 'owner-user' } }, assignedTrainer: null,
  })
  h.trainerProfileFindUnique.mockResolvedValue({ cancellationFeeCents: null, cancellationFeeWindowHours: null })
  h.clientPackageUpdateMany.mockResolvedValue({ count: 0 })
  h.createCancellationFeeInvoice.mockResolvedValue('inv-1')
})

describe('POST /api/my/sessions/[sessionId]/cancel — auth + scope', () => {
  it('rejects an unauthenticated caller', async () => {
    h.getActiveClient.mockResolvedValue(null)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(401)
    expect(h.sessionDeleteMany).not.toHaveBeenCalled()
  })

  it('blocks preview mode (trainer previewing the client app)', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'cp-1', userId: 'u', isPreview: true, actualUserId: 't' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(403)
    expect(h.sessionDeleteMany).not.toHaveBeenCalled()
  })

  it("never cancels a session that isn't the caller's own upcoming one", async () => {
    h.sessionFindFirst.mockResolvedValue(null)
    const res = await POST(req(), ctx('someone-elses'))
    expect(res.status).toBe(404)
    expect(h.sessionDeleteMany).not.toHaveBeenCalled()
    // The scope really pins clientId + UPCOMING, not just the URL id.
    expect(h.sessionFindFirst.mock.calls[0][0].where).toMatchObject({
      id: 'someone-elses', clientId: 'cp-1', status: 'UPCOMING',
    })
  })

  it('rejects a session that has already started', async () => {
    h.sessionFindFirst.mockResolvedValue({ id: 's1', title: 'x', scheduledAt: new Date(Date.now() - 3_600_000), clientPackageId: null, trainerId: 'trainer-1' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(400)
    expect(h.sessionDeleteMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/my/sessions/[sessionId]/cancel — cancel + fee + notify', () => {
  it('deletes the session and notifies the trainer, no fee when none configured', async () => {
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, feeCharged: 0 })
    expect(h.sessionDeleteMany).toHaveBeenCalledWith({ where: { id: 's1', clientId: 'cp-1' } })
    expect(h.createCancellationFeeInvoice).not.toHaveBeenCalled()
    expect(h.notifyTrainer).toHaveBeenCalledWith(
      'owner-user',
      'CLIENT_CANCELLED_SESSION',
      expect.objectContaining({ clientName: 'Karl', dogName: 'Biscuit' }),
      '/schedule',
      'trainer-1',
    )
  })

  it('stops an ongoing package regenerating the cancelled slot', async () => {
    await POST(req(), ctx())
    expect(h.clientPackageUpdateMany).toHaveBeenCalledWith({
      where: { id: 'pkg-1', extendIndefinitely: true },
      data: { extendIndefinitely: false },
    })
  })

  it('raises the fee when a fee is set and the start is within the window', async () => {
    h.sessionFindFirst.mockResolvedValue({ id: 's1', title: 'Walk', scheduledAt: new Date(Date.now() + 2 * 3_600_000), clientPackageId: null, trainerId: 'trainer-1' })
    h.trainerProfileFindUnique.mockResolvedValue({ cancellationFeeCents: 5000, cancellationFeeWindowHours: 24 })
    const res = await POST(req(), ctx())
    expect(await res.json()).toEqual({ ok: true, feeCharged: 5000 })
    expect(h.createCancellationFeeInvoice).toHaveBeenCalledWith(expect.objectContaining({
      trainerId: 'trainer-1', clientId: 'cp-1', amountCents: 5000, sourceId: 's1',
    }))
  })

  it('does NOT raise the fee when the start is outside the window', async () => {
    // default session is 48h out; window is 24h.
    h.trainerProfileFindUnique.mockResolvedValue({ cancellationFeeCents: 5000, cancellationFeeWindowHours: 24 })
    const res = await POST(req(), ctx())
    expect(await res.json()).toEqual({ ok: true, feeCharged: 0 })
    expect(h.createCancellationFeeInvoice).not.toHaveBeenCalled()
  })
})
