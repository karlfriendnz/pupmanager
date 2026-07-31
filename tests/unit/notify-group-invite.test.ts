import { describe, it, expect, vi, beforeEach } from 'vitest'

// A COMMUNITY group writes its members in with joinedAt: null — invited, not
// joined — and notifyGroupPost deliberately skips anyone who hasn't accepted.
// Both halves are correct. With nothing sending the invitation they combined
// into a group that is born dead: created, posted into, and every member
// silently excluded with no way to learn it exists.
//
// Reproduced in the dev database: a COMMUNITY group "puppies", 7 participants,
// every one of them joinedAt NULL, one post nobody could ever see.

const h = vi.hoisted(() => ({
  groupFindUnique: vi.fn(),
  trainerFindUnique: vi.fn(),
  participantFindMany: vi.fn(),
  prefFindMany: vi.fn(),
  notifyClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    messageGroup: { findUnique: h.groupFindUnique },
    trainerProfile: { findUnique: h.trainerFindUnique },
    messageGroupParticipant: { findMany: h.participantFindMany },
    notificationPreference: { findMany: h.prefFindMany },
  },
}))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
// message-groups pulls in membership → auth → next-auth, which vitest can't
// resolve. Only `chunk` is needed here and it is pure.
vi.mock('@/lib/membership', () => ({ scopeForMember: () => ({}) }))

import { notifyGroupInvite } from '@/lib/notify-group-invite'

const GROUP = 'g1'
const community = (over: Record<string, unknown> = {}) => ({
  id: GROUP, name: 'puppies', mode: 'COMMUNITY', trainerId: 'tr1', archivedAt: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.groupFindUnique.mockResolvedValue(community())
  h.trainerFindUnique.mockResolvedValue({ businessName: 'Summit Canine' })
  h.prefFindMany.mockResolvedValue([])
  h.participantFindMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])
})

describe('inviting people to a community group', () => {
  it('asks every pending member, or the group can never start', async () => {
    await notifyGroupInvite({ groupId: GROUP })
    expect(h.notifyClient).toHaveBeenCalledTimes(2)
  })

  it('only asks people who have not joined, left, or opted out', async () => {
    await notifyGroupInvite({ groupId: GROUP })
    const where = h.participantFindMany.mock.calls[0][0].where
    expect(where.joinedAt).toBeNull()
    expect(where.leftAt).toBeNull()
    expect(where.optedOutAt).toBeNull()
    expect(where.role).toBe('CLIENT')
  })

  it('says what accepting actually means before they accept it', async () => {
    // The one disclosure that matters: joining makes them visible to strangers.
    await notifyGroupInvite({ groupId: GROUP })
    const { vars } = h.notifyClient.mock.calls[0][0]
    expect(vars.preview).toContain('puppies')
    expect(vars.preview).toMatch(/see your name/i)
  })

  it('sends push and nothing else — email belongs to Marketing', async () => {
    await notifyGroupInvite({ groupId: GROUP })
    expect(h.notifyClient.mock.calls[0][0].channels).toEqual(['PUSH'])
  })

  it('never invites anyone to a BROADCAST group — they are already in it', async () => {
    h.groupFindUnique.mockResolvedValue(community({ mode: 'BROADCAST' }))
    await notifyGroupInvite({ groupId: GROUP })
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('stays quiet on an archived group', async () => {
    h.groupFindUnique.mockResolvedValue(community({ archivedAt: new Date() }))
    await notifyGroupInvite({ groupId: GROUP })
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('honours a client who turned push off', async () => {
    // Passing `channels` overrides the stored preference outright, so it has to
    // be checked here or "push only" becomes "push regardless".
    h.prefFindMany.mockResolvedValue([{ userId: 'u1', enabled: false }])
    await notifyGroupInvite({ groupId: GROUP })
    expect(h.notifyClient).toHaveBeenCalledTimes(1)
    expect(h.notifyClient.mock.calls[0][0].userId).toBe('u2')
  })

  it('one dead device token does not stop the rest being asked', async () => {
    h.notifyClient.mockRejectedValueOnce(new Error('no such token'))
    await expect(notifyGroupInvite({ groupId: GROUP })).resolves.toBeUndefined()
    expect(h.notifyClient).toHaveBeenCalledTimes(2)
  })

  it('can re-ask a named subset rather than everyone', async () => {
    await notifyGroupInvite({ groupId: GROUP, userIds: ['u2'] })
    expect(h.participantFindMany.mock.calls[0][0].where.userId).toEqual({ in: ['u2'] })
  })
})
