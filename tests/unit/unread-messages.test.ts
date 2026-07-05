import { describe, it, expect, vi, beforeEach } from 'vitest'

// countUnreadMessages — the shared unread-count helper behind the nav badge.
// Contract: TRAINER_CLIENT + readAt null + not-my-own-sends, tenant-scoped.
const h = vi.hoisted(() => ({ count: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { message: { count: h.count } } }))

import { countUnreadMessages } from '@/lib/unread-messages'

beforeEach(() => {
  vi.clearAllMocks()
  h.count.mockResolvedValue(3)
})

describe('countUnreadMessages', () => {
  it('trainer: scopes to the company’s threads, unread, not-mine, TRAINER_CLIENT', async () => {
    const n = await countUnreadMessages({ kind: 'trainer', companyId: 't-1', userId: 'u-1' })
    expect(n).toBe(3)
    expect(h.count.mock.calls[0][0].where).toEqual({
      channel: 'TRAINER_CLIENT',
      readAt: null,
      senderId: { not: 'u-1' },
      client: { is: { trainerId: 't-1' } },
    })
  })

  it('client: scopes to the single client-profile thread, still excludes own sends', async () => {
    await countUnreadMessages({ kind: 'client', clientId: 'cp-1', userId: 'cu-1' })
    expect(h.count.mock.calls[0][0].where).toEqual({
      channel: 'TRAINER_CLIENT',
      readAt: null,
      senderId: { not: 'cu-1' },
      clientId: 'cp-1',
    })
  })

  it('never scopes a client query by trainer (no cross-tenant widening)', async () => {
    await countUnreadMessages({ kind: 'client', clientId: 'cp-1', userId: 'cu-1' })
    expect(h.count.mock.calls[0][0].where).not.toHaveProperty('client')
  })
})
