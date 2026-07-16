import { describe, it, expect, vi, beforeEach } from 'vitest'

// unreadBadgeCountForUser() — the number written to the native app-icon badge.
// A device is one user, not one role, so this must sum unread across EVERY
// company they're a member of and EVERY client profile they own, using the same
// definition as the in-app badge (unread TRAINER_CLIENT messages they didn't
// send). These tests pin the scoping so the icon count can't silently widen or
// count a user's own sends.
const h = vi.hoisted(() => ({
  membershipFindMany: vi.fn(),
  clientProfileFindMany: vi.fn(),
  messageCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerMembership: { findMany: h.membershipFindMany },
    clientProfile: { findMany: h.clientProfileFindMany },
    message: { count: h.messageCount },
  },
}))

import { unreadBadgeCountForUser } from '@/lib/unread-messages'

const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  h.membershipFindMany.mockResolvedValue([])
  h.clientProfileFindMany.mockResolvedValue([])
  h.messageCount.mockResolvedValue(0)
})

describe('unreadBadgeCountForUser — the native icon badge total', () => {
  it('returns 0 without querying messages when the user has no threads at all', async () => {
    expect(await unreadBadgeCountForUser(USER)).toBe(0)
    expect(h.messageCount).not.toHaveBeenCalled()
  })

  it('counts unread across every company the user is a member of', async () => {
    h.membershipFindMany.mockResolvedValue([{ companyId: 'co-a' }, { companyId: 'co-b' }])
    h.messageCount.mockResolvedValue(3)

    expect(await unreadBadgeCountForUser(USER)).toBe(3)
    const where = h.messageCount.mock.calls[0][0].where
    expect(where.channel).toBe('TRAINER_CLIENT')
    expect(where.readAt).toBeNull()
    expect(where.senderId).toEqual({ not: USER }) // never counts the user's own sends
    expect(where.OR).toEqual([{ client: { is: { trainerId: { in: ['co-a', 'co-b'] } } } }])
  })

  it('counts unread across every client profile the user owns', async () => {
    h.clientProfileFindMany.mockResolvedValue([{ id: 'cp-1' }, { id: 'cp-2' }])
    h.messageCount.mockResolvedValue(5)

    expect(await unreadBadgeCountForUser(USER)).toBe(5)
    const where = h.messageCount.mock.calls[0][0].where
    expect(where.OR).toEqual([{ clientId: { in: ['cp-1', 'cp-2'] } }])
  })

  it('unions both role scopes for a dual-role user (trainer AND client)', async () => {
    h.membershipFindMany.mockResolvedValue([{ companyId: 'co-a' }])
    h.clientProfileFindMany.mockResolvedValue([{ id: 'cp-1' }])
    h.messageCount.mockResolvedValue(2)

    expect(await unreadBadgeCountForUser(USER)).toBe(2)
    const where = h.messageCount.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { client: { is: { trainerId: { in: ['co-a'] } } } },
      { clientId: { in: ['cp-1'] } },
    ])
  })
})
