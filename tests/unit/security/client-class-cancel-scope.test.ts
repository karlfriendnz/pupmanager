import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/my/classes/[runId]/cancel — a client withdraws THEMSELVES from a
// class run. Guards under test:
//   - must be a signed-in client; preview mode is blocked
//   - only the caller's OWN live enrolment in this run can be cancelled (a
//     foreign enrolment 404s and nothing is withdrawn)
//   - withdrawal + waitlist promotion goes through the shared class-runs helper
//   - the fee follows the same window logic, measured against the run's next
//     upcoming session; the trainer is notified
const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  enrollmentFindFirst: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  withdrawEnrollmentAndNotify: vi.fn(),
  createCancellationFeeInvoice: vi.fn(),
  notifyTrainer: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    classEnrollment: { findFirst: h.enrollmentFindFirst },
    clientProfile: { findUnique: h.clientProfileFindUnique },
  },
}))
vi.mock('@/lib/class-runs', () => ({
  withdrawEnrollmentAndNotify: h.withdrawEnrollmentAndNotify,
  ClassError: class ClassError extends Error {
    constructor(public code: string, message: string) { super(message); this.name = 'ClassError' }
  },
}))
vi.mock('@/lib/invoicing', () => ({ createCancellationFeeInvoice: h.createCancellationFeeInvoice }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))

import { POST } from '@/app/api/my/classes/[runId]/cancel/route'

const ctx = (runId = 'run-1') => ({ params: Promise.resolve({ runId }) })
const req = () => new Request('https://app.pupmanager.com/api/my/classes/run-1/cancel', { method: 'POST' })

function enrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enr-1',
    classRun: {
      name: 'Puppy Basics',
      trainerId: 'trainer-1',
      trainer: { cancellationFeeCents: null, cancellationFeeWindowHours: null },
      // 48h out by default (outside a 24h window).
      sessions: [{ scheduledAt: new Date(Date.now() + 48 * 3_600_000) }],
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getActiveClient.mockResolvedValue({ clientId: 'cp-1', userId: 'u-client', isPreview: false, actualUserId: 'u-client' })
  h.enrollmentFindFirst.mockResolvedValue(enrollment())
  h.clientProfileFindUnique.mockResolvedValue({
    user: { name: 'Karl' }, dog: { name: 'Biscuit' },
    trainer: { user: { id: 'owner-user' } }, assignedTrainer: null,
  })
  h.withdrawEnrollmentAndNotify.mockResolvedValue({ promotedEnrollmentId: null })
  h.createCancellationFeeInvoice.mockResolvedValue('inv-1')
})

describe('POST /api/my/classes/[runId]/cancel — auth + scope', () => {
  it('rejects an unauthenticated caller', async () => {
    h.getActiveClient.mockResolvedValue(null)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(401)
    expect(h.withdrawEnrollmentAndNotify).not.toHaveBeenCalled()
  })

  it('blocks preview mode', async () => {
    h.getActiveClient.mockResolvedValue({ clientId: 'cp-1', userId: 'u', isPreview: true, actualUserId: 't' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(403)
    expect(h.withdrawEnrollmentAndNotify).not.toHaveBeenCalled()
  })

  it("never withdraws an enrolment that isn't the caller's own live one", async () => {
    h.enrollmentFindFirst.mockResolvedValue(null)
    const res = await POST(req(), ctx('run-x'))
    expect(res.status).toBe(404)
    expect(h.withdrawEnrollmentAndNotify).not.toHaveBeenCalled()
    expect(h.enrollmentFindFirst.mock.calls[0][0].where).toMatchObject({
      classRunId: 'run-x', clientId: 'cp-1', status: { in: ['ENROLLED', 'WAITLISTED'] },
    })
  })
})

describe('POST /api/my/classes/[runId]/cancel — withdraw + promote + fee + notify', () => {
  it('withdraws the caller, passes through the promoted waitlister, and notifies the trainer', async () => {
    h.withdrawEnrollmentAndNotify.mockResolvedValue({ promotedEnrollmentId: 'enr-2' })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, feeCharged: 0, promotedEnrollmentId: 'enr-2' })
    expect(h.withdrawEnrollmentAndNotify).toHaveBeenCalledWith('enr-1', 'trainer-1')
    expect(h.createCancellationFeeInvoice).not.toHaveBeenCalled()
    expect(h.notifyTrainer).toHaveBeenCalledWith(
      'owner-user', 'CLIENT_CANCELLED_SESSION',
      expect.objectContaining({ clientName: 'Karl' }), '/schedule', 'trainer-1',
    )
  })

  it('raises the fee when set and the next session is within the window', async () => {
    h.enrollmentFindFirst.mockResolvedValue(enrollment({
      trainer: { cancellationFeeCents: 4000, cancellationFeeWindowHours: 24 },
      sessions: [{ scheduledAt: new Date(Date.now() + 2 * 3_600_000) }],
    }))
    const res = await POST(req(), ctx())
    expect(await res.json()).toEqual({ ok: true, feeCharged: 4000, promotedEnrollmentId: null })
    expect(h.createCancellationFeeInvoice).toHaveBeenCalledWith(expect.objectContaining({
      trainerId: 'trainer-1', clientId: 'cp-1', amountCents: 4000, sourceId: 'enr-1',
    }))
  })

  it('does NOT raise the fee when the next session is outside the window', async () => {
    h.enrollmentFindFirst.mockResolvedValue(enrollment({
      trainer: { cancellationFeeCents: 4000, cancellationFeeWindowHours: 24 },
      // default 48h out
    }))
    const res = await POST(req(), ctx())
    expect(await res.json()).toMatchObject({ feeCharged: 0 })
    expect(h.createCancellationFeeInvoice).not.toHaveBeenCalled()
    // …but the withdraw still happens.
    expect(h.withdrawEnrollmentAndNotify).toHaveBeenCalled()
  })
})
