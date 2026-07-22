import { describe, it, expect, vi, beforeEach } from 'vitest'

// Deleting a client used to fail with a bare 500 for anyone who had ever sent a
// message (Message.senderId is RESTRICT, so the user delete aborted), and would
// have taken the person's relationship with OTHER trainers down with it.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  getClientAccess: vi.fn(),
  profileFindUnique: vi.fn(),
  profileCount: vi.fn(),
  profileDelete: vi.fn(),
  userDelete: vi.fn(),
  messageDeleteMany: vi.fn(),
  dogUpdateMany: vi.fn(),
  dogDeleteMany: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/trainer-access', () => ({ getClientAccess: h.getClientAccess }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.profileFindUnique, count: h.profileCount, delete: h.profileDelete },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        message: { deleteMany: h.messageDeleteMany },
        clientProfile: { delete: h.profileDelete },
        user: { delete: h.userDelete },
        dog: { updateMany: h.dogUpdateMany, deleteMany: h.dogDeleteMany },
      }),
  },
}))

import { DELETE } from '@/app/api/clients/[clientId]/route'

const call = () => DELETE(new Request('http://localhost/api/clients/c1', { method: 'DELETE' }),
                          { params: Promise.resolve({ clientId: 'c1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ userId: 'u_trainer' })
  h.getClientAccess.mockResolvedValue({ trainerId: 'tr_1', client: { id: 'c1', trainerId: 'tr_1' } })
  h.profileFindUnique.mockResolvedValue({ userId: 'u_client', dogId: null, dogs: [] })
  h.profileCount.mockResolvedValue(0)
})

describe('DELETE /api/clients/[clientId]', () => {
  // The actual reported bug.
  it('clears the client’s messages so the RESTRICT on senderId cannot block it', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(h.messageDeleteMany).toHaveBeenCalled()
    // …and before the user delete, or the FK still fires.
    expect(h.messageDeleteMany.mock.invocationCallOrder[0])
      .toBeLessThan(h.userDelete.mock.invocationCallOrder[0])
  })

  it('deletes the whole person when this was their only trainer', async () => {
    await call()
    expect(h.userDelete).toHaveBeenCalledWith({ where: { id: 'u_client' } })
    expect(h.profileDelete).not.toHaveBeenCalled()
  })

  // One person can be a client of several trainers — removing them from one
  // must not delete them from the others.
  it('removes only this profile when they also work with another trainer', async () => {
    h.profileCount.mockResolvedValue(2)
    await call()
    expect(h.profileDelete).toHaveBeenCalledWith({ where: { id: 'c1' } })
    expect(h.userDelete).not.toHaveBeenCalled()
  })

  it('leaves the other trainers’ messages alone in that case', async () => {
    h.profileCount.mockResolvedValue(1)
    await call()
    // Scoped to this client profile only — not everything they ever sent.
    expect(h.messageDeleteMany).toHaveBeenCalledWith({ where: { clientId: 'c1' } })
  })

  it('only the primary trainer may delete', async () => {
    h.getClientAccess.mockResolvedValue({ trainerId: 'tr_other', client: { id: 'c1', trainerId: 'tr_1' } })
    expect((await call()).status).toBe(403)
    expect(h.userDelete).not.toHaveBeenCalled()
  })

  it('404s when the client is not reachable', async () => {
    h.getClientAccess.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })
})
