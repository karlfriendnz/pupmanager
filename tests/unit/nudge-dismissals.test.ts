import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockUpsert } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockUpsert: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/prisma', () => ({ prisma: { nudgeDismissal: { upsert: mockUpsert } } }))

import { POST } from '@/app/api/nudges/dismiss/route'

const req = (body: unknown) =>
  new Request('http://localhost/api/nudges/dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockUpsert.mockResolvedValue({})
  mockAuth.mockResolvedValue({ user: { id: 'u_1', role: 'TRAINER' } })
})

describe('POST /api/nudges/dismiss', () => {
  it('records the dismissal against the signed-in user', async () => {
    const res = await POST(req({ nudgeId: 'finances-payments' }))
    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_nudgeId: { userId: 'u_1', nudgeId: 'finances-payments' } },
        create: { userId: 'u_1', nudgeId: 'finances-payments' },
      }),
    )
  })

  // Idempotent: dismissing twice must not error or move the original timestamp.
  it('re-dismissing is a no-op update', async () => {
    await POST(req({ nudgeId: 'finances-payments' }))
    expect(mockUpsert.mock.calls[0][0].update).toEqual({})
  })

  it('rejects an unauthenticated caller', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await POST(req({ nudgeId: 'x' }))).status).toBe(401)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('rejects a missing or over-long nudgeId', async () => {
    expect((await POST(req({}))).status).toBe(400)
    expect((await POST(req({ nudgeId: '' }))).status).toBe(400)
    expect((await POST(req({ nudgeId: 'x'.repeat(101) }))).status).toBe(400)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  // The body carries only a nudge key — a userId in it must be ignored, or one
  // user could dismiss nudges on another's behalf.
  it('ignores any userId in the body', async () => {
    await POST(req({ nudgeId: 'a', userId: 'u_victim' }))
    expect(mockUpsert.mock.calls[0][0].create.userId).toBe('u_1')
  })
})
