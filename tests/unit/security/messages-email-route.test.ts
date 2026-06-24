import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Cross-tenant send guards + send-time sanitisation for the two client-facing
// send paths: POST /api/messages/email (one-off composer email) and
// POST /api/sessions/bulk-send-notes (recap sends). Both must only ever reach a
// client that belongs to the caller's company. The email sender is mocked so no
// real mail is attempted, and we assert it IS / IS NOT called.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  // messages/email prisma
  clientFindFirst: vi.fn(),
  messageCreate: vi.fn(),
  // bulk-send-notes prisma
  trainerFindUnique: vi.fn(),
  responseFindMany: vi.fn(),
  responseUpdateMany: vi.fn(),
  attendanceFindMany: vi.fn(),
  attendanceUpdateMany: vi.fn(),
  // collaborators
  sendEmail: vi.fn(),
  notifyClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/email', () => ({
  sendEmail: h.sendEmail,
  fromTrainer: (n: string) => `${n} via PupManager <noreply@pupmanager.com>`,
}))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findFirst: h.clientFindFirst },
    message: { create: h.messageCreate },
    trainerProfile: { findUnique: h.trainerFindUnique },
    sessionFormResponse: { findMany: h.responseFindMany, updateMany: h.responseUpdateMany },
    sessionAttendance: { findMany: h.attendanceFindMany, updateMany: h.attendanceUpdateMany },
  },
}))

import { POST as emailPOST } from '@/app/api/messages/email/route'
import { POST as bulkPOST } from '@/app/api/sessions/bulk-send-notes/route'

const jsonReq = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const TRAINER = { user: { role: 'TRAINER', id: 'u1', trainerId: 'co1' } }
const CTX = { userId: 'u1', companyId: 'co1', membershipId: 'm1', role: 'OWNER', permissions: {} }

function clientRow(over: Record<string, unknown> = {}) {
  return {
    id: 'client-1',
    user: { name: 'Liz Reed', email: 'liz@example.com' },
    dog: { name: 'Rusty' },
    trainer: {
      businessName: 'E2E Dog School',
      logoUrl: null,
      emailAccentColor: null,
      user: { name: 'Olivia Owner', email: 'olivia@example.com' },
    },
    ...over,
  }
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guardPermission.mockResolvedValue(CTX)
  h.sendEmail.mockResolvedValue({ id: 'email_1' })
  h.notifyClient.mockResolvedValue(undefined)
  h.messageCreate.mockResolvedValue({ id: 'm1', sender: { name: 'Olivia', email: 'olivia@example.com' } })
})

describe('POST /api/messages/email — auth & permission gating', () => {
  it('returns the guard NextResponse (e.g. 403) when messages.send is denied', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    const res = await emailPOST(jsonReq({ clientId: 'client-1', subject: 's', body: '<p>hi</p>' }))
    expect(res.status).toBe(403)
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('returns 401 when the session is not a trainer', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'c1' } })
    const res = await emailPOST(jsonReq({ clientId: 'client-1', subject: 's', body: '<p>hi</p>' }))
    expect(res.status).toBe(401)
    expect(h.sendEmail).not.toHaveBeenCalled()
  })
})

describe('POST /api/messages/email — cross-tenant recipient guard', () => {
  it('a client from another company → 404 and NO email sent', async () => {
    h.auth.mockResolvedValue(TRAINER)
    h.clientFindFirst.mockResolvedValue(null) // {id, trainerId:co1} found nothing → foreign client
    const res = await emailPOST(jsonReq({ clientId: 'FOREIGN', subject: 'Hi', body: '<p>hello</p>' }))
    expect(res.status).toBe(404)
    // The recipient lookup MUST be scoped to the caller's company.
    expect(h.clientFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'FOREIGN', trainerId: 'co1' }) }),
    )
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.messageCreate).not.toHaveBeenCalled()
  })

  it('a client with no email on file → 422 and no send', async () => {
    h.auth.mockResolvedValue(TRAINER)
    h.clientFindFirst.mockResolvedValue(clientRow({ user: { name: 'Liz', email: null } }))
    const res = await emailPOST(jsonReq({ clientId: 'client-1', subject: 'Hi', body: '<p>hello</p>' }))
    expect(res.status).toBe(422)
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('rejects an empty (text-less) HTML body with 400 before any lookup', async () => {
    h.auth.mockResolvedValue(TRAINER)
    const res = await emailPOST(jsonReq({ clientId: 'client-1', subject: 'Hi', body: '<p></p>' }))
    expect(res.status).toBe(400)
    expect(h.clientFindFirst).not.toHaveBeenCalled()
  })
})

