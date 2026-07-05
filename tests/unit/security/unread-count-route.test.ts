import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/messages/unread-count — the live nav-badge poll. Guard + scoping:
// 401 unauth, client sees only their active thread, trainer sees only their
// company, a trainer previewing gets 0 (no leak of the real client's count).
const h = vi.hoisted(() => ({ auth: vi.fn(), getActiveClient: vi.fn(), countUnread: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/unread-messages', () => ({ countUnreadMessages: h.countUnread }))

import { GET } from '@/app/api/messages/unread-count/route'

beforeEach(() => {
  vi.clearAllMocks()
  h.countUnread.mockResolvedValue(5)
})

describe('GET /api/messages/unread-count', () => {
  it('401s an unauthenticated request', async () => {
    h.auth.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(h.countUnread).not.toHaveBeenCalled()
  })

  it('client: returns their active thread’s unread, scoped to the active clientId', async () => {
    h.auth.mockResolvedValue({ user: { id: 'cu-1', role: 'CLIENT' } })
    h.getActiveClient.mockResolvedValue({ clientId: 'cp-1', isPreview: false })
    const res = await GET()
    expect(await res.json()).toEqual({ count: 5 })
    expect(h.countUnread).toHaveBeenCalledWith({ kind: 'client', clientId: 'cp-1', userId: 'cu-1' })
  })

  it('trainer previewing the client app → 0 (never the real client’s count)', async () => {
    h.auth.mockResolvedValue({ user: { id: 't-user', role: 'TRAINER', trainerId: 't-1' } })
    h.getActiveClient.mockResolvedValue({ clientId: 'cp-x', isPreview: true })
    expect(await (await GET()).json()).toEqual({ count: 0 })
    expect(h.countUnread).not.toHaveBeenCalled()
  })

  it('trainer: returns their company’s unread, scoped to companyId', async () => {
    h.auth.mockResolvedValue({ user: { id: 't-user', role: 'TRAINER', trainerId: 't-1' } })
    h.getActiveClient.mockResolvedValue(null)
    const res = await GET()
    expect(await res.json()).toEqual({ count: 5 })
    expect(h.countUnread).toHaveBeenCalledWith({ kind: 'trainer', companyId: 't-1', userId: 't-user' })
  })

  it('trainer with no company resolved → 0', async () => {
    h.auth.mockResolvedValue({ user: { id: 't-user', role: 'TRAINER' } })
    h.getActiveClient.mockResolvedValue(null)
    expect(await (await GET()).json()).toEqual({ count: 0 })
    expect(h.countUnread).not.toHaveBeenCalled()
  })
})
