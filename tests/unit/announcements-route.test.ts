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
  clientFindMany: vi.fn(),
  notifCreateMany: vi.fn(),
  userFindMany: vi.fn(),
  sendPush: vi.fn(),
  sendEmailBatch: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    announcement: { findMany: h.annFindMany, findUnique: h.annFindUnique, create: h.annCreate, update: h.annUpdate },
    trainerMembership: { findMany: h.membershipFindMany },
    clientProfile: { findMany: h.clientFindMany },
    notification: { createMany: h.notifCreateMany },
    user: { findMany: h.userFindMany },
  },
}))
vi.mock('@/lib/push', () => ({ sendPush: h.sendPush }))
vi.mock('@/lib/email', () => ({ sendEmailBatch: h.sendEmailBatch, PLATFORM_FROM: 'updates@pupmanager.com' }))
vi.mock('@/lib/announcement-email', () => ({ renderAnnouncementEmail: ({ subject }: { subject: string }) => ({ subject, html: '<x/>' }) }))
vi.mock('@/lib/unsubscribe-token', () => ({ productUnsubscribeUrl: (id: string) => `https://app/u/${id}` }))

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
  h.membershipFindMany.mockResolvedValue([])
  h.clientFindMany.mockResolvedValue([])
  h.sendEmailBatch.mockResolvedValue({})
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

  it('persists a chosen audience', async () => {
    h.annCreate.mockResolvedValue({ id: 'a2' })
    await POST(req({ title: 'Update the app', body: 'A new version is ready.', audience: 'EVERYONE' }))
    expect(h.annCreate.mock.calls[0][0].data).toMatchObject({ audience: 'EVERYONE' })
  })

  it('rejects an unknown audience', async () => {
    const res = await POST(req({ title: 'A good title', body: 'ok', audience: 'ALL_DOGS' }))
    expect(res.status).toBe(400)
    expect(h.annCreate).not.toHaveBeenCalled()
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

  it('emails the audience when sendEmail is on, from PupManager', async () => {
    h.annFindUnique.mockResolvedValue({ id: 'a1', status: 'DRAFT', title: 'T', body: 'B', link: null, audience: 'ALL_TRAINERS', sendEmail: true, emailSubject: 'Hello', emailHtml: '<p>hi</p>' })
    h.membershipFindMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])
    // 1st user.findMany = push (none), 2nd = email recipients.
    h.userFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'u1', email: 'a@x.com' }, { id: 'u2', email: 'b@x.com' }])

    const res = await SEND(new Request('https://x/send', { method: 'POST' }), params('a1'))
    expect((await res.json()).emailRecipientCount).toBe(2)

    expect(h.sendEmailBatch).toHaveBeenCalledTimes(1)
    const msgs = h.sendEmailBatch.mock.calls[0][0]
    expect(msgs.map((m: { to: string }) => m.to)).toEqual(['a@x.com', 'b@x.com'])
    expect(msgs.every((m: { from: string }) => m.from === 'updates@pupmanager.com')).toBe(true)

    // Recipients query excludes opted-out users AND placeholder (no-email) addresses.
    const emailWhere = h.userFindMany.mock.calls[1][0].where
    expect(emailWhere.productEmailOptOut).toBe(false)
    expect(emailWhere.NOT.email.endsWith).toBe('@no-email.pupmanager.app')
  })

  it('does not email when sendEmail is off', async () => {
    h.annFindUnique.mockResolvedValue({ id: 'a1', status: 'DRAFT', title: 'T', body: 'B', link: null, audience: 'ALL_TRAINERS', sendEmail: false })
    h.membershipFindMany.mockResolvedValue([{ userId: 'u1' }])
    const res = await SEND(new Request('https://x/send', { method: 'POST' }), params('a1'))
    expect((await res.json()).emailRecipientCount).toBe(0)
    expect(h.sendEmailBatch).not.toHaveBeenCalled()
  })

  it('email failure never fails the send (bell already went out)', async () => {
    h.annFindUnique.mockResolvedValue({ id: 'a1', status: 'DRAFT', title: 'T', body: 'B', link: null, audience: 'ALL_TRAINERS', sendEmail: true, emailSubject: 'S', emailHtml: '<p>x</p>' })
    h.membershipFindMany.mockResolvedValue([{ userId: 'u1' }])
    h.userFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'u1', email: 'a@x.com' }])
    h.sendEmailBatch.mockRejectedValue(new Error('resend down'))
    const res = await SEND(new Request('https://x/send', { method: 'POST' }), params('a1'))
    expect(res.status).toBe(200)
    expect((await res.json()).emailRecipientCount).toBe(0)
  })

  it('ALL_CLIENTS fans out to clients only, never trainers', async () => {
    h.annFindUnique.mockResolvedValue({ id: 'a1', status: 'DRAFT', title: 'T', body: 'B', link: null, audience: 'ALL_CLIENTS' })
    h.clientFindMany.mockResolvedValue([{ userId: 'c1' }, { userId: 'c2' }])

    const res = await SEND(new Request('https://x/send', { method: 'POST' }), params('a1'))
    expect(await res.json()).toMatchObject({ recipientCount: 2 })
    expect(h.membershipFindMany).not.toHaveBeenCalled()
    // Real clients only — sample previews excluded.
    expect(h.clientFindMany.mock.calls[0][0]).toMatchObject({ where: { isSample: false } })
    expect(h.notifCreateMany.mock.calls[0][0].data.map((r: { userId: string }) => r.userId)).toEqual(['c1', 'c2'])
  })

  it('EVERYONE unions trainers + clients and de-dupes shared users', async () => {
    h.annFindUnique.mockResolvedValue({ id: 'a1', status: 'DRAFT', title: 'T', body: 'B', link: null, audience: 'EVERYONE' })
    h.membershipFindMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'shared' }])
    h.clientFindMany.mockResolvedValue([{ userId: 'shared' }, { userId: 'c1' }]) // 'shared' is both a trainer and a client

    const res = await SEND(new Request('https://x/send', { method: 'POST' }), params('a1'))
    // 3 distinct people, not 4 — 'shared' counted once.
    expect(await res.json()).toMatchObject({ recipientCount: 3 })
    const ids = h.notifCreateMany.mock.calls[0][0].data.map((r: { userId: string }) => r.userId)
    expect(new Set(ids)).toEqual(new Set(['u1', 'shared', 'c1']))
    expect(ids).toHaveLength(3)
  })
})
