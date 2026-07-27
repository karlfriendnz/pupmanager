import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// The guards on group messaging. Two things must never happen:
//
//   1. one business reaching another's group, clients, posts or participants;
//   2. a client in a BROADCAST group seeing another client's reply — that is
//      the entire promise the mode makes, and it is enforced server-side
//      rather than by the UI simply not linking to it.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  getTrainerContext: vi.fn(),
  scopeForMember: vi.fn(),
  can: vi.fn(),
  hasAddon: vi.fn(),
  enforceRateLimit: vi.fn(),
  notifyGroupPost: vi.fn(),
  groupFindUnique: vi.fn(),
  groupFindFirst: vi.fn(),
  groupCreate: vi.fn(),
  groupUpdate: vi.fn(),
  groupDelete: vi.fn(),
  participantFindUnique: vi.fn(),
  participantFindMany: vi.fn(),
  participantFindFirst: vi.fn(),
  participantCreate: vi.fn(),
  participantCreateMany: vi.fn(),
  participantUpdate: vi.fn(),
  msgFindMany: vi.fn(),
  msgFindFirst: vi.fn(),
  msgCreate: vi.fn(),
  msgUpdate: vi.fn(),
  clientFindMany: vi.fn(),
  userFindUnique: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({
  guardPermission: h.guardPermission,
  getTrainerContext: h.getTrainerContext,
  scopeForMember: h.scopeForMember,
}))
vi.mock('@/lib/permissions', () => ({ can: h.can }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit }))
vi.mock('@/lib/notify-group-post', () => ({ notifyGroupPost: h.notifyGroupPost }))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (fn: () => unknown) => { void fn() } }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    messageGroup: {
      findUnique: h.groupFindUnique, findFirst: h.groupFindFirst,
      create: h.groupCreate, update: h.groupUpdate, delete: h.groupDelete,
    },
    messageGroupParticipant: {
      findUnique: h.participantFindUnique, findMany: h.participantFindMany,
      findFirst: h.participantFindFirst, create: h.participantCreate,
      createMany: h.participantCreateMany, update: h.participantUpdate,
    },
    groupMessage: {
      findMany: h.msgFindMany, findFirst: h.msgFindFirst,
      create: h.msgCreate, update: h.msgUpdate,
    },
    clientProfile: { findMany: h.clientFindMany },
    user: { findUnique: h.userFindUnique },
    classRun: { findFirst: vi.fn().mockResolvedValue(null) },
    package: { findFirst: vi.fn().mockResolvedValue(null) },
    membership: { findFirst: vi.fn().mockResolvedValue(null) },
    classEnrollment: { findMany: vi.fn().mockResolvedValue([]) },
    clientPackage: { findMany: vi.fn().mockResolvedValue([]) },
    membershipPurchase: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

import { POST as createGroup } from '@/app/api/message-groups/route'
import { GET as getMessages, POST as postMessage } from '@/app/api/message-groups/[groupId]/messages/route'
import { GET as getResponses } from '@/app/api/message-groups/[groupId]/responses/[messageId]/route'
import { DELETE as removeParticipant } from '@/app/api/message-groups/[groupId]/participants/[participantId]/route'
import { DELETE as deleteMessage } from '@/app/api/message-groups/[groupId]/messages/[messageId]/route'

const CO = 'co1'
const OTHER_CO = 'co2'
const GROUP = 'g1' // belongs to co1
const FOREIGN_GROUP = 'g-theirs'
const TRAINER_USER = 'u-trainer'
const CLIENT_USER = 'u-client'

function asTrainer() {
  h.auth.mockResolvedValue({ user: { id: TRAINER_USER, name: 'Jess Carter', role: 'TRAINER', trainerId: CO } })
  h.getTrainerContext.mockResolvedValue({ userId: TRAINER_USER, companyId: CO, membershipId: 'm1', role: 'OWNER', permissions: {} })
  h.guardPermission.mockResolvedValue({ userId: TRAINER_USER, companyId: CO, membershipId: 'm1', role: 'OWNER', permissions: {} })
  h.can.mockReturnValue(true)
}

