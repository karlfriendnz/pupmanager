import { describe, it, expect, vi, beforeEach } from 'vitest'

// notifyTrainer now writes an in-app Notification row (the trainer's /notifications
// feed) for any type that lists IN_APP — previously trainer notifications were
// push + email ONLY, so nothing ever landed in-system. These pin that behaviour.
const h = vi.hoisted(() => ({
  resolvePref: vi.fn(),
  notificationCreate: vi.fn(),
  userFindUnique: vi.fn(),
  sendPush: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/notification-prefs', () => ({ resolvePref: h.resolvePref }))
vi.mock('@/lib/prisma', () => ({
  prisma: { notification: { create: h.notificationCreate }, user: { findUnique: h.userFindUnique } },
}))
vi.mock('@/lib/push', () => ({ sendPush: h.sendPush }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail, fromTrainer: () => 'PupManager <x@y.z>' }))
vi.mock('@/lib/email-html', () => ({ emailBodyToHtml: (s: string) => s, emailHtmlToText: (s: string) => s }))

import { notifyTrainer } from '@/lib/trainer-notify'

beforeEach(() => {
  vi.clearAllMocks()
  // Every channel enabled by default; title/body are simple templated strings.
  h.resolvePref.mockResolvedValue({ enabled: true, title: 'Hi {{clientName}}', body: 'Logged {{taskTitle}}' })
  h.notificationCreate.mockResolvedValue({})
  h.userFindUnique.mockResolvedValue({ notifyPush: true, email: 'trainer@e2e.test' })
  h.sendPush.mockResolvedValue(undefined)
  h.sendEmail.mockResolvedValue(undefined)
})

describe('notifyTrainer — in-app feed row', () => {
  it('creates the in-app row with the rendered copy + deep link', async () => {
    await notifyTrainer('user-1', 'CLIENT_LOGGED_TRAINING', { clientName: 'Karl', taskTitle: 'Loose-lead' }, '/clients/cp-1', 'trainer-1')
    expect(h.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'CLIENT_LOGGED_TRAINING',
        title: 'Hi Karl',
        body: 'Logged Loose-lead',
        link: '/clients/cp-1',
      }),
    })
  })

  it('does NOT write an in-app row when the trainer turned IN_APP off', async () => {
    h.resolvePref.mockImplementation(async (_u: string, _t: string, channel: string) =>
      channel === 'IN_APP' ? { enabled: false, title: 't', body: 'b' } : { enabled: true, title: 't', body: 'b' },
    )
    await notifyTrainer('user-1', 'CLIENT_LOGGED_TRAINING', {}, '/clients/cp-1', 'trainer-1')
    expect(h.notificationCreate).not.toHaveBeenCalled()
  })

  it('does NOT write an in-app row for a push/email-only type (SESSION_REMINDER)', async () => {
    await notifyTrainer('user-1', 'SESSION_REMINDER', {}, '/schedule', 'trainer-1')
    expect(h.notificationCreate).not.toHaveBeenCalled()
  })
})
