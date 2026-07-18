import { describe, it, expect, vi, beforeEach } from 'vitest'

// Admin-authored platform announcements. These specs prove the admin guard on
// every route and that "send" fans out one bell notification per distinct
// trainer user, marks the announcement SENT, and can't double-send.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  annFindMany: vi.fn(),
  annFindUnique: vi.fn(),
  annCreate: vi.fn(),
  annUpdate: vi.fn(),
  membershipFindMany: vi.fn(),
  notifCreateMany: vi.fn(),
  userFindMany: vi.fn(),
  sendPush: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    announcement: { findMany: h.annFindMany, findUnique: h.annFindUnique, create: h.annCreate, update: h.annUpdate },
    trainerMembership: { findMany: h.membershipFindMany },
    notification: { createMany: h.notifCreateMany },
    user: { findMany: h.userFindMany },
  },
}))
vi.mock('@/lib/push', () => ({ sendPush: h.sendPush }))

import { GET, POST } from '@/app/api/admin/announcements/route'
import { POST as SEND } from '@/app/api/admin/announcements/[id]/send/route'

const admin = { user: { id: 'admin_1', role: 'ADMIN' } }
const trainer = { user: { id: 'u_trainer', role: 'TRAINER' } }

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/admin/announcements', { method: 'POST', body: JSON.stringify(body) })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.notifCreateMany.mockResolvedValue({ count: 0 })
  h.annUpdate.mockResolvedValue({})
  h.userFindMany.mockResolvedValue([])
})

describe('admin guard', () => {
  it('GET rejects a non-admin', async () => {
    h.auth.mockResolvedValue(trainer)
    expect((await GET()).status).toBe(401)
  })

  it('POST (create) rejects a non-admin and writes nothing', async () => {
    h.auth.mockResolvedValue(trainer)
    const res = await POST(req({ title: 'Hello there', body: 'A message' }))
    expect(res.status).toBe(401)
    expect(h.annCreate).not.toHaveBeenCalled()
  })

  it('send rejects a non-admin and fans out nothing', async () => {
    h.auth.mockResolvedValue(trainer)
    const res = await SEND(new Request('https://x/send', { method: 'POST' }), params('a1'))
    expect(res.status).toBe(401)
    expect(h.notifCreateMany).not.toHaveBeenCalled()
  })

  it('send rejects an unauthenticated request', async () => {
    h.auth.mockResolvedValue(null)
    expect((await SEND(new Request('https://x/send', { method: 'POST' }), params('a1'))).status).toBe(401)
  })
})

describe('create validation', () => {
  beforeEach(() => h.auth.mockResolvedValue(admin))

  it('rejects a too-short title', async () => {
    const res = await POST(req({ title: 'hi', body: 'ok' }))
    expect(res.status).toBe(400)
    expect(h.annCreate).not.toHaveBeenCalled()
  })

  it('rejects an external link (must be an app path)', async () => {
    const res = await POST(req({ title: 'A good title', body: 'ok', link: 'https://evil.example' }))
    expect(res.status).toBe(400)
  })

  it('creates a draft with the admin as author', async () => {
    h.annCreate.mockResolvedValue({ id: 'a1' })
    const res = await POST(req({ title: 'Adding addresses is easier', body: 'You can now type any address.', link: '/clients' }))
    expect(res.status).toBe(201)
    expect(h.annCreate.mock.calls[0][0].data).toMatchObject({
      title: 'Adding addresses is easier',
      body: 'You can now type any address.',
      link: '/clients',
      createdById: 'admin_1',
    })
  })
})

describe('send fan-out', () => {
  beforeEach(() => h.auth.mockResolvedValue(admin))

  it('creates one notification per distinct trainer user and marks it SENT', async () => {
    h.annFindUnique.mockResolvedValue({ id: 'a1', status: 'DRAFT', title: 'T', body: 'B', link: '/x' })
    h.membershipFindMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }])

    const res = await SEND(new Request('https://x/send', { method: 'POST' }), params('a1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, recipientCount: 3 })

    // One row per recipient, all typed as the announcement.
    const rows = h.notifCreateMany.mock.calls[0][0].data
    expect(rows).toHaveLength(3)
    expect(rows.every((r: { type: string; title: string }) => r.type === 'PLATFORM_ANNOUNCEMENT' && r.title === 'T')).toBe(true)
    expect(rows.map((r: { userId: string }) => r.userId)).toEqual(['u1', 'u2', 'u3'])

    // Marked sent with the recipient count.
    expect(h.annUpdate.mock.calls[0][0].data).toMatchObject({ status: 'SENT', recipientCount: 3 })
  })

  it('refuses to re-send an already-sent announcement', async () => {
    h.annFindUnique.mockResolvedValue({ id: 'a1', status: 'SENT', title: 'T', body: 'B', link: null })
    const res = await SEND(new Request('https://x/send', { method: 'POST' }), params('a1'))
    expect(res.status).toBe(409)
    expect(h.notifCreateMany).not.toHaveBeenCalled()
  })

  it('404s an unknown announcement', async () => {
    h.annFindUnique.mockResolvedValue(null)
    const res = await SEND(new Request('https://x/send', { method: 'POST' }), params('nope'))
    expect(res.status).toBe(404)
  })

  it('only pushes to recipients who have push on', async () => {
    h.annFindUnique.mockResolvedValue({ id: 'a1', status: 'DRAFT', title: 'T', body: 'B', link: null })
    h.membershipFindMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])
    h.userFindMany.mockResolvedValue([{ id: 'u1' }]) // only u1 has notifyPush
    await SEND(new Request('https://x/send', { method: 'POST' }), params('a1'))
    expect(h.sendPush).toHaveBeenCalledTimes(1)
    expect(h.sendPush.mock.calls[0][0]).toBe('u1')
  })
})