function asClient() {
  h.auth.mockResolvedValue({ user: { id: CLIENT_USER, name: 'Sarah', role: 'CLIENT' } })
  h.getTrainerContext.mockResolvedValue(null)
  h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Unauthorised' }, { status: 401 }))
  h.can.mockReturnValue(false)
}

beforeEach(() => {
  vi.clearAllMocks()
  asTrainer()
  h.hasAddon.mockResolvedValue(true)
  h.enforceRateLimit.mockResolvedValue(null)
  h.scopeForMember.mockReturnValue({})
  h.userFindUnique.mockResolvedValue({ name: 'Jess Carter', email: 'j@x.com' })
  h.groupCreate.mockResolvedValue({ id: GROUP, name: 'Spring Puppy Class', mode: 'BROADCAST' })
  h.participantCreate.mockResolvedValue({ id: 'p-owner' })
  h.participantCreateMany.mockResolvedValue({ count: 2 })
  h.msgFindMany.mockResolvedValue([])
  h.participantFindMany.mockResolvedValue([])
  h.participantUpdate.mockResolvedValue({})
  h.clientFindMany.mockImplementation(async ({ where }: { where: { id?: { in: string[] } } }) => {
    const mine = [
      { id: 'c1', userId: 'cu1', trainerId: CO, status: 'ACTIVE', isSample: false, user: { name: 'Sarah B', email: 's@x.com' } },
      { id: 'c2', userId: 'cu2', trainerId: CO, status: 'ACTIVE', isSample: false, user: { name: 'Tom R', email: 't@x.com' } },
    ]
    if (!where.id) return mine
    return mine.filter(c => where.id!.in.includes(c.id))
  })
  // A group id from another business simply does not resolve for us.
  h.groupFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === GROUP
      ? { id: GROUP, trainerId: CO, mode: 'BROADCAST', name: 'Spring Puppy Class', archivedAt: null }
      : where.id === FOREIGN_GROUP
        ? { id: FOREIGN_GROUP, trainerId: OTHER_CO, mode: 'BROADCAST', name: 'Rival group', archivedAt: null }
        : null)
  h.groupFindFirst.mockImplementation(async ({ where }: { where: { id: string; trainerId: string } }) =>
    where.id === GROUP && where.trainerId === CO ? { id: GROUP, scope: 'MANUAL' } : null)
  h.participantFindUnique.mockResolvedValue(null)
})

