import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A stranger at a trade show is driving a real copy of the app. Nothing they do
 * may reach anybody's inbox or phone.
 *
 * These tests prove the block at the GATE — `sendEmail`, `sendEmailBatch` and
 * `sendPush` — rather than at any one caller, because the gate is the only
 * thing all ~59 senders have in common. The assertion is always the same shape:
 * Resend / APNs was NOT called.
 */

const h = vi.hoisted(() => ({
  emailsSend: vi.fn(),
  batchSend: vi.fn(),
  auth: vi.fn(),
  userFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  profileFindUnique: vi.fn(),
  deviceFindMany: vi.fn(),
  apns: vi.fn(),
  fcm: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.emailsSend }
    batch = { send: h.batchSend }
  },
}))
vi.mock('@/lib/env', () => ({
  env: { RESEND_API_KEY: 're_test', RESEND_FROM_EMAIL: 'noreply@pupmanager.com' },
}))
vi.mock('@/lib/trainer-mail', () => ({ isTrainerMailStopped: vi.fn(async () => false) }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: h.userFindFirst, findUnique: h.userFindUnique },
    trainerProfile: { findUnique: h.profileFindUnique },
    deviceToken: { findMany: h.deviceFindMany, deleteMany: vi.fn(async () => ({ count: 0 })) },
  },
}))
vi.mock('@/lib/apns', () => ({ sendApns: h.apns, INVALID_TOKEN_REASONS: new Set<string>() }))
vi.mock('@/lib/fcm', () => ({ sendFcm: h.fcm, FCM_INVALID_TOKEN_REASONS: new Set<string>() }))
vi.mock('@/lib/unread-messages', () => ({ unreadBadgeCountForUser: vi.fn(async () => 0) }))

import { sendEmail, sendEmailBatch } from '@/lib/email'
import { sendPush } from '@/lib/push'
import { DEMO_EMAIL_DOMAIN, isDemoEmail } from '@/lib/demo-tenant'

const NOT_A_DEMO_USER = { trainerProfile: null, clientProfiles: [], memberships: [] }

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.emailsSend.mockResolvedValue({ data: { id: 'sent' }, error: null })
  h.batchSend.mockResolvedValue({ data: { data: [] }, error: null })
  h.auth.mockResolvedValue(null)
  h.userFindFirst.mockResolvedValue(null)
  h.userFindUnique.mockResolvedValue(NOT_A_DEMO_USER)
  h.profileFindUnique.mockResolvedValue(null)
  h.deviceFindMany.mockResolvedValue([{ token: 'tok', platform: 'IOS' }])
  h.apns.mockResolvedValue([{ token: 'tok', ok: true }])
  h.fcm.mockResolvedValue([])
})

describe('the demo email domain', () => {
  it('is a reserved .test domain, so nothing addressed there can leave the building', () => {
    expect(DEMO_EMAIL_DOMAIN.endsWith('.test')).toBe(true)
    expect(isDemoEmail(`demo-abc${DEMO_EMAIL_DOMAIN}`)).toBe(true)
    expect(isDemoEmail('karl@getfrello.com')).toBe(false)
    expect(isDemoEmail(null)).toBe(false)
  })
})

