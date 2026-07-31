import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/message-groups/[groupId]/messages, from a dog owner's side.
//
// This is the gate the client UI renders its consent screen from, so the
// contract is worth pinning down independently of the screen:
//   • an unaccepted COMMUNITY invitation gets an EMPTY thread and an EMPTY
//     member list — the conversation stays closed until they say yes;
//   • in BROADCAST a client never receives the member list at all;
//   • what a client may read is the shared visibility predicate, never a
//     hand-rolled one.

const h = vi.hoisted(() => ({
  getGroupAccess: vi.fn(),
  canPost: vi.fn(),
  messageFindMany: vi.fn(),
  participantFindMany: vi.fn(),
  participantUpdate: vi.fn(),
  notifyGroupPost: vi.fn(),
}))

// The route defers its read-watermark write with after(), which needs a real
// request scope. Capture the callback instead so the test can assert on whether
// the watermark moved at all.
vi.mock('next/server', async orig => ({
  ...(await orig() as object),
  after: (fn: () => unknown) => { void fn() },
}))

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/message-group-access', () => ({
  getGroupAccess: h.getGroupAccess,
  canPost: h.canPost,
}))
vi.mock('@/lib/notify-group-post', () => ({ notifyGroupPost: h.notifyGroupPost }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    groupMessage: { findMany: h.messageFindMany, create: vi.fn(), findFirst: vi.fn() },
    messageGroupParticipant: { findMany: h.participantFindMany, update: h.participantUpdate },
    messageGroup: { update: vi.fn() },
  },
}))

import { GET } from '@/app/api/message-groups/[groupId]/messages/route'

const GROUP = 'grp-1'
const ME = 'user-client'

function call() {
  return GET(new Request(`https://app.pupmanager.com/api/message-groups/${GROUP}/messages`), {
    params: Promise.resolve({ groupId: GROUP }),
  })
}

function access(over: Record<string, unknown> = {}) {
  return {
    userId: ME,
    groupId: GROUP,
    trainerId: 'trainer-a',
    mode: 'COMMUNITY',
    name: 'Puppy class 2026',
    archivedAt: null,
    isTrainerSide: false,
    participant: { id: 'p-1', role: 'CLIENT', displayName: 'Sam', joinedAt: new Date(), lastReadAt: null },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.canPost.mockReturnValue(true)
  h.messageFindMany.mockResolvedValue([])
  h.participantFindMany.mockResolvedValue([])
  h.getGroupAccess.mockResolvedValue(access())
})

describe('the consent gate', () => {
  it('an unaccepted invitation gets no messages and no members', async () => {
    h.getGroupAccess.mockResolvedValue(
      access({ participant: { id: 'p-1', role: 'CLIENT', displayName: 'Sam', joinedAt: null, lastReadAt: null } }),
    )

    const body = await (await call()).json()
    expect(body.group.joined).toBe(false)
    expect(body.group.canPost).toBe(false)
    expect(body.messages).toEqual([])
    expect(body.participants).toEqual([])
    // Not "fetched and filtered" — never fetched. There is nothing in the
    // response that a leak could be squeezed out of.
    expect(h.messageFindMany).not.toHaveBeenCalled()
    expect(h.participantFindMany).not.toHaveBeenCalled()
  })

  it('an unaccepted invitation does not move the read watermark', async () => {
    h.getGroupAccess.mockResolvedValue(
      access({ participant: { id: 'p-1', role: 'CLIENT', displayName: 'Sam', joinedAt: null, lastReadAt: null } }),
    )
    await call()
    expect(h.participantUpdate).not.toHaveBeenCalled()
  })

  it('once joined, the thread opens', async () => {
    h.messageFindMany.mockResolvedValue([
      {
        id: 'm-1', body: 'Welcome!', bodyHtml: null, senderId: 'trainer-user',
        createdAt: new Date('2026-07-20'), visibility: 'EVERYONE', replyToId: null,
      },
    ])
    h.participantFindMany.mockResolvedValue([
      { id: 'p-1', userId: ME, displayName: 'Sam', role: 'CLIENT', joinedAt: new Date(), leftAt: null },
      { id: 'p-2', userId: 'trainer-user', displayName: 'Jess', role: 'OWNER', joinedAt: new Date(), leftAt: null },
    ])

    const body = await (await call()).json()
    expect(body.group.joined).toBe(true)
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].senderName).toBe('Jess')
  })
})

describe('what a client may read', () => {
  it('uses the shared visibility predicate — EVERYONE, or their own post', async () => {
    await call()
    const where = h.messageFindMany.mock.calls[0][0].where
    expect(where.groupId).toBe(GROUP)
    expect(where.deletedAt).toBeNull()
    expect(where.OR).toEqual([{ visibility: 'EVERYONE' }, { senderId: ME }])
  })

  it('a trainer-side viewer is not narrowed by visibility', async () => {
    h.getGroupAccess.mockResolvedValue(access({ isTrainerSide: true }))
    await call()
    const where = h.messageFindMany.mock.calls[0][0].where
    expect(where.OR).toBeUndefined()
    expect(where.deletedAt).toBeNull()
  })
})

describe('who a client may see', () => {
  const members = [
    { id: 'p-1', userId: ME, displayName: 'Sam', role: 'CLIENT', joinedAt: new Date(), leftAt: null },
    { id: 'p-2', userId: 'other-client', displayName: 'Alex', role: 'CLIENT', joinedAt: new Date(), leftAt: null },
  ]

  it('BROADCAST: a client never learns who else is in the group', async () => {
    h.getGroupAccess.mockResolvedValue(access({ mode: 'BROADCAST' }))
    h.participantFindMany.mockResolvedValue(members)
    const body = await (await call()).json()
    expect(body.participants).toEqual([])
  })

  it('COMMUNITY: members are display names only — no email, phone or profile id', async () => {
    h.participantFindMany.mockResolvedValue(members)
    const body = await (await call()).json()
    expect(body.participants).toEqual([
      { id: 'p-1', displayName: 'Sam', role: 'CLIENT' },
      { id: 'p-2', displayName: 'Alex', role: 'CLIENT' },
    ])
    const serialised = JSON.stringify(body)
    expect(serialised).not.toMatch(/@/)
    expect(serialised).not.toContain('clientProfileId')
  })
})