describe('POST /api/message-groups — creation guards', () => {
  it('creates a group and puts the trainer in it as a moderator', async () => {
    const res = await createGroup(new Request('https://app.pupmanager.com/api/message-groups', {
      method: 'POST',
      body: JSON.stringify({ mode: 'BROADCAST', scope: 'MANUAL', clientIds: ['c1', 'c2'], name: 'Spring Puppy Class' }),
    }))
    expect(res.status).toBe(201)
    expect(h.participantCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'OWNER', userId: TRAINER_USER }) }),
    )
  })

  it('joins BROADCAST members immediately — nobody is exposed, so there is nothing to consent to', async () => {
    await createGroup(new Request('https://app.pupmanager.com/api/message-groups', {
      method: 'POST',
      body: JSON.stringify({ mode: 'BROADCAST', scope: 'MANUAL', clientIds: ['c1', 'c2'] }),
    }))
    const rows = h.participantCreateMany.mock.calls[0][0].data as { joinedAt: Date | null }[]
    expect(rows.every(r => r.joinedAt instanceof Date)).toBe(true)
  })

  it('leaves COMMUNITY members UNJOINED — opt-in, default off', async () => {
    await createGroup(new Request('https://app.pupmanager.com/api/message-groups', {
      method: 'POST',
      body: JSON.stringify({ mode: 'COMMUNITY', scope: 'MANUAL', clientIds: ['c1', 'c2'] }),
    }))
    const rows = h.participantCreateMany.mock.calls[0][0].data as { joinedAt: Date | null }[]
    expect(rows.every(r => r.joinedAt === null)).toBe(true)
  })

  it('stores first names only as the display name', async () => {
    await createGroup(new Request('https://app.pupmanager.com/api/message-groups', {
      method: 'POST',
      body: JSON.stringify({ mode: 'COMMUNITY', scope: 'MANUAL', clientIds: ['c1', 'c2'] }),
    }))
    const rows = h.participantCreateMany.mock.calls[0][0].data as { displayName: string }[]
    expect(rows.map(r => r.displayName)).toEqual(['Sarah', 'Tom'])
    // No email anywhere in what we persisted.
    expect(JSON.stringify(rows)).not.toMatch(/@x\.com/)
  })

  it('refuses without messages.send', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    const res = await createGroup(new Request('https://app.pupmanager.com/api/message-groups', {
      method: 'POST', body: JSON.stringify({ mode: 'BROADCAST', scope: 'MANUAL', clientIds: ['c1'] }),
    }))
    expect(res.status).toBe(403)
    expect(h.groupCreate).not.toHaveBeenCalled()
  })

  it('refuses when the client app add-on is off', async () => {
    h.hasAddon.mockResolvedValue(false)
    const res = await createGroup(new Request('https://app.pupmanager.com/api/message-groups', {
      method: 'POST', body: JSON.stringify({ mode: 'BROADCAST', scope: 'MANUAL', clientIds: ['c1'] }),
    }))
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ code: 'ADDON_REQUIRED' })
    expect(h.groupCreate).not.toHaveBeenCalled()
  })

  it('silently drops another business’s client id', async () => {
    const res = await createGroup(new Request('https://app.pupmanager.com/api/message-groups', {
      method: 'POST',
      body: JSON.stringify({ mode: 'BROADCAST', scope: 'MANUAL', clientIds: ['c1', 'c-theirs'] }),
    }))
    expect(res.status).toBe(201)
    const rows = h.participantCreateMany.mock.calls[0][0].data as { clientProfileId: string }[]
    expect(rows.map(r => r.clientProfileId)).toEqual(['c1'])
    await expect(res.json()).resolves.toMatchObject({
      skipped: [{ clientId: 'c-theirs', reason: 'NOT_FOUND' }],
    })
  })

  it('422s rather than creating an empty group', async () => {
    h.clientFindMany.mockResolvedValue([])
    const res = await createGroup(new Request('https://app.pupmanager.com/api/message-groups', {
      method: 'POST', body: JSON.stringify({ mode: 'BROADCAST', scope: 'MANUAL', clientIds: ['c-theirs'] }),
    }))
    expect(res.status).toBe(422)
    expect(h.groupCreate).not.toHaveBeenCalled()
  })
})