describe('POST /api/messages/email — send-time sanitisation (proves the storage gap is closed at send)', () => {
  it('a <script> in the body does NOT reach the recipient or the logged Message', async () => {
    h.auth.mockResolvedValue(TRAINER)
    h.clientFindFirst.mockResolvedValue(clientRow())
    const res = await emailPOST(jsonReq({
      clientId: 'client-1',
      subject: 'Hello {{clientName}}',
      body: '<p>Hi {{clientName}}</p><script>document.cookie</script>',
    }))
    expect(res.status).toBe(201)

    const sent = h.sendEmail.mock.calls[0][0]
    expect(sent.to).toBe('liz@example.com')
    expect(sent.html).not.toContain('<script')
    expect(sent.html).not.toContain('document.cookie')
    // Placeholders are substituted.
    expect(sent.subject).toBe('Hello Liz Reed')
    expect(sent.html).toContain('Liz Reed')

    // The logged Message.bodyHtml is the sanitised HTML too.
    const logged = h.messageCreate.mock.calls[0][0].data
    expect(logged.bodyHtml).not.toContain('<script')
    expect(logged.clientId).toBe('client-1')
  })

  it('returns 502 (not 201) when the email send throws, and does NOT log a message', async () => {
    h.auth.mockResolvedValue(TRAINER)
    h.clientFindFirst.mockResolvedValue(clientRow())
    h.sendEmail.mockRejectedValue(new Error('resend down'))
    const res = await emailPOST(jsonReq({ clientId: 'client-1', subject: 'Hi', body: '<p>hello</p>' }))
    expect(res.status).toBe(502)
    expect(h.messageCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/sessions/bulk-send-notes — auth & tenant scoping', () => {
  it('returns 401 for a non-trainer / no trainerId', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'c1' } })
    const res = await bulkPOST(jsonReq({ responseIds: ['r1'] }))
    expect(res.status).toBe(401)
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('returns 400 when nothing is selected', async () => {
    h.auth.mockResolvedValue(TRAINER)
    const res = await bulkPOST(jsonReq({}))
    expect(res.status).toBe(400)
  })

  it('scopes the draft lookup to the caller company → a foreign session matches nothing, nobody notified', async () => {
    h.auth.mockResolvedValue(TRAINER)
    h.trainerFindUnique.mockResolvedValue({ businessName: 'E2E', user: { name: 'Olivia' } })
    h.responseFindMany.mockResolvedValue([]) // session:{trainerId:co1} filtered out the foreign rows
    const res = await bulkPOST(jsonReq({ responseIds: ['foreign-r1', 'foreign-r2'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 0 })
    // The query MUST scope by the caller's company on the related session.
    expect(h.responseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ session: { trainerId: 'co1' } }) }),
    )
    expect(h.notifyClient).not.toHaveBeenCalled()
    expect(h.responseUpdateMany).not.toHaveBeenCalled()
  })

  it('group-class reports are scoped via classRun.trainerId (no cross-tenant notify)', async () => {
    h.auth.mockResolvedValue(TRAINER)
    h.trainerFindUnique.mockResolvedValue({ businessName: 'E2E', user: { name: 'Olivia' } })
    h.attendanceFindMany.mockResolvedValue([])
    const res = await bulkPOST(jsonReq({ attendanceIds: ['foreign-a1'] }))
    expect(res.status).toBe(200)
    expect(h.attendanceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ session: { classRun: { trainerId: 'co1' } } }),
      }),
    )
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('sends recap notifications for genuinely-owned 1:1 drafts', async () => {
    h.auth.mockResolvedValue(TRAINER)
    h.trainerFindUnique.mockResolvedValue({ businessName: 'E2E', user: { name: 'Olivia' } })
    h.responseFindMany.mockResolvedValue([
      { id: 'r1', sessionId: 's1', session: { title: 'Recall', dog: { name: 'Rusty' }, client: { userId: 'cu1' } } },
    ])
    h.responseUpdateMany.mockResolvedValue({ count: 1 })
    const res = await bulkPOST(jsonReq({ responseIds: ['r1'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 1 })
    expect(h.notifyClient).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'cu1', trainerId: 'co1', type: 'CLIENT_RECAP_READY' }),
    )
  })
})
