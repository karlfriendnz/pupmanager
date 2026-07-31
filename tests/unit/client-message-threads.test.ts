import { describe, it, expect, vi, beforeEach } from 'vitest'

// The client side of group messaging: what lands in a dog owner's Messages list
// and what their unread badge counts.
//
// The two things worth breaking a build over:
//   • a group belonging to another business must never appear — one person can
//     be a client of several trainers, and the list is scoped to whichever one
//     the pm-active-trainer cookie has pinned;
//   • unread must ignore their own posts and any TRAINER_ONLY post they didn't
//     write (another client's private reply in a BROADCAST group).

const h = vi.hoisted(() => ({
  participantFindMany: vi.fn(),
  groupMessageCount: vi.fn(),
  groupMessageFindFirst: vi.fn(),
  messageFindFirst: vi.fn(),
  messageCount: vi.fn(),
  clientProfileFindUnique: vi.fn(),
}))

// visibleMessagesWhere is imported for real (that predicate IS the thing under
// test), and it lives in a module that transitively reaches NextAuth. Stubbing
// auth keeps this a pure unit test.
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    messageGroupParticipant: { findMany: h.participantFindMany },
    groupMessage: { count: h.groupMessageCount, findFirst: h.groupMessageFindFirst },
    message: { findFirst: h.messageFindFirst, count: h.messageCount },
    clientProfile: { findUnique: h.clientProfileFindUnique },
  },
}))

import {
  countUnreadGroupMessages,
  countClientUnreadTotal,
  listClientMessageThreads,
} from '@/lib/client-message-threads'

const ME = 'user-client'
const MY_TRAINER = 'trainer-a'

function group(id: string, over: Record<string, unknown> = {}) {
  return {
    groupId: id,
    joinedAt: new Date('2026-07-01'),
    lastReadAt: new Date('2026-07-20'),
    group: {
      id,
      name: `Group ${id}`,
      mode: 'COMMUNITY',
      lastMessageAt: new Date('2026-07-21'),
      archivedAt: null,
    },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.participantFindMany.mockResolvedValue([])
  h.groupMessageCount.mockResolvedValue(0)
  h.groupMessageFindFirst.mockResolvedValue(null)
  h.messageFindFirst.mockResolvedValue(null)
  h.messageCount.mockResolvedValue(0)
})

describe('group scoping — the cross-business wall', () => {
  it('only asks for groups owned by the ACTIVE trainer', async () => {
    await listClientMessageThreads({
      clientId: 'cp-1', userId: ME, trainerId: MY_TRAINER, trainerName: 'Pawsome',
    })
    const where = h.participantFindMany.mock.calls[0][0].where
    expect(where.group).toEqual({ is: { trainerId: MY_TRAINER } })
    expect(where.userId).toBe(ME)
    // Someone who walked out keeps nothing — not even a row in the list.
    expect(where.leftAt).toBeNull()
  })

  it('a group at another business never reaches the list', async () => {
    // Prisma is what applies the filter, so the mock honours it: asked for
    // trainer A, it returns only trainer A's row.
    const all = [
      { ...group('g-mine'), trainerId: MY_TRAINER },
      { ...group('g-theirs'), trainerId: 'trainer-b' },
    ]
    h.participantFindMany.mockImplementation(async ({ where }: { where: { group: { is: { trainerId: string } } } }) =>
      all.filter(g => g.trainerId === where.group.is.trainerId),
    )

    const rows = await listClientMessageThreads({
      clientId: 'cp-1', userId: ME, trainerId: MY_TRAINER, trainerName: 'Pawsome',
    })
    const ids = rows.filter(r => r.kind === 'group').map(r => r.id)
    expect(ids).toEqual(['g-mine'])
    expect(ids).not.toContain('g-theirs')
  })

  it('the unread count is scoped to the active trainer too', async () => {
    await countUnreadGroupMessages({ userId: ME, trainerId: MY_TRAINER })
    expect(h.participantFindMany.mock.calls[0][0].where.group).toEqual({
      is: { trainerId: MY_TRAINER },
    })
  })
})

