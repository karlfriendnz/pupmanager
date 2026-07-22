import { describe, it, expect, vi, beforeEach } from 'vitest'

// The "Likely" column writes an internal sales judgement. It must be
// admin-only, and must only accept the four known values — it's rendered back
// into a class-name lookup, so an arbitrary string has no business landing in
// the column.
const { mockAuth, mockUserFind, mockUserUpdate, mockProfileUpdate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUserFind: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockProfileUpdate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mockUserFind, update: mockUserUpdate },
    trainerProfile: { update: mockProfileUpdate },
  },
}))

import { PATCH } from '@/app/api/admin/trainers/[trainerId]/route'

const params = Promise.resolve({ trainerId: 'tr_1' })
const patch = (body: unknown) =>
  PATCH(
    new Request('http://localhost/api/admin/trainers/tr_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { role: 'ADMIN', id: 'u_admin' } })
  mockUserFind.mockResolvedValue({ id: 'tr_1', email: 'a@b.com' })
  mockUserUpdate.mockResolvedValue({})
  mockProfileUpdate.mockResolvedValue({})
})

describe('PATCH /api/admin/trainers/[trainerId] — conversionLikelihood', () => {
  it.each(['NAH', 'MAYBE', 'YEAH', 'DEFINITELY'])('accepts %s', async (value) => {
    const res = await patch({ conversionLikelihood: value })
    expect(res.status).toBe(200)
    expect(mockProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ conversionLikelihood: value }) }),
    )
  })

  it('accepts null to clear the assessment', async () => {
    const res = await patch({ conversionLikelihood: null })
    expect(res.status).toBe(200)
    expect(mockProfileUpdate.mock.calls[0][0].data.conversionLikelihood).toBeNull()
  })

  it('rejects an arbitrary value', async () => {
    const res = await patch({ conversionLikelihood: 'PROBABLY' })
    expect(res.status).toBe(400)
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u_1' } })
    expect((await patch({ conversionLikelihood: 'YEAH' })).status).toBe(401)
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await patch({ conversionLikelihood: 'YEAH' })).status).toBe(401)
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  it('404s for an unknown trainer', async () => {
    mockUserFind.mockResolvedValue(null)
    expect((await patch({ conversionLikelihood: 'YEAH' })).status).toBe(404)
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })
})
