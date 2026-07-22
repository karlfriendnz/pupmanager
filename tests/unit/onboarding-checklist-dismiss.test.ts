import { describe, it, expect, vi, beforeEach } from 'vitest'

// Pure route test: stub auth + prisma so nothing touches a real DB.
const { mockAuth, mockUpsert } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUpsert: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/prisma', () => ({
  prisma: { trainerOnboardingProgress: { upsert: mockUpsert } },
}))

import { POST } from '@/app/api/onboarding/checklist/dismiss/route'

const TRAINER = { user: { role: 'TRAINER', trainerId: 'tr_1', id: 'u_1' } }
const url = 'http://localhost/api/onboarding/checklist/dismiss'
const req = (body?: unknown) =>
  new Request(url, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })

beforeEach(() => {
  mockAuth.mockReset()
  mockUpsert.mockReset()
  mockUpsert.mockResolvedValue({})
})

describe('POST /api/onboarding/checklist/dismiss', () => {
  it('a bare POST dismisses the checklist', async () => {
    mockAuth.mockResolvedValue(TRAINER)
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, dismissed: true })
    const arg = mockUpsert.mock.calls[0][0]
    expect(arg.where).toEqual({ trainerId: 'tr_1' })
    expect(arg.update.checklistDismissedAt).toBeInstanceOf(Date)
  })

  it('{ restore: true } un-hides it so closing is never a one-way door', async () => {
    mockAuth.mockResolvedValue(TRAINER)
    const res = await POST(req({ restore: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, dismissed: false })
    expect(mockUpsert.mock.calls[0][0].update).toEqual({ checklistDismissedAt: null })
  })

  // Regression: the route used updateMany, which matched zero rows for a
  // trainer with no progress row yet — the X appeared to do nothing and the
  // checklist returned on the next refresh.
  it('upserts, so it works when the trainer has no progress row yet', async () => {
    mockAuth.mockResolvedValue(TRAINER)
    await POST(req())
    const arg = mockUpsert.mock.calls[0][0]
    expect(arg.create).toMatchObject({ trainerId: 'tr_1' })
    expect(arg.create.checklistDismissedAt).toBeInstanceOf(Date)
  })

  it('rejects an unauthenticated caller', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await POST(req())).status).toBe(401)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('rejects a signed-in CLIENT', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'CLIENT', id: 'u_2' } })
    expect((await POST(req())).status).toBe(401)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('rejects a trainer with no trainerId', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: null, id: 'u_3' } })
    expect((await POST(req())).status).toBe(403)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