describe('GET messages — tenancy and consent', () => {
  const params = (groupId: string) => ({ params: Promise.resolve({ groupId }) })
  const req = (groupId: string) => new Request(`https://app.pupmanager.com/api/message-groups/${groupId}/messages`)

  it('404s another business’s group for a trainer', async () => {
    const res = await getMessages(req(FOREIGN_GROUP), params(FOREIGN_GROUP))
    expect(res.status).toBe(404)
  })

  it('404s a group a client has no participant row on', async () => {
    asClient()
    h.participantFindUnique.mockResolvedValue(null)
    const res = await getMessages(req(GROUP), params(GROUP))
    expect(res.status).toBe(404)
  })

  it('404s once a member has LEFT — leaving takes their access with it', async () => {
    asClient()
    h.participantFindUnique.mockResolvedValue({
      id: 'p1', role: 'CLIENT', displayName: 'Sarah', joinedAt: new Date(), lastReadAt: null, leftAt: new Date(),
    })
    const res = await getMessages(req(GROUP), params(GROUP))
    expect(res.status).toBe(404)
  })

  it('shows an unaccepted COMMUNITY invitation NOTHING — not the posts, not the members', async () => {
    asClient()
    h.groupFindUnique.mockResolvedValue({ id: GROUP, trainerId: CO, mode: 'COMMUNITY', name: 'Puppy chat', archivedAt: null })
    h.participantFindUnique.mockResolvedValue({
      id: 'p1', role: 'CLIENT', displayName: 'Sarah', joinedAt: null, lastReadAt: null, leftAt: null,
    })
    const res = await getMessages(req(GROUP), params(GROUP))
    const data = await res.json()
    expect(data.group.joined).toBe(false)
    expect(data.group.canPost).toBe(false)
    expect(data.messages).toEqual([])
    expect(data.participants).toEqual([])
    // It must not even have queried the conversation.
    expect(h.msgFindMany).not.toHaveBeenCalled()
  })

  it('withholds the member list from a client in a BROADCAST group', async () => {
    asClient()
    h.participantFindUnique.mockResolvedValue({
      id: 'p1', role: 'CLIENT', displayName: 'Sarah', joinedAt: new Date(), lastReadAt: null, leftAt: null,
    })
    h.participantFindMany.mockResolvedValue([
      { id: 'p1', userId: CLIENT_USER, displayName: 'Sarah', role: 'CLIENT', joinedAt: new Date(), leftAt: null },
      { id: 'p2', userId: 'cu2', displayName: 'Tom', role: 'CLIENT', joinedAt: new Date(), leftAt: null },
    ])
    const res = await getMessages(req(GROUP), params(GROUP))
    const data = await res.json()
    expect(data.participants).toEqual([])
  })

  it('applies the client visibility filter — public posts plus their OWN replies', async () => {
    asClient()
    h.participantFindUnique.mockResolvedValue({
      id: 'p1', role: 'CLIENT', displayName: 'Sarah', joinedAt: new Date(), lastReadAt: null, leftAt: null,
    })
    await getMessages(req(GROUP), params(GROUP))
    expect(h.msgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          OR: [{ visibility: 'EVERYONE' }, { senderId: CLIENT_USER }],
        }),
      }),
    )
  })

  it('renders a departed member as "Removed member", never their name', async () => {
    h.msgFindMany.mockResolvedValue([
      { id: 'm1', body: 'see you there', bodyHtml: null, senderId: 'cu9', createdAt: new Date(), visibility: 'EVERYONE', replyToId: null },
    ])
    h.participantFindMany.mockResolvedValue([
      { id: 'p9', userId: 'cu9', displayName: 'Nadia', role: 'CLIENT', joinedAt: new Date(), leftAt: new Date() },
    ])
    const res = await getMessages(req(GROUP), params(GROUP))
    const data = await res.json()
    expect(data.messages[0].senderName).toBe('Removed member')
    expect(JSON.stringify(data.messages)).not.toContain('Nadia')
  })
})

