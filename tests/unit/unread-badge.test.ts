import { describe, it, expect, vi, beforeEach } from 'vitest'

// unreadBadgeCountForUser() — the number written to the native app-icon badge.
//
// A device is one user, not one role, so this sums across EVERY company they're
// a member of and EVERY client profile they own. These tests pin the scoping so
// the icon count can't silently widen or count a user's own sends.
//
// It is TWO things added together: unread messages, and unread ALERTS. The
// alerts half was missing — the feature shipped on 2026-07-16 titled "native
// app-icon badge for unread notifications" and counted messages alone, so an
// unread alert badged the Alerts tab inside the app and left the icon outside
// it blank. The icon and the app disagreed for a fortnight.
const h = vi.hoisted(() => ({
  membershipFindMany: vi.fn(),
  clientProfileFindMany: vi.fn(),
  messageCount: vi.fn(),
  notificationCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerMembership: { findMany: h.membershipFindMany },
    clientProfile: { findMany: h.clientProfileFindMany },
    message: { count: h.messageCount },
    notification: { count: h.notificationCount },
  },
}))

import { unreadBadgeCountForUser } from '@/lib/unread-messages'

const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  h.membershipFindMany.mockResolvedValue([])
  h.clientProfileFindMany.mockResolvedValue([])
  h.messageCount.mockResolvedValue(0)
  h.notificationCount.mockResolvedValue(0)
})

describe('unreadBadgeCountForUser — the native icon badge total', () => {
  // An empty OR matches EVERYTHING, so the query is skipped rather than sent —
  // otherwise a user with no threads would be badged with the whole database.
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

describe('the alerts half', () => {
  it('counts unread alerts, not only messages', async () => {
    h.notificationCount.mockResolvedValue(1)
    expect(await unreadBadgeCountForUser(USER)).toBe(1)
  })

  it('adds the two together', async () => {
    h.membershipFindMany.mockResolvedValue([{ companyId: 'tr_1' }])
    h.messageCount.mockResolvedValue(3)
    h.notificationCount.mockResolvedValue(2)
    expect(await unreadBadgeCountForUser(USER)).toBe(5)
  })

  // Alerts hang off the USER, so somebody with no company and no client profile
  // can still have them — the old early return sent that case home with 0.
  it('reaches a user with no company and no client profile', async () => {
    h.notificationCount.mockResolvedValue(4)
    expect(await unreadBadgeCountForUser(USER)).toBe(4)
  })

  // A new message raises a message row AND a NEW_MESSAGE notification; counting
  // both shows 2 for one message.
  it('leaves NEW_MESSAGE alerts to the messages half', async () => {
    await unreadBadgeCountForUser(USER)
    expect(h.notificationCount.mock.calls[0][0].where.OR).toContainEqual({ type: { not: 'NEW_MESSAGE' } })
  })

  // A bare `not` drops NULL-typed rows in Prisma — how legacy alerts like
  // "Payment received" once counted as zero.
  it('still counts an alert that has no type at all', async () => {
    await unreadBadgeCountForUser(USER)
    expect(h.notificationCount.mock.calls[0][0].where.OR).toContainEqual({ type: null })
  })

  it('counts only what is unread, and only for this user', async () => {
    await unreadBadgeCountForUser(USER)
    const where = h.notificationCount.mock.calls[0][0].where
    expect(where.userId).toBe(USER)
    expect(where.readAt).toBeNull()
  })
})
