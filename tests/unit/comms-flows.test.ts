import { describe, it, expect, vi, beforeEach } from 'vitest'

// Engine tests for automated communication flows. We mock Prisma and the three
// senders and pin: placeholder rendering, that a due step delivers once per
// recipient across its channels, dedup via the (step,session,user) send row,
// per-session drop-in filtering, and the Important override of a client's mute.

const h = vi.hoisted(() => ({
  stepFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  enrollmentFindMany: vi.fn(),
  sendFindMany: vi.fn(),
  sendCreate: vi.fn(),
  notificationCreate: vi.fn(),
  sendPush: vi.fn(),
  sendEmail: vi.fn(),
  renderEmail: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    commsFlowStep: { findMany: h.stepFindMany },
    trainingSession: { findMany: h.sessionFindMany },
    classEnrollment: { findMany: h.enrollmentFindMany },
    commsFlowSend: { findMany: h.sendFindMany, create: h.sendCreate },
    notification: { create: h.notificationCreate },
  },
}))
vi.mock('@/lib/push', () => ({ sendPush: h.sendPush }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail, fromTrainer: (n: string) => `${n} <noreply@pupmanager.com>` }))
vi.mock('@/lib/client-notification-email', () => ({ renderClientNotificationEmail: h.renderEmail }))

import { renderCommsMessage, processCommsFlows } from '@/lib/comms-flows'

const NOW = new Date('2026-08-01T00:00:00.000Z')
const SESSION_AT = new Date('2026-08-01T12:00:00.000Z') // 12h ahead → inside a 1-day BEFORE window

const trainer = {
  businessName: 'Waggy Tails',
  logoUrl: null,
  emailAccentColor: null,
  user: { name: 'Jess', email: 'jess@waggy.com', timezone: 'Pacific/Auckland' },
}

function step(over: Record<string, unknown> = {}) {
  return {
    id: 'step1',
    classRunId: 'run1',
    direction: 'BEFORE_SESSION',
    offsetMinutes: 1440,
    channels: ['PUSH', 'IN_APP'],
    audience: 'ENROLLED',
    customClientIds: [],
    important: false,
    title: 'Hi {{name}} & {{dog}}',
    body: '{{class}} at {{time}} — {{business}}',
    classRun: { name: 'Puppy Class', location: 'The Hall', trainer },
    ...over,
  }
}

function enrollment(over: Record<string, unknown> = {}) {
  return {
    dropInSessionId: null,
    dog: { name: 'Bailey' },
    client: { user: { id: 'u1', name: 'Sam', email: 'sam@x.com', notifyPush: true, productEmailOptOut: false } },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sessionFindMany.mockResolvedValue([{ id: 'sess1', scheduledAt: SESSION_AT }])
  h.sendFindMany.mockResolvedValue([])
  h.sendCreate.mockResolvedValue({})
  h.notificationCreate.mockResolvedValue({})
  h.sendPush.mockResolvedValue({ sent: 1, total: 1, results: [] })
  h.sendEmail.mockResolvedValue({ data: { id: 'e1' }, error: null })
  h.renderEmail.mockReturnValue({ subject: 's', html: 'h', text: 't', displayName: 'Jess', trainerEmail: 'jess@waggy.com' })
})

describe('renderCommsMessage', () => {
  it('substitutes every placeholder (whitespace-tolerant)', () => {
    const out = renderCommsMessage(
      { title: 'Hi {{name}} & {{ dog }}', body: '{{class}} on {{date}} at {{time}} @ {{location}} — {{business}}' },
      { name: 'Sam', dog: 'Bailey', time: '6:00 pm', date: 'Tuesday 5 August', class: 'Puppy Class', business: 'Waggy', location: 'Hall' },
    )
    expect(out.title).toBe('Hi Sam & Bailey')
    expect(out.body).toBe('Puppy Class on Tuesday 5 August at 6:00 pm @ Hall — Waggy')
  })
})

describe('processCommsFlows', () => {
  it('delivers a due step once per recipient across its channels', async () => {
    h.stepFindMany.mockResolvedValue([step()])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.notificationCreate).toHaveBeenCalledTimes(1)
    expect(h.notificationCreate.mock.calls[0][0].data).toMatchObject({ userId: 'u1', title: 'Hi Sam & Bailey' })
    expect(h.sendPush).toHaveBeenCalledTimes(1)
    expect(h.sendPush.mock.calls[0][0]).toBe('u1')
    expect(h.sendCreate).toHaveBeenCalledWith({ data: { stepId: 'step1', sessionId: 'sess1', userId: 'u1' } })
  })

  it('does not re-send to a recipient already recorded', async () => {
    h.stepFindMany.mockResolvedValue([step()])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.sendFindMany.mockResolvedValue([{ userId: 'u1' }])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(0)
    expect(h.notificationCreate).not.toHaveBeenCalled()
    expect(h.sendPush).not.toHaveBeenCalled()
  })

  it('excludes a drop-in enrolment whose session is not this one', async () => {
    h.stepFindMany.mockResolvedValue([step()])
    h.enrollmentFindMany.mockResolvedValue([enrollment({ dropInSessionId: 'other-session' })])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(0)
    expect(h.sendPush).not.toHaveBeenCalled()
  })

  it('respects a client mute when the step is not important', async () => {
    h.stepFindMany.mockResolvedValue([step({ channels: ['PUSH', 'EMAIL'], important: false })])
    h.enrollmentFindMany.mockResolvedValue([
      enrollment({ client: { user: { id: 'u1', name: 'Sam', email: 'sam@x.com', notifyPush: false, productEmailOptOut: true } } }),
    ])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1) // attempted + deduped
    expect(h.sendPush).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('overrides the mute when the step is important', async () => {
    h.stepFindMany.mockResolvedValue([step({ channels: ['PUSH', 'EMAIL'], important: true })])
    h.enrollmentFindMany.mockResolvedValue([
      enrollment({ client: { user: { id: 'u1', name: 'Sam', email: 'sam@x.com', notifyPush: false, productEmailOptOut: true } } }),
    ])

    await processCommsFlows(NOW)

    expect(h.sendPush).toHaveBeenCalledTimes(1)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('processCommsFlows — 1:1 package scope', () => {
  it("sends to each session's own client (no enrolments involved)", async () => {
    h.stepFindMany.mockResolvedValue([{
      id: 'pstep', classRunId: null, packageId: 'pkg1',
      direction: 'BEFORE_SESSION', offsetMinutes: 1440, channels: ['IN_APP'],
      audience: 'ENROLLED', customClientIds: [], important: false,
      title: 'Hi {{name}} & {{dog}}', body: '{{class}} at {{time}}',
      classRun: null, package: { name: 'Puppy 101', trainer },
    }])
    // The package branch queries sessions with the client + dog attached.
    h.sessionFindMany.mockResolvedValue([
      { id: 'ps1', scheduledAt: SESSION_AT, dog: { name: 'Rex' }, client: { user: { id: 'u9', name: 'Pat', email: 'pat@x.com', notifyPush: true, productEmailOptOut: false } } },
    ])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.enrollmentFindMany).not.toHaveBeenCalled() // packages have no enrolments
    expect(h.notificationCreate.mock.calls[0][0].data).toMatchObject({ userId: 'u9', title: 'Hi Pat & Rex' })
    expect(h.sendCreate).toHaveBeenCalledWith({ data: { stepId: 'pstep', sessionId: 'ps1', userId: 'u9' } })
  })
})