describe('POST messages — who may post', () => {
  const params = (groupId: string) => ({ params: Promise.resolve({ groupId }) })
  function req(groupId: string, body: Record<string, unknown>) {
    return new Request(`https://app.pupmanager.com/api/message-groups/${groupId}/messages`, {
      method: 'POST', body: JSON.stringify(body),
    })
  }

  beforeEach(() => {
    h.msgCreate.mockResolvedValue({
      id: 'm1', body: 'hi', createdAt: new Date(), senderId: TRAINER_USER, visibility: 'EVERYONE', replyToId: null,
    })
    h.groupUpdate.mockResolvedValue({})
  })

  it('writes a trainer post as EVERYONE', async () => {
    await postMessage(req(GROUP, { body: 'Class is cancelled' }), params(GROUP))
    expect(h.msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ visibility: 'EVERYONE' }) }),
    )
  })

  it('writes a client reply in a BROADCAST as TRAINER_ONLY', async () => {
    asClient()
    h.participantFindUnique.mockResolvedValue({
      id: 'p1', role: 'CLIENT', displayName: 'Sarah', joinedAt: new Date(), lastReadAt: null, leftAt: null,
    })
    await postMessage(req(GROUP, { body: 'I can make it' }), params(GROUP))
    expect(h.msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ visibility: 'TRAINER_ONLY' }) }),
    )
  })

  it('blocks a COMMUNITY member who has not accepted — posting would expose them', async () => {
    asClient()
    h.groupFindUnique.mockResolvedValue({ id: GROUP, trainerId: CO, mode: 'COMMUNITY', name: 'Chat', archivedAt: null })
    h.participantFindUnique.mockResolvedValue({
      id: 'p1', role: 'CLIENT', displayName: 'Sarah', joinedAt: null, lastReadAt: null, leftAt: null,
    })
    const res = await postMessage(req(GROUP, { body: 'hello everyone' }), params(GROUP))
    expect(res.status).toBe(403)
    expect(h.msgCreate).not.toHaveBeenCalled()
  })

  it('blocks posting to a closed group', async () => {
    h.groupFindUnique.mockResolvedValue({ id: GROUP, trainerId: CO, mode: 'BROADCAST', name: 'x', archivedAt: new Date() })
    const res = await postMessage(req(GROUP, { body: 'hi' }), params(GROUP))
    expect(res.status).toBe(403)
    expect(h.msgCreate).not.toHaveBeenCalled()
  })

  it('rejects a replyToId belonging to another group', async () => {
    h.msgFindFirst.mockResolvedValue(null)
    const res = await postMessage(req(GROUP, { body: 'hi', replyToId: 'm-elsewhere' }), params(GROUP))
    expect(res.status).toBe(404)
    expect(h.msgCreate).not.toHaveBeenCalled()
  })

  it('404s another business’s group', async () => {
    const res = await postMessage(req(FOREIGN_GROUP, { body: 'hi' }), params(FOREIGN_GROUP))
    expect(res.status).toBe(404)
    expect(h.msgCreate).not.toHaveBeenCalled()
  })
})

describe('GET responses — the broadcast privacy guarantee', () => {
  const params = (groupId: string, messageId: string) =>
    ({ params: Promise.resolve({ groupId, messageId }) })
  const req = (groupId: string, messageId: string) =>
    new Request(`https://app.pupmanager.com/api/message-groups/${groupId}/responses/${messageId}`)

  beforeEach(() => {
    h.msgFindFirst.mockResolvedValue({ id: 'm1', body: 'What time suits?', createdAt: new Date(), senderId: TRAINER_USER })
  })

  it('403s a CLIENT in a BROADCAST group — they must never see others’ replies', async () => {
    asClient()
    h.participantFindUnique.mockResolvedValue({
      id: 'p1', role: 'CLIENT', displayName: 'Sarah', joinedAt: new Date(), lastReadAt: null, leftAt: null,
    })
    const res = await getResponses(req(GROUP, 'm1'), params(GROUP, 'm1'))
    expect(res.status).toBe(403)
  })

  it('allows a client in a COMMUNITY group, where they can see each other anyway', async () => {
    asClient()
    h.groupFindUnique.mockResolvedValue({ id: GROUP, trainerId: CO, mode: 'COMMUNITY', name: 'Chat', archivedAt: null })
    h.participantFindUnique.mockResolvedValue({
      id: 'p1', role: 'CLIENT', displayName: 'Sarah', joinedAt: new Date(), lastReadAt: null, leftAt: null,
    })
    h.participantFindMany.mockResolvedValue([])
    h.msgFindMany.mockResolvedValue([])
    const res = await getResponses(req(GROUP, 'm1'), params(GROUP, 'm1'))
    expect(res.status).toBe(200)
  })

  it('lists everyone, including the people who never answered', async () => {
    h.participantFindMany.mockResolvedValue([
      { id: 'p1', userId: 'cu1', clientProfileId: 'c1', displayName: 'Sarah', joinedAt: new Date(), leftAt: null },
      { id: 'p2', userId: 'cu2', clientProfileId: 'c2', displayName: 'Tom', joinedAt: new Date(), leftAt: null },
      { id: 'p3', userId: 'cu3', clientProfileId: 'c3', displayName: 'Nadia', joinedAt: new Date(), leftAt: null },
    ])
    h.msgFindMany.mockResolvedValue([
      { id: 'r1', senderId: 'cu1', body: 'Tuesday works', createdAt: new Date() },
    ])
    const res = await getResponses(req(GROUP, 'm1'), params(GROUP, 'm1'))
    const data = await res.json()
    expect(data.totalCount).toBe(3)
    expect(data.repliedCount).toBe(1)
    // Silence is information, not an omission.
    expect(data.rows.filter((r: { replied: boolean }) => !r.replied).map((r: { displayName: string }) => r.displayName))
      .toEqual(['Nadia', 'Tom'])
  })

  it('404s another business’s group', async () => {
    const res = await getResponses(req(FOREIGN_GROUP, 'm1'), params(FOREIGN_GROUP, 'm1'))
    expect(res.status).toBe(404)
  })

  it('drilling into one person never shows another client’s reply', async () => {
    h.participantFindMany.mockResolvedValue([
      { id: 'p1', userId: 'cu1', clientProfileId: 'c1', displayName: 'Sarah', joinedAt: new Date(), leftAt: null },
      { id: 'p2', userId: 'cu2', clientProfileId: 'c2', displayName: 'Tom', joinedAt: new Date(), leftAt: null },
    ])
    h.msgFindMany.mockResolvedValue([
      { id: 'r1', senderId: 'cu1', body: 'Sarah says Tuesday', createdAt: new Date() },
      { id: 'r2', senderId: 'cu2', body: 'Tom says Thursday', createdAt: new Date() },
      { id: 'r3', senderId: TRAINER_USER, body: 'Noted, thanks', createdAt: new Date() },
    ])
    const res = await getResponses(
      new Request(`https://app.pupmanager.com/api/message-groups/${GROUP}/responses/m1?person=p1`),
      params(GROUP, 'm1'),
    )
    const data = await res.json()
    const bodies = data.messages.map((m: { body: string }) => m.body)
    expect(bodies).toContain('Sarah says Tuesday')
    expect(bodies).toContain('Noted, thanks') // the business replying
    expect(bodies).not.toContain('Tom says Thursday')
  })
})

