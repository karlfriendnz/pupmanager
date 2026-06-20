import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getClientAccess: vi.fn(),
  dogFindFirst: vi.fn(),
  dogDelete: vi.fn(),
  clientUpdate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/trainer-access', () => ({ getClientAccess: h.getClientAccess }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    dog: { findFirst: h.dogFindFirst, delete: h.dogDelete },
    clientProfile: { update: h.clientUpdate },
  },
}))

import { DELETE } from '@/app/api/clients/[clientId]/dogs/[dogId]/route'

function params(clientId: string, dogId: string) {
  return { params: Promise.resolve({ clientId, dogId }) }
}
const req = () => new Request('https://app.pupmanager.com/api/x', { method: 'DELETE' })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.dogDelete.mockResolvedValue({})
  h.clientUpdate.mockResolvedValue({})
})

describe('DELETE dogs/[dogId] — cross-tenant IDOR guard', () => {
  it('returns 404 and does NOT delete when the dog is not owned by the client', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1' } })
    h.getClientAccess.mockResolvedValue({ client: { dogId: 'own-dog', trainerId: 'co1' }, canEdit: true })
    // The ownership-scoped lookup finds nothing → foreign dog.
    h.dogFindFirst.mockResolvedValue(null)

    const res = await DELETE(req(), params('client-1', 'FOREIGN-dog'))
    expect(res.status).toBe(404)
    expect(h.dogDelete).not.toHaveBeenCalled()
  })

  it('rejects a read-only member (canEdit false) with 403', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1' } })
    h.getClientAccess.mockResolvedValue({ client: { dogId: null, trainerId: 'co1' }, canEdit: false })
    const res = await DELETE(req(), params('client-1', 'dog-1'))
    expect(res.status).toBe(403)
    expect(h.dogDelete).not.toHaveBeenCalled()
  })

  it('rejects a non-trainer session with 401', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'c1' } })
    const res = await DELETE(req(), params('client-1', 'dog-1'))
    expect(res.status).toBe(401)
  })

  it('deletes only when the dog genuinely belongs to the client', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1' } })
    h.getClientAccess.mockResolvedValue({ client: { dogId: 'dog-1', trainerId: 'co1' }, canEdit: true })
    h.dogFindFirst.mockResolvedValue({ id: 'dog-1' }) // ownership confirmed
    const res = await DELETE(req(), params('client-1', 'dog-1'))
    expect(res.status).toBe(200)
    expect(h.dogDelete).toHaveBeenCalledTimes(1)
  })
})