describe('unread counting', () => {
  it('never counts the client’s own posts, nor a TRAINER_ONLY post they did not write', async () => {
    h.participantFindMany.mockResolvedValue([
      { groupId: 'g-1', lastReadAt: new Date('2026-07-20') },
    ])
    h.groupMessageCount.mockResolvedValue(2)

    const n = await countUnreadGroupMessages({ userId: ME, trainerId: MY_TRAINER })
    expect(n).toBe(2)

    const where = h.groupMessageCount.mock.calls[0][0].where
    // Own sends excluded outright.
    expect(where.senderId).toEqual({ not: ME })
    // Visibility comes from the shared helper: deleted posts are out, and a
    // non-trainer viewer may only read EVERYONE posts or their own.
    const [visibility, watermark] = where.AND
    expect(visibility).toEqual({
      deletedAt: null,
      OR: [{ visibility: 'EVERYONE' }, { senderId: ME }],
    })
    // Combined with senderId != me, the surviving arm is EVERYONE — a
    // TRAINER_ONLY post written by another client can never satisfy both.
    expect(watermark).toEqual({ OR: [{ groupId: 'g-1', createdAt: { gt: new Date('2026-07-20') } }] })
  })

  it('a group never opened counts everything (no watermark clause)', async () => {
    h.participantFindMany.mockResolvedValue([{ groupId: 'g-1', lastReadAt: null }])
    await countUnreadGroupMessages({ userId: ME, trainerId: MY_TRAINER })
    expect(h.groupMessageCount.mock.calls[0][0].where.AND[1]).toEqual({ OR: [{ groupId: 'g-1' }] })
  })

  it('ignores groups whose invitation has not been accepted', async () => {
    await countUnreadGroupMessages({ userId: ME, trainerId: MY_TRAINER })
    expect(h.participantFindMany.mock.calls[0][0].where.joinedAt).toEqual({ not: null })
  })

  it('no live memberships → 0, and no count query at all', async () => {
    h.participantFindMany.mockResolvedValue([])
    expect(await countUnreadGroupMessages({ userId: ME, trainerId: MY_TRAINER })).toBe(0)
    expect(h.groupMessageCount).not.toHaveBeenCalled()
  })

  it('the badge total is the 1:1 count plus the group count', async () => {
    h.messageCount.mockResolvedValue(3)
    h.participantFindMany.mockResolvedValue([{ groupId: 'g-1', lastReadAt: null }])
    h.groupMessageCount.mockResolvedValue(4)
    expect(await countClientUnreadTotal({ clientId: 'cp-1', userId: ME, trainerId: MY_TRAINER })).toBe(7)
    // The 1:1 half still goes through the untouched shared helper's contract.
    expect(h.messageCount.mock.calls[0][0].where).toEqual({
      channel: 'TRAINER_CLIENT',
      readAt: null,
      senderId: { not: ME },
      clientId: 'cp-1',
    })
  })
})

describe('the list itself', () => {
  it('an unaccepted invitation shows no preview and no unread', async () => {
    h.participantFindMany.mockResolvedValue([group('g-invite', { joinedAt: null, lastReadAt: null })])
    h.groupMessageFindFirst.mockResolvedValue({ body: 'secret chatter', createdAt: new Date() })

    const rows = await listClientMessageThreads({
      clientId: 'cp-1', userId: ME, trainerId: MY_TRAINER, trainerName: 'Pawsome',
    })
    const invite = rows.find(r => r.id === 'g-invite')!
    expect(invite.pendingInvite).toBe(true)
    expect(invite.preview).toBeNull()
    expect(invite.unread).toBe(0)
    // Nothing was even fetched for it — consent comes before content.
    expect(h.groupMessageFindFirst).not.toHaveBeenCalled()
  })

  it('always includes the 1:1 thread with the active business', async () => {
    h.messageFindFirst.mockResolvedValue({ body: 'see you Tuesday', createdAt: new Date('2026-07-22') })
    const rows = await listClientMessageThreads({
      clientId: 'cp-1', userId: ME, trainerId: MY_TRAINER, trainerName: 'Pawsome',
    })
    const direct = rows.find(r => r.kind === 'direct')!
    expect(direct.name).toBe('Pawsome')
    expect(direct.preview).toBe('see you Tuesday')
  })

  it('unread floats above a newer but already-read thread', async () => {
    h.messageFindFirst.mockResolvedValue({ body: 'newest', createdAt: new Date('2026-07-25') })
    h.messageCount.mockResolvedValue(0)
    h.participantFindMany.mockResolvedValue([group('g-old')])
    h.groupMessageFindFirst.mockResolvedValue({ body: 'older', createdAt: new Date('2026-07-01') })
    h.groupMessageCount.mockResolvedValue(2)

    const rows = await listClientMessageThreads({
      clientId: 'cp-1', userId: ME, trainerId: MY_TRAINER, trainerName: 'Pawsome',
    })
    expect(rows[0].id).toBe('g-old')
  })
})

describe('countClientUnreadTotalForProfile', () => {
  it('resolves the trainer from the profile rather than trusting a caller', async () => {
    const { countClientUnreadTotalForProfile } = await import('@/lib/client-message-threads')
    h.clientProfileFindUnique.mockResolvedValue({ trainerId: MY_TRAINER })
    h.messageCount.mockResolvedValue(1)
    h.participantFindMany.mockResolvedValue([])

    expect(await countClientUnreadTotalForProfile({ clientId: 'cp-1', userId: ME })).toBe(1)
    expect(h.participantFindMany.mock.calls[0][0].where.group).toEqual({
      is: { trainerId: MY_TRAINER },
    })
  })

  it('a profile that no longer exists counts nothing', async () => {
    const { countClientUnreadTotalForProfile } = await import('@/lib/client-message-threads')
    h.clientProfileFindUnique.mockResolvedValue(null)
    expect(await countClientUnreadTotalForProfile({ clientId: 'gone', userId: ME })).toBe(0)
    expect(h.messageCount).not.toHaveBeenCalled()
  })
})