describe('sendEmail — a demo sandbox sends nothing', () => {
  it('sends normally when nothing about the request is a demo', async () => {
    await sendEmail({ to: 'client@example.com', subject: 'Your session', html: '<p>hi</p>' })
    expect(h.emailsSend).toHaveBeenCalledTimes(1)
  })

  it('BLOCKS when the signed-in actor is a demo session', async () => {
    // The visitor at the stand pressing "email this client". The address is a
    // perfectly ordinary one — the only thing wrong with it is who is sending.
    h.auth.mockResolvedValue({ user: { id: 'u1', trainerId: 't-demo', isDemo: true } })
    await sendEmail({ to: 'a.real.person@example.com', subject: 'Hello', html: '<p>hi</p>' })
    expect(h.emailsSend).not.toHaveBeenCalled()
  })

  it('BLOCKS even when the caller marked the message alwaysSend', async () => {
    // alwaysSend exists for password resets and money. There is no message from
    // a stranger's sandbox important enough to deliver.
    h.auth.mockResolvedValue({ user: { id: 'u1', trainerId: 't-demo', isDemo: true } })
    await sendEmail({ to: 'a.real.person@example.com', subject: 'Reset', html: '<p>hi</p>', alwaysSend: true })
    expect(h.emailsSend).not.toHaveBeenCalled()
  })

  it('BLOCKS a session whose JWT predates the flag, by re-reading the tenant', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', trainerId: 't-demo' } }) // no isDemo
    h.profileFindUnique.mockResolvedValue({ demoSessionId: 'ds-1' })
    await sendEmail({ to: 'a.real.person@example.com', subject: 'Hello', html: '<p>hi</p>' })
    expect(h.emailsSend).not.toHaveBeenCalled()
  })

  it('BLOCKS mail addressed INTO a sandbox even with no session — the cron case', async () => {
    // A cron has no request context, so the actor test says nothing about it.
    // A session reminder for a sandbox's sample class must still not go out.
    h.auth.mockResolvedValue(null)
    await sendEmail({ to: `demo-xyz${DEMO_EMAIL_DOMAIN}`, subject: 'Reminder', html: '<p>hi</p>' })
    expect(h.emailsSend).not.toHaveBeenCalled()
  })

  it('BLOCKS a sandbox client whose address the visitor edited to a real one', async () => {
    // This is the case the domain check cannot see: the address looks entirely
    // ordinary, and only the tenant it hangs off says otherwise.
    h.auth.mockResolvedValue(null)
    h.userFindFirst.mockResolvedValue({
      trainerProfile: null,
      clientProfiles: [{ trainer: { demoSessionId: 'ds-1' } }],
      memberships: [],
    })
    await sendEmail({ to: 'someone.real@example.com', subject: 'Reminder', html: '<p>hi</p>' })
    expect(h.emailsSend).not.toHaveBeenCalled()
  })

  it('does NOT block a real trainer just because the lookup shape is similar', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u2', trainerId: 't-real' } })
    h.profileFindUnique.mockResolvedValue({ demoSessionId: null })
    h.userFindFirst.mockResolvedValue({ trainerProfile: { demoSessionId: null }, clientProfiles: [], memberships: [] })
    await sendEmail({ to: 'client@example.com', subject: 'Invoice', html: '<p>hi</p>' })
    expect(h.emailsSend).toHaveBeenCalledTimes(1)
  })
})

describe('sendEmailBatch — the bulk path a visitor is most likely to find', () => {
  const messages = [
    { to: 'one@example.com', subject: 'Hi', html: '<p>1</p>', from: 'noreply@pupmanager.com' },
    { to: 'two@example.com', subject: 'Hi', html: '<p>2</p>', from: 'noreply@pupmanager.com' },
  ]

  it('sends a real trainer\'s broadcast', async () => {
    await sendEmailBatch(messages)
    expect(h.batchSend).toHaveBeenCalledTimes(1)
  })

  it('BLOCKS the whole batch when the actor is a demo session', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', trainerId: 't-demo', isDemo: true } })
    await sendEmailBatch(messages)
    expect(h.batchSend).not.toHaveBeenCalled()
  })

  it('BLOCKS the whole batch when ANY recipient is inside a sandbox', async () => {
    // No partial delivery: a batch is one call, and a mixed list is a bug
    // upstream rather than something to half-honour.
    h.auth.mockResolvedValue(null)
    h.userFindFirst.mockImplementation(async ({ where }: { where: { email: { equals: string } } }) =>
      where.email.equals === 'two@example.com'
        ? { trainerProfile: null, clientProfiles: [{ trainer: { demoSessionId: 'ds-1' } }], memberships: [] }
        : null,
    )
    await sendEmailBatch(messages)
    expect(h.batchSend).not.toHaveBeenCalled()
  })
})

describe('sendPush — the other channel out of the building', () => {
  it('pushes normally for a real user', async () => {
    const res = await sendPush('user-real', { alert: { title: 'Session', body: 'Tomorrow' } })
    expect(h.apns).toHaveBeenCalledTimes(1)
    expect(res.sent).toBe(1)
  })

  it('BLOCKS when the actor is a demo session', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', trainerId: 't-demo', isDemo: true } })
    const res = await sendPush('user-real', { alert: { title: 'Session', body: 'Tomorrow' } })
    expect(h.apns).not.toHaveBeenCalled()
    expect(h.fcm).not.toHaveBeenCalled()
    expect(res.sent).toBe(0)
  })

  it('BLOCKS a push aimed at somebody inside a sandbox, session or not', async () => {
    h.auth.mockResolvedValue(null)
    h.userFindUnique.mockResolvedValue({
      trainerProfile: { demoSessionId: 'ds-1' },
      clientProfiles: [],
      memberships: [],
    })
    const res = await sendPush('demo-owner', { alert: { title: 'Hi', body: 'There' } })
    expect(h.apns).not.toHaveBeenCalled()
    expect(res.sent).toBe(0)
  })

  it('BLOCKS a push to a team member of a sandbox', async () => {
    h.auth.mockResolvedValue(null)
    h.userFindUnique.mockResolvedValue({
      trainerProfile: null,
      clientProfiles: [],
      memberships: [{ company: { demoSessionId: 'ds-1' } }],
    })
    const res = await sendPush('demo-staff', { alert: { title: 'Hi', body: 'There' } })
    expect(h.apns).not.toHaveBeenCalled()
    expect(res.sent).toBe(0)
  })
})