describe('moderation', () => {
  it('removing a person sets optedOutAt so a roster refresh cannot re-add them', async () => {
    h.participantFindFirst.mockResolvedValue({ id: 'p2', role: 'CLIENT' })
    h.participantUpdate.mockResolvedValue({})
    const res = await removeParticipant(
      new Request('https://x', { method: 'DELETE' }),
      { params: Promise.resolve({ groupId: GROUP, participantId: 'p2' }) },
    )
    expect(res.status).toBe(200)
    const data = h.participantUpdate.mock.calls[0][0].data
    expect(data.leftAt).toBeInstanceOf(Date)
    expect(data.optedOutAt).toBeInstanceOf(Date)
  })

  it('404s a participant in another business’s group', async () => {
    h.participantFindFirst.mockResolvedValue(null)
    const res = await removeParticipant(
      new Request('https://x', { method: 'DELETE' }),
      { params: Promise.resolve({ groupId: FOREIGN_GROUP, participantId: 'p-theirs' }) },
    )
    expect(res.status).toBe(404)
    expect(h.participantUpdate).not.toHaveBeenCalled()
  })

  it('deleting a post TOMBSTONES it rather than destroying the row', async () => {
    h.msgFindFirst.mockResolvedValue({ id: 'm1', deletedAt: null })
    h.msgUpdate.mockResolvedValue({})
    await deleteMessage(
      new Request('https://x', { method: 'DELETE' }),
      { params: Promise.resolve({ groupId: GROUP, messageId: 'm1' }) },
    )
    expect(h.msgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    )
  })

  it('404s a post in another business’s group', async () => {
    h.msgFindFirst.mockResolvedValue(null)
    const res = await deleteMessage(
      new Request('https://x', { method: 'DELETE' }),
      { params: Promise.resolve({ groupId: FOREIGN_GROUP, messageId: 'm-theirs' }) },
    )
    expect(res.status).toBe(404)
    expect(h.msgUpdate).not.toHaveBeenCalled()
  })
})
