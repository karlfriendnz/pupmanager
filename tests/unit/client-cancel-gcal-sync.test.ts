import { describe, it, expect, vi, beforeEach } from 'vitest'

// When a client cancels a self-booked 1:1 session, the mirrored event must be
// removed from the trainer's Google Calendar — routed to the same member the
// session synced to (its assignee, else the owner). Best-effort; never blocks.

const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionDeleteMany: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  trainerProfileFindUnique: vi.fn(),
  clientPackageUpdateMany: vi.fn(),
  resolveCancellationFeeCents: vi.fn(),
  createCancellationFeeInvoice: vi.fn(),
  notifyTrainer: vi.fn(),
  deleteGoogleEvents: vi.fn(),
}))

vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/cancellation', () => ({ resolveCancellationFeeCents: h.resolveCancellationFeeCents }))
vi.mock('@/lib/invoicing', () => ({ createCancellationFeeInvoice: h.createCancellationFeeInvoice }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))
vi.mock('@/lib/money', () => ({ formatMoney: () => '$0.00' }))
vi.mock('@/lib/google-calendar-sync', () => ({ deleteGoogleEvents: h.deleteGoogleEvents }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: { findFirst: h.sessionFindFirst, deleteMany: h.sessionDeleteMany },
    clientProfile: { findUnique: h.clientProfileFindUnique },
    trainerProfile: { findUnique: h.trainerProfileFindUnique },
    clientPackage: { updateMany: h.clientPackageUpdateMany },
  },
}))

import { POST } from '@/app/api/my/sessions/[sessionId]/cancel/route'

function req() {
  return POST(
    new Request('https://app.pupmanager.com/api/my/sessions/s1/cancel', { method: 'POST' }),
    { params: Promise.resolve({ sessionId: 's1' }) },
  )
}

const FUTURE = new Date('2099-01-01T09:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  h.getActiveClient.mockResolvedValue({ clientId: 'cli-1', isPreview: false })
  h.clientProfileFindUnique.mockResolvedValue({ user: { name: 'Sam' }, dog: { name: 'Rex' }, trainer: { user: { id: 'tu-1' } }, assignedTrainer: null })
  h.trainerProfileFindUnique.mockResolvedValue({ cancellationFeeCents: 0, cancellationFeeWindowHours: 0, payoutCurrency: 'nzd', user: { timezone: 'Pacific/Auckland' } })
  h.resolveCancellationFeeCents.mockReturnValue(0)
  h.notifyTrainer.mockResolvedValue(undefined)
  h.deleteGoogleEvents.mockResolvedValue(undefined)
})

describe('POST /api/my/sessions/[sessionId]/cancel — unmirrors from Google', () => {
  it('removes the mirrored event, routed to the session assignee', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 's1', title: 'Walk', scheduledAt: FUTURE, clientPackageId: null,
      trainerId: 'co-1', assignedMembershipId: 'mem-9', googleCalendarEventId: 'evt-1',
    })
    const res = await req()
    expect(res.status).toBe(200)
    expect(h.sessionDeleteMany).toHaveBeenCalled()
    expect(h.deleteGoogleEvents).toHaveBeenCalledWith('co-1', ['evt-1'], 'mem-9')
  })

  it('does nothing on Google when the session was never mirrored', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 's1', title: 'Walk', scheduledAt: FUTURE, clientPackageId: null,
      trainerId: 'co-1', assignedMembershipId: null, googleCalendarEventId: null,
    })
    const res = await req()
    expect(res.status).toBe(200)
    expect(h.deleteGoogleEvents).not.toHaveBeenCalled()
  })

  it('a Google failure never breaks the cancellation', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 's1', title: 'Walk', scheduledAt: FUTURE, clientPackageId: null,
      trainerId: 'co-1', assignedMembershipId: null, googleCalendarEventId: 'evt-1',
    })
    h.deleteGoogleEvents.mockRejectedValue(new Error('Google 500'))
    const res = await req()
    expect(res.status).toBe(200)
  })
})
