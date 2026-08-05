import { describe, it, expect, vi, beforeEach } from 'vitest'

// Engine tests for automated communication flows. We mock Prisma and the three
// senders and pin: placeholder rendering, that a due step delivers once per
// recipient across its channels, dedup via the (step,session,user) send row,
// per-session drop-in filtering, and the Important override of a client's mute.

const h = vi.hoisted(() => ({
  stepFindMany: vi.fn(),
  purchaseFindMany: vi.fn(),
  clientFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  enrollmentFindMany: vi.fn(),
  sendFindMany: vi.fn(),
  sendCreate: vi.fn(),
  notificationCreate: vi.fn(),
  classRunTrainerFindMany: vi.fn(),
  trainerMembershipFindMany: vi.fn(),
  trainerProfileFindUnique: vi.fn(),
  sendPush: vi.fn(),
  sendEmail: vi.fn(),
  renderEmail: vi.fn(),
  // Phase 2: a step can now hand out homework, ask a trainer to do something,
  // and drive one person's journey.
  libraryFindUnique: vi.fn(),
  taskFindMany: vi.fn(),
  taskCreate: vi.fn(),
  notifyTrainer: vi.fn(),
  runFindUnique: vi.fn(),
  runUpdate: vi.fn(),
  completionFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    commsFlowStep: { findMany: h.stepFindMany },
    trainingSession: { findMany: h.sessionFindMany },
    classEnrollment: { findMany: h.enrollmentFindMany },
    commsFlowSend: { findMany: h.sendFindMany, create: h.sendCreate },
    notification: { create: h.notificationCreate },
    membershipPurchase: { findMany: h.purchaseFindMany },
    clientProfile: { findMany: h.clientFindMany },
    classRunTrainer: { findMany: h.classRunTrainerFindMany },
    trainerMembership: { findMany: h.trainerMembershipFindMany },
    trainerProfile: { findUnique: h.trainerProfileFindUnique },
    libraryTask: { findUnique: h.libraryFindUnique },
    trainingTask: { findMany: h.taskFindMany, create: h.taskCreate },
    flowRun: { findUnique: h.runFindUnique, update: h.runUpdate },
    flowStepCompletion: { findMany: h.completionFindMany },
  },
}))
vi.mock('@/lib/push', () => ({ sendPush: h.sendPush }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail, fromTrainer: (n: string) => `${n} <noreply@pupmanager.com>` }))
vi.mock('@/lib/client-notification-email', () => ({ renderClientNotificationEmail: h.renderEmail }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))

import { renderCommsMessage, processCommsFlows, processFlowRun } from '@/lib/comms-flows'

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
    // Every row in the database is a MESSAGE — the column defaults to it. The
    // engine routes on it, so a fixture without one is not a DB row.
    kind: 'MESSAGE',
    trigger: null,
    direction: 'BEFORE_SESSION',
    offsetMinutes: 1440,
    channels: ['PUSH', 'IN_APP'],
    audience: 'ENROLLED',
    customClientIds: [],
    important: false,
    title: 'Hi {{name}} & {{dog}}',
    body: '{{class}} at {{time}} — {{business}}',
    classRun: { name: 'Puppy Class', location: 'The Hall', trainerId: 'co1', trainer },
    ...over,
  }
}

const staffUser = (over: Record<string, unknown> = {}) => ({
  id: 'staff1', name: 'Bree', email: 'bree@waggy.com', notifyPush: true, productEmailOptOut: false, ...over,
})

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
  h.purchaseFindMany.mockResolvedValue([])
  h.clientFindMany.mockResolvedValue([])
  h.classRunTrainerFindMany.mockResolvedValue([])
  h.trainerMembershipFindMany.mockResolvedValue([])
  h.trainerProfileFindUnique.mockResolvedValue(null)
  h.sendCreate.mockResolvedValue({})
  h.notificationCreate.mockResolvedValue({})
  h.sendPush.mockResolvedValue({ sent: 1, total: 1, results: [] })
  h.sendEmail.mockResolvedValue({ data: { id: 'e1' }, error: null })
  h.renderEmail.mockReturnValue({ subject: 's', html: 'h', text: 't', displayName: 'Jess', trainerEmail: 'jess@waggy.com' })
  h.libraryFindUnique.mockResolvedValue(null)
  h.taskFindMany.mockResolvedValue([])
  h.taskCreate.mockResolvedValue({ id: 'task1' })
  h.notifyTrainer.mockResolvedValue(undefined)
  h.runFindUnique.mockResolvedValue(null)
  h.runUpdate.mockResolvedValue({})
  h.completionFindMany.mockResolvedValue([])
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

  // The email body is authored separately (rich text) from the short push/in-app
  // body, and its placeholders must fill in too.
  it('fills placeholders in the rich email body as well', () => {
    const out = renderCommsMessage(
      { title: 'Hi {{name}}', body: 'short', emailBody: '<p>Hi <strong>{{name}}</strong>, bring treats for {{dog}}.</p>' },
      { name: 'Sam', dog: 'Bailey', time: '', date: '', class: '', business: '', location: '' },
    )
    expect(out.emailBody).toBe('<p>Hi <strong>Sam</strong>, bring treats for Bailey.</p>')
    expect(out.body).toBe('short') // push/in-app keep the plain one
  })

  it('leaves emailBody null when the step has none', () => {
    const out = renderCommsMessage({ title: 't', body: 'b' }, {
      name: 'Sam', dog: 'Bailey', time: '', date: '', class: '', business: '', location: '',
    })
    expect(out.emailBody).toBeNull()
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

  // A step with a rich email body sends THAT as the email's HTML, with a plain
  // -text fallback — while push and in-app still carry the short plain body.
  it('emails the rich body and pushes the plain one', async () => {
    h.stepFindMany.mockResolvedValue([step({
      channels: ['PUSH', 'IN_APP', 'EMAIL'],
      body: 'Bring treats for {{dog}}',
      emailBody: '<p>Hi <strong>{{name}}</strong>, bring treats for {{dog}}.</p>',
    })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    await processCommsFlows(NOW)

    const rendered = h.renderEmail.mock.calls[0][0]
    expect(rendered.bodyHtml).toBe('<p>Hi <strong>Sam</strong>, bring treats for Bailey.</p>')
    // The text part is the same content flattened, NOT the push copy.
    expect(rendered.body).toContain('bring treats for Bailey')
    expect(rendered.body).not.toContain('<strong>')

    // Push + in-app are unchanged by the email body.
    expect(h.sendPush.mock.calls[0][1].alert.body).toBe('Bring treats for Bailey')
    expect(h.notificationCreate.mock.calls[0][0].data.body).toBe('Bring treats for Bailey')
  })
})

// ─── Staff audience ─────────────────────────────────────────────────────────
// A staff step reaches the people working THAT session and nobody else:
// the session's own assigned trainer, else the class's assigned members, else
// the business owner. There is no whole-company fallback.
const assigned = (user: ReturnType<typeof staffUser>) => ({ acceptedAt: new Date('2026-01-01'), user })

describe('processCommsFlows — staff audience', () => {
  it('sends to the member assigned to that session, not the clients', async () => {
    h.stepFindMany.mockResolvedValue([step({ audience: 'STAFF', channels: ['PUSH', 'IN_APP'] })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.sessionFindMany.mockResolvedValue([{ id: 'sess1', scheduledAt: SESSION_AT, assignedTrainer: assigned(staffUser()) }])
    // The class also has a general list — the session's own person wins.
    h.classRunTrainerFindMany.mockResolvedValue([{ membership: { user: staffUser({ id: 'staff2' }) } }])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.sendPush.mock.calls[0][0]).toBe('staff1')
    // The client on the run hears nothing…
    expect(h.sendPush.mock.calls.some(c => c[0] === 'u1')).toBe(false)
    // …and neither does a team member who isn't on this session.
    expect(h.sendPush.mock.calls.some(c => c[0] === 'staff2')).toBe(false)
    // Their bell row deep-links to the trainer-side class page.
    expect(h.notificationCreate.mock.calls[0][0].data).toMatchObject({ userId: 'staff1', link: '/classes/run1' })
    expect(h.trainerMembershipFindMany).not.toHaveBeenCalled()
  })

  it('falls back to the class’s assigned members when the session names nobody', async () => {
    h.stepFindMany.mockResolvedValue([step({ audience: 'STAFF' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.classRunTrainerFindMany.mockResolvedValue([{ membership: { user: staffUser() } }, { membership: { user: staffUser({ id: 'staff2' }) } }])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(2)
    expect(h.sendPush.mock.calls.map(c => c[0]).sort()).toEqual(['staff1', 'staff2'])
    expect(h.trainerMembershipFindMany).not.toHaveBeenCalled()
  })

  it('never reaches a team member who is on neither the session nor the class', async () => {
    h.stepFindMany.mockResolvedValue([step({ audience: 'STAFF' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.classRunTrainerFindMany.mockResolvedValue([{ membership: { user: staffUser() } }])
    // A bystander exists in the business, but is never queried for, let alone sent to.
    h.trainerMembershipFindMany.mockResolvedValue([{ user: staffUser({ id: 'bystander' }) }])

    await processCommsFlows(NOW)

    expect(h.sendPush.mock.calls.map(c => c[0])).toEqual(['staff1'])
    expect(h.notificationCreate.mock.calls.some(c => c[0].data.userId === 'bystander')).toBe(false)
  })

  it('falls back to the main trainer — never silence — when nobody is assigned at all', async () => {
    h.stepFindMany.mockResolvedValue([step({ audience: 'STAFF' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.classRunTrainerFindMany.mockResolvedValue([])
    h.trainerProfileFindUnique.mockResolvedValue({ user: staffUser({ id: 'owner1' }) })
    h.trainerMembershipFindMany.mockResolvedValue([{ user: staffUser({ id: 'owner1' }) }])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.sendPush.mock.calls[0][0]).toBe('owner1')
    // Owner-role members only — never the whole company.
    expect(h.trainerMembershipFindMany.mock.calls[0][0].where).toMatchObject({ companyId: 'co1', role: 'OWNER' })
  })

  // A solo/legacy trainer may have no TrainerMembership row at all (see
  // lib/membership.ts "legacy owner"), so the profile's own user has to be in
  // the fallback or the message would go nowhere for the commonest setup there is.
  it('reaches a solo trainer who has no membership row', async () => {
    h.stepFindMany.mockResolvedValue([step({ audience: 'STAFF' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.trainerProfileFindUnique.mockResolvedValue({ user: staffUser({ id: 'solo1' }) })
    h.trainerMembershipFindMany.mockResolvedValue([]) // no rows at all

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.sendPush.mock.calls[0][0]).toBe('solo1')
  })

  it('reaches every owner when the business has more than one', async () => {
    h.stepFindMany.mockResolvedValue([step({ audience: 'STAFF' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.trainerProfileFindUnique.mockResolvedValue({ user: staffUser({ id: 'owner1' }) })
    h.trainerMembershipFindMany.mockResolvedValue([
      { user: staffUser({ id: 'owner1' }) }, // the same person, via their membership row
      { user: staffUser({ id: 'owner2' }) },
    ])

    const res = await processCommsFlows(NOW)

    // Both owners, and the one listed twice still counted once.
    expect(res.sent).toBe(2)
    expect(h.sendPush.mock.calls.map(c => c[0]).sort()).toEqual(['owner1', 'owner2'])
  })

  it('sends one message, not two, when the owner is also the assignee', async () => {
    h.stepFindMany.mockResolvedValue([step({ audience: 'STAFF' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.sessionFindMany.mockResolvedValue([{ id: 'sess1', scheduledAt: SESSION_AT, assignedTrainer: assigned(staffUser({ id: 'owner1' })) }])
    h.trainerProfileFindUnique.mockResolvedValue({ user: staffUser({ id: 'owner1' }) })
    h.trainerMembershipFindMany.mockResolvedValue([{ user: staffUser({ id: 'owner1' }) }])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.sendPush.mock.calls.map(c => c[0])).toEqual(['owner1'])
    expect(h.notificationCreate.mock.calls.filter(c => c[0].data.userId === 'owner1')).toHaveLength(1)
  })

  it('sends one message when the same person is on the class twice over', async () => {
    h.stepFindMany.mockResolvedValue([step({ audience: 'STAFF' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.classRunTrainerFindMany.mockResolvedValue([
      { membership: { user: staffUser() } },
      { membership: { user: staffUser() } }, // duplicate assignment row
    ])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.sendPush.mock.calls.map(c => c[0])).toEqual(['staff1'])
  })

  it('ignores an assignment the member has not accepted yet', async () => {
    h.stepFindMany.mockResolvedValue([step({ audience: 'STAFF' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.sessionFindMany.mockResolvedValue([{ id: 'sess1', scheduledAt: SESSION_AT, assignedTrainer: { acceptedAt: null, user: staffUser({ id: 'invitee' }) } }])
    h.classRunTrainerFindMany.mockResolvedValue([{ membership: { user: staffUser() } }])

    await processCommsFlows(NOW)

    expect(h.sendPush.mock.calls.map(c => c[0])).toEqual(['staff1'])
  })

  it('still tells staff about a session nobody has booked', async () => {
    h.stepFindMany.mockResolvedValue([step({ audience: 'STAFF', body: 'Dogs today: {{dog}}' })])
    h.enrollmentFindMany.mockResolvedValue([])
    h.classRunTrainerFindMany.mockResolvedValue([{ membership: { user: staffUser() } }])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.notificationCreate.mock.calls[0][0].data.body).toBe('Dogs today: ')
  })

  it('sends nothing when the business itself has been deleted out from under it', async () => {
    h.stepFindMany.mockResolvedValue([step({ audience: 'STAFF' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.trainerProfileFindUnique.mockResolvedValue(null)

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(0)
    expect(h.sendPush).not.toHaveBeenCalled()
  })

  it('a 1:1 package step goes to the session’s own trainer', async () => {
    h.stepFindMany.mockResolvedValue([{
      id: 'pstep', classRunId: null, packageId: 'pkg1', kind: 'MESSAGE', trigger: null,
      direction: 'BEFORE_SESSION', offsetMinutes: 1440, channels: ['PUSH'],
      audience: 'STAFF', customClientIds: [], important: false,
      title: 'You have {{name}} at {{time}}', body: '{{class}} with {{dog}}',
      classRun: null, package: { name: 'Puppy 101', trainerId: 'co1', trainer },
    }])
    h.sessionFindMany.mockResolvedValue([{
      id: 'ps1', scheduledAt: SESSION_AT, dog: { name: 'Rex' },
      assignedTrainer: assigned(staffUser()),
      client: { user: { id: 'u9', name: 'Pat', email: 'pat@x.com', notifyPush: true, productEmailOptOut: false } },
    }])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.sendPush.mock.calls[0][0]).toBe('staff1')
    // The 1:1 client doesn't get the staff copy.
    expect(h.sendPush.mock.calls.some(c => c[0] === 'u9')).toBe(false)
    // No run to fall back on, so the class-level lookup never happens.
    expect(h.classRunTrainerFindMany).not.toHaveBeenCalled()
    expect(h.sendCreate).toHaveBeenCalledWith({ data: { stepId: 'pstep', sessionId: 'ps1', userId: 'staff1' } })
  })

  it('a 1:1 package step with no assigned trainer falls back to the main trainer', async () => {
    h.stepFindMany.mockResolvedValue([{
      id: 'pstep', classRunId: null, packageId: 'pkg1', kind: 'MESSAGE', trigger: null,
      direction: 'BEFORE_SESSION', offsetMinutes: 1440, channels: ['PUSH'],
      audience: 'STAFF', customClientIds: [], important: false,
      title: 't', body: 'b',
      classRun: null, package: { name: 'Puppy 101', trainerId: 'co1', trainer },
    }])
    h.sessionFindMany.mockResolvedValue([{
      id: 'ps1', scheduledAt: SESSION_AT, dog: null, assignedTrainer: null,
      client: { user: { id: 'u9', name: 'Pat', email: 'pat@x.com', notifyPush: true, productEmailOptOut: false } },
    }])
    h.trainerProfileFindUnique.mockResolvedValue({ user: staffUser({ id: 'owner1' }) })

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.sendPush.mock.calls[0][0]).toBe('owner1')
  })
})

describe('processCommsFlows — 1:1 package scope', () => {
  it("sends to each session's own client (no enrolments involved)", async () => {
    h.stepFindMany.mockResolvedValue([{
      id: 'pstep', classRunId: null, packageId: 'pkg1', kind: 'MESSAGE', trigger: null,
      direction: 'BEFORE_SESSION', offsetMinutes: 1440, channels: ['IN_APP'],
      audience: 'ENROLLED', customClientIds: [], important: false,
      title: 'Hi {{name}} & {{dog}}', body: '{{class}} at {{time}}',
      classRun: null, package: { name: 'Puppy 101', trainerId: 'co1', trainer },
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

// ─── Memberships ────────────────────────────────────────────────────────────
// A membership has no sessions, so its steps fire off the client's purchase.

const membershipStep = (over: Record<string, unknown> = {}) => ({
  id: 'mstep', classRunId: null, packageId: null, membershipId: 'mem1',
  kind: 'MESSAGE', trigger: null,
  direction: 'AFTER_PURCHASE', offsetMinutes: 1440, channels: ['PUSH', 'IN_APP'],
  audience: 'ENROLLED', customClientIds: [], important: false,
  // Deliberately the PRE-RENAME spelling — this is the shape of every step row
  // already in the database. The editor inserts {{package}} now; both fill.
  title: 'Welcome {{name}}', body: 'Enjoy {{membership}} with {{dog}}',
  emailBody: null, enabled: true,
  membership: { name: 'Puppy Starter', trainerId: 'co1', trainer },
  classRun: null, package: null,
  ...over,
})

const PURCHASE = {
  id: 'pur1',
  purchasedAt: new Date('2026-07-30T00:00:00.000Z'), // 2 days before NOW
  currentPeriodEnd: null,
  clientId: 'c1',
}

const CLIENT = {
  id: 'c1',
  dog: { name: 'Bailey' },
  dogs: [],
  user: { id: 'u1', name: 'Sam', email: 'sam@x.com', notifyPush: true, productEmailOptOut: false },
}

describe('processCommsFlows — membership scope', () => {
  it('sends to each client holding the membership, once per purchase', async () => {
    h.stepFindMany.mockResolvedValue([membershipStep()])
    h.purchaseFindMany.mockResolvedValue([PURCHASE])
    h.clientFindMany.mockResolvedValue([CLIENT])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    // {{membership}} and {{dog}} both fill in.
    expect(h.notificationCreate.mock.calls[0][0].data).toMatchObject({
      userId: 'u1',
      title: 'Welcome Sam',
      body: 'Enjoy Puppy Starter with Bailey',
      link: '/my-memberships',
    })
    // Deduped by purchase, not by session.
    expect(h.sendCreate).toHaveBeenCalledWith({ data: { stepId: 'mstep', purchaseId: 'pur1', userId: 'u1' } })
  })

  it('only looks at ACTIVE purchases of that membership', async () => {
    h.stepFindMany.mockResolvedValue([membershipStep()])
    h.purchaseFindMany.mockResolvedValue([])

    await processCommsFlows(NOW)

    expect(h.purchaseFindMany.mock.calls[0][0].where).toMatchObject({ membershipId: 'mem1', status: 'ACTIVE' })
    expect(h.notificationCreate).not.toHaveBeenCalled()
  })

  it('does not re-send to someone already recorded against that purchase', async () => {
    h.stepFindMany.mockResolvedValue([membershipStep()])
    h.purchaseFindMany.mockResolvedValue([PURCHASE])
    h.clientFindMany.mockResolvedValue([CLIENT])
    h.sendFindMany.mockResolvedValue([{ purchaseId: 'pur1', userId: 'u1' }])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(0)
    expect(h.sendPush).not.toHaveBeenCalled()
  })

  // A membership has no sessions, so "assigned to the session" becomes the
  // member's own assigned trainer — the person who looks after that client.
  it('a STAFF membership step goes to the client’s assigned trainer', async () => {
    h.stepFindMany.mockResolvedValue([membershipStep({ audience: 'STAFF' })])
    h.purchaseFindMany.mockResolvedValue([PURCHASE])
    h.clientFindMany.mockResolvedValue([{ ...CLIENT, assignedTrainer: { acceptedAt: new Date('2026-01-01'), user: staffUser() } }])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.notificationCreate.mock.calls[0][0].data).toMatchObject({ userId: 'staff1', link: '/memberships' })
    expect(h.sendCreate).toHaveBeenCalledWith({ data: { stepId: 'mstep', purchaseId: 'pur1', userId: 'staff1' } })
    // The client themselves doesn't get the staff copy.
    expect(h.notificationCreate.mock.calls.some(c => c[0].data.userId === 'u1')).toBe(false)
    expect(h.trainerMembershipFindMany).not.toHaveBeenCalled()
  })

  it('a STAFF membership step falls back to the main trainer when the client has no trainer', async () => {
    h.stepFindMany.mockResolvedValue([membershipStep({ audience: 'STAFF' })])
    h.purchaseFindMany.mockResolvedValue([PURCHASE])
    h.clientFindMany.mockResolvedValue([CLIENT])
    h.trainerProfileFindUnique.mockResolvedValue({ user: staffUser({ id: 'owner1' }) })

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.notificationCreate.mock.calls[0][0].data).toMatchObject({ userId: 'owner1' })
    expect(h.trainerMembershipFindMany.mock.calls[0][0].where).toMatchObject({ companyId: 'co1', role: 'OWNER' })
  })

  it('a renewal step counts back from the period end instead', async () => {
    h.stepFindMany.mockResolvedValue([membershipStep({ direction: 'BEFORE_PERIOD_END', offsetMinutes: 4320 })])
    h.purchaseFindMany.mockResolvedValue([])

    await processCommsFlows(NOW)

    const where = h.purchaseFindMany.mock.calls[0][0].where
    expect(where.currentPeriodEnd).toBeDefined()
    expect(where.purchasedAt).toBeUndefined()
  })
})

// ─── Flows widened past messages ────────────────────────────────────────────
// A step is now one step of a FLOW, and a flow can be a person's journey
// (enquiry → account → intake → choose an offering) as easily as a class's
// reminders. This cron only ever delivers a MESSAGE on a clock. Every other
// kind is something a person DOES, so the cron's correct behaviour is to do
// nothing — and "nothing" has to mean nothing, not a half-rendered push.
//
// Nothing can create a non-MESSAGE step in phase 1. These tests exist so that
// when phase 2 can, the routing is already proven rather than discovered.

describe('processCommsFlows — routing by kind', () => {
  // Three of the seven are steps in a PERSON's acquisition journey — set a
  // password, choose what to book, a trainer accepting a time. A class reminder
  // has no business asking anybody to do those, so no clock ever fires one:
  // "choose an offering" in front of somebody already enrolled in it is worse
  // than nothing at all.
  const JOURNEY_ONLY = ['ACCOUNT', 'CHOOSE_OFFERING', 'APPROVAL'] as const

  it.each(JOURNEY_ONLY)('a %s step is never fired by the clock', async kind => {
    h.stepFindMany.mockResolvedValue([step({ kind, title: null, body: null })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(0)
    expect(res.skipped).toBe(1)
    expect(h.sendPush).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.notificationCreate).not.toHaveBeenCalled()
    expect(h.sendCreate).not.toHaveBeenCalled()
    // It doesn't even go looking for recipients.
    expect(h.sessionFindMany).not.toHaveBeenCalled()
  })

  // A trainer adds a step, then configures it. The half-built one in between
  // must not go out — "fill in this form" with no form on the end of it is a
  // dead end a client can only read as broken.
  it.each(['FORM', 'TASK'] as const)('a %s step nobody finished configuring waits', async kind => {
    h.stepFindMany.mockResolvedValue([step({ kind, title: null, body: null, payload: null })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    const res = await processCommsFlows(NOW)

    expect(res).toMatchObject({ sent: 0, skipped: 1 })
    expect(h.sendPush).not.toHaveBeenCalled()
    expect(h.sendCreate).not.toHaveBeenCalled()
    // Nothing is recorded, so it starts working the moment the trainer finishes
    // it rather than being marked delivered for ever.
    expect(h.sessionFindMany).not.toHaveBeenCalled()
  })

  it('skips the non-message steps and still delivers the message ones', async () => {
    h.stepFindMany.mockResolvedValue([
      step({ id: 'form1', kind: 'FORM', title: null, body: null }),
      step({ id: 'msg1', kind: 'MESSAGE' }),
    ])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    const res = await processCommsFlows(NOW)

    expect(res).toMatchObject({ steps: 2, sent: 1, skipped: 1 })
    expect(h.sendCreate).toHaveBeenCalledWith({ data: { stepId: 'msg1', sessionId: 'sess1', userId: 'u1' } })
  })

  // A person-anchored MESSAGE is unlocked by finishing the previous step, not
  // by a clock — so the FlowRun sends it, never this scan. Firing it here would
  // send a welcome to somebody who never finished signing up.
  it('leaves a person-anchored message to the run that owns it', async () => {
    h.stepFindMany.mockResolvedValue([step({ kind: 'MESSAGE', trigger: 'ON_ENQUIRY_SUBMITTED' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    const res = await processCommsFlows(NOW)

    expect(res).toMatchObject({ sent: 0, skipped: 1 })
    expect(h.sendPush).not.toHaveBeenCalled()
  })

  // The whole point of the widening: today's reminders are untouched by it.
  it('delivers an existing session reminder exactly as it did before', async () => {
    h.stepFindMany.mockResolvedValue([step({ channels: ['PUSH', 'EMAIL', 'IN_APP'] })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(res.skipped).toBe(0)
    expect(h.sendPush.mock.calls[0][1].alert).toEqual({
      title: 'Hi Sam & Bailey',
      body: 'Puppy Class at 12:00 am — Waggy Tails',
    })
    expect(h.notificationCreate.mock.calls[0][0].data).toMatchObject({ userId: 'u1', link: '/my-sessions' })
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
  })
})

// A MESSAGE step cannot be saved without a title and a body — but the COLUMNS
// are nullable now, and the one place a stray null would surface is the subject
// line of a real client's email. "null" is four characters that must never ship.
describe('renderCommsMessage — null copy', () => {
  const VARS = { name: 'Sam', dog: 'Bailey', time: '6pm', date: 'Tue', class: 'Puppy Class', business: 'Waggy', location: 'Hall' }

  it('renders an empty string, never the word "null"', () => {
    const out = renderCommsMessage({ title: null, body: null }, VARS)
    expect(out).toEqual({ title: '', body: '', emailBody: null })
  })

  it('never renders "undefined" either', () => {
    const out = renderCommsMessage({ title: undefined as unknown as null, body: undefined as unknown as null }, VARS)
    expect(out.title).toBe('')
    expect(out.body).toBe('')
  })

  it('a null title does not stop the body rendering', () => {
    const out = renderCommsMessage({ title: null, body: 'Hi {{name}}' }, VARS)
    expect(out).toMatchObject({ title: '', body: 'Hi Sam' })
  })

  it('does not send the string "null" to a client', async () => {
    h.stepFindMany.mockResolvedValue([step({ channels: ['PUSH', 'EMAIL'], title: null, body: null })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    await processCommsFlows(NOW)

    const push = h.sendPush.mock.calls[0]?.[1]
    const email = h.renderEmail.mock.calls[0]?.[0]
    for (const value of [push?.alert?.title, push?.alert?.body, email?.title, email?.body]) {
      expect(String(value)).not.toContain('null')
      expect(String(value)).not.toContain('undefined')
    }
  })
})

// ─── Phase 2: the new kinds actually do their thing ─────────────────────────
//
// Phase 1 routed every non-MESSAGE step to a clean no-op, because nothing could
// create one. Four kinds mean something on a clock now — a reminder, a form due
// before each class, a photo asked for after one, homework handed out with it —
// and all four go out through the SAME deliver(): same channels, same opt-out
// rules, same email renderer. A second sender would be a second place for a
// client's mute to be forgotten.

describe('processCommsFlows — a FORM step', () => {
  const formStep = (over: Record<string, unknown> = {}) =>
    step({ kind: 'FORM', title: null, body: null, payload: { formId: 'form-9' }, channels: ['PUSH', 'IN_APP'], ...over })

  it('asks the client to fill it in, and links to that form', async () => {
    h.stepFindMany.mockResolvedValue([formStep()])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.notificationCreate.mock.calls[0][0].data).toMatchObject({ userId: 'u1', link: '/form/form-9' })
    expect(h.sendPush.mock.calls[0][1].customData).toEqual({ path: '/form/form-9' })
    expect(h.sendCreate).toHaveBeenCalledWith({ data: { stepId: 'step1', sessionId: 'sess1', userId: 'u1' } })
  })

  // title/body are nullable BECAUSE a form step has no copy — but a
  // notification still has to say something, and an empty push is worse than a
  // plain one.
  it('writes plain copy when the trainer wrote none', async () => {
    h.stepFindMany.mockResolvedValue([formStep()])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    await processCommsFlows(NOW)

    const { title, body } = h.sendPush.mock.calls[0][1].alert
    expect(title).toBeTruthy()
    expect(`${title} ${body}`).not.toContain('null')
    expect(`${title} ${body}`).not.toContain('{{')
    expect(body).toContain('Waggy Tails') // the placeholders still fill
  })

  it('keeps the trainer’s own words when they wrote some', async () => {
    h.stepFindMany.mockResolvedValue([formStep({ title: 'Before we meet, {{name}}', body: 'Two questions about {{dog}}.' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    await processCommsFlows(NOW)

    expect(h.sendPush.mock.calls[0][1].alert).toEqual({
      title: 'Before we meet, Sam',
      body: 'Two questions about Bailey.',
    })
  })

  it('still respects a client’s mute', async () => {
    h.stepFindMany.mockResolvedValue([formStep({ channels: ['PUSH', 'EMAIL'] })])
    h.enrollmentFindMany.mockResolvedValue([
      enrollment({ client: { user: { id: 'u1', name: 'Sam', email: 'sam@x.com', notifyPush: false, productEmailOptOut: true } } }),
    ])

    await processCommsFlows(NOW)

    expect(h.sendPush).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('does not ask twice', async () => {
    h.stepFindMany.mockResolvedValue([formStep()])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])
    h.sendFindMany.mockResolvedValue([{ userId: 'u1' }])

    expect((await processCommsFlows(NOW)).sent).toBe(0)
    expect(h.sendPush).not.toHaveBeenCalled()
  })
})

describe('processCommsFlows — an UPLOAD step', () => {
  it('asks for a dog photo, and points at the dog', async () => {
    h.stepFindMany.mockResolvedValue([step({
      kind: 'UPLOAD', title: null, body: null,
      payload: { target: 'DOG_PHOTO', label: 'a photo of {{dog}} in their harness' },
      channels: ['PUSH', 'IN_APP'],
    })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.notificationCreate.mock.calls[0][0].data.link).toBe('/my-dogs')
    expect(h.sendPush.mock.calls[0][1].alert.body).toContain('a photo of Bailey in their harness')
  })

  it('a general attachment is answered where they were asked', async () => {
    h.stepFindMany.mockResolvedValue([step({ kind: 'UPLOAD', title: null, body: null, payload: {} })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    await processCommsFlows(NOW)

    expect(h.notificationCreate.mock.calls[0][0].data.link).toBe('/my-sessions')
  })
})

describe('processCommsFlows — a TASK step', () => {
  const taskStep = (payload: unknown) =>
    step({ kind: 'TASK', title: null, body: null, payload, channels: ['PUSH'] })
  const enrolled = () => enrollment({ clientId: 'c1', dogId: 'd1' })

  beforeEach(() => {
    h.libraryFindUnique.mockResolvedValue({ title: 'Loose-lead walking', description: '<p>Ten minutes.</p>', repetitions: 3, videoUrl: 'https://v/1' })
    h.taskFindMany.mockResolvedValue([])
    h.taskCreate.mockResolvedValue({ id: 't1' })
  })

  // Homework is a SNAPSHOT of the library item, taken at hand-out time — the
  // same rule assignDefaults follows, so re-cutting the item never rewrites
  // work already given out.
  it('hands out the library item as a real TrainingTask, snapshotted', async () => {
    h.stepFindMany.mockResolvedValue([taskStep({ libraryTaskId: 'lib-1', timing: 'BEFORE_SESSION' })])
    h.enrollmentFindMany.mockResolvedValue([enrolled()])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.taskCreate.mock.calls[0][0].data).toMatchObject({
      clientId: 'c1',
      dogId: 'd1',
      sessionId: 'sess1',
      title: 'Loose-lead walking',
      description: '<p>Ten minutes.</p>',
      repetitions: 3,
      libraryTaskId: 'lib-1',
      timing: 'BEFORE_SESSION',
    })
    expect(h.sendPush).toHaveBeenCalledTimes(1)
    expect(h.notificationCreate.mock.calls.length + h.sendPush.mock.calls.length).toBeGreaterThan(0)
  })

  it('takes an inline one-off instead of a library item', async () => {
    h.stepFindMany.mockResolvedValue([taskStep({ title: 'Practise sit', repetitions: 5 })])
    h.enrollmentFindMany.mockResolvedValue([enrolled()])

    await processCommsFlows(NOW)

    expect(h.libraryFindUnique).not.toHaveBeenCalled()
    expect(h.taskCreate.mock.calls[0][0].data).toMatchObject({ title: 'Practise sit', repetitions: 5, libraryTaskId: null })
  })

  // The notification says there is something new to practise, so it must not go
  // out before there is.
  it('sends nothing when the library item has been deleted underneath it', async () => {
    h.stepFindMany.mockResolvedValue([taskStep({ libraryTaskId: 'lib-gone' })])
    h.enrollmentFindMany.mockResolvedValue([enrolled()])
    h.libraryFindUnique.mockResolvedValue(null)

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(0)
    expect(h.taskCreate).not.toHaveBeenCalled()
    expect(h.sendPush).not.toHaveBeenCalled()
    expect(h.sendCreate).not.toHaveBeenCalled()
  })

  it('does not double up on homework the client already has', async () => {
    h.stepFindMany.mockResolvedValue([taskStep({ libraryTaskId: 'lib-1' })])
    h.enrollmentFindMany.mockResolvedValue([enrolled()])
    h.taskFindMany.mockResolvedValue([{ title: 'Loose-lead walking', libraryTaskId: 'lib-1', order: 0 }])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(0)
    expect(h.taskCreate).not.toHaveBeenCalled()
  })

  // A staff step tells the team about the session; it does not hand anybody
  // homework, because staff are not a ClientProfile.
  it('assigns nothing to staff', async () => {
    h.stepFindMany.mockResolvedValue([taskStep({ libraryTaskId: 'lib-1' })])
    h.stepFindMany.mockResolvedValue([step({ kind: 'TASK', title: null, body: null, payload: { libraryTaskId: 'lib-1' }, audience: 'STAFF', channels: ['PUSH'] })])
    h.enrollmentFindMany.mockResolvedValue([enrolled()])
    h.classRunTrainerFindMany.mockResolvedValue([{ membership: { user: staffUser() } }])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(0)
    expect(h.taskCreate).not.toHaveBeenCalled()
  })
})

// ─── A step the TRAINER does ────────────────────────────────────────────────
//
// "the trainer gets a notification, the trainer accepts the time or moves the
// time" — the last step of Karl's journey is performed by the OTHER SIDE. It
// goes to the trainer's own notification surface, with their own per-type
// toggles, and never through the client's delivery path.

describe('a trainer-actor step', () => {
  it('goes to the trainer’s notifications, not the client’s', async () => {
    h.stepFindMany.mockResolvedValue([step({
      kind: 'UPLOAD', actor: 'TRAINER', title: 'A photo to check', body: 'From {{name}}',
      payload: {}, channels: ['PUSH', 'EMAIL', 'IN_APP'],
    })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    // The trainer's own surface — which is the one that knows their per-type
    // toggles and their custom copy.
    expect(h.notifyTrainer).toHaveBeenCalledTimes(1)
    const [userId, type, subs, path, companyId] = h.notifyTrainer.mock.calls[0]
    expect(type).toBe('FLOW_STEP_WAITING')
    expect(subs).toMatchObject({ clientName: 'Sam', title: 'A photo to check', detail: 'From Sam' })
    expect(companyId).toBe('co1')
    expect(path).toBeTruthy()
    void userId

    // …and NOT the client's. deliver() is never reached.
    expect(h.sendPush).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.notificationCreate).not.toHaveBeenCalled()
  })

  it('is still recorded once, so it is not asked twice', async () => {
    h.stepFindMany.mockResolvedValue([step({ kind: 'APPROVAL', actor: 'TRAINER', title: 't', body: 'b', trigger: 'ON_BOOKING' })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    // An APPROVAL is person-anchored, so the clock leaves it entirely alone —
    // it is the run that asks.
    const res = await processCommsFlows(NOW)
    expect(res).toMatchObject({ sent: 0, skipped: 1 })
    expect(h.notifyTrainer).not.toHaveBeenCalled()
  })
})

// ─── The one thing this phase must not break ────────────────────────────────
//
// Every reminder that fires today has to keep firing identically. The routing
// around it changed completely; what a MESSAGE step does did not.

describe('MESSAGE behaviour is untouched by any of it', () => {
  it('delivers a session reminder byte for byte as before', async () => {
    h.stepFindMany.mockResolvedValue([step({ channels: ['PUSH', 'EMAIL', 'IN_APP'] })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    const res = await processCommsFlows(NOW)

    expect(res).toMatchObject({ steps: 1, sent: 1, skipped: 0 })
    expect(h.sendPush.mock.calls[0][1]).toEqual({
      alert: { title: 'Hi Sam & Bailey', body: 'Puppy Class at 12:00 am — Waggy Tails' },
      customData: { path: '/my-sessions' },
    })
    expect(h.notificationCreate.mock.calls[0][0].data).toEqual({
      userId: 'u1', title: 'Hi Sam & Bailey', body: 'Puppy Class at 12:00 am — Waggy Tails', link: '/my-sessions',
    })
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.sendCreate).toHaveBeenCalledWith({ data: { stepId: 'step1', sessionId: 'sess1', userId: 'u1' } })
    // Nothing about a message reaches the new machinery.
    expect(h.notifyTrainer).not.toHaveBeenCalled()
    expect(h.taskCreate).not.toHaveBeenCalled()
    expect(h.libraryFindUnique).not.toHaveBeenCalled()
  })

  // The COLUMNS are nullable, and the parser will not save a message without
  // copy — but a legacy or hand-written row must still behave exactly as it did
  // before phase 2, which is: it sends, with an empty string, never "null".
  it('a null-copy message still sends, exactly as it did', async () => {
    h.stepFindMany.mockResolvedValue([step({ channels: ['PUSH'], title: null, body: null })])
    h.enrollmentFindMany.mockResolvedValue([enrollment()])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.sendPush.mock.calls[0][1].alert).toEqual({ title: '', body: '' })
  })

  it('a membership welcome is unchanged too', async () => {
    h.stepFindMany.mockResolvedValue([membershipStep()])
    h.purchaseFindMany.mockResolvedValue([PURCHASE])
    h.clientFindMany.mockResolvedValue([CLIENT])

    const res = await processCommsFlows(NOW)

    expect(res.sent).toBe(1)
    expect(h.notificationCreate.mock.calls[0][0].data).toEqual({
      userId: 'u1', title: 'Welcome Sam', body: 'Enjoy Puppy Starter with Bailey', link: '/my-memberships',
    })
    expect(h.notifyTrainer).not.toHaveBeenCalled()
  })
})

// ─── A person's journey ─────────────────────────────────────────────────────
//
// The other half of the engine. A session-anchored flow is scanned statelessly
// by the cron, which is what lets one tick cover every trainer. A journey is
// driven one person at a time, and the step they are on is unlocked by
// FINISHING the one before it — never by a clock.

const runUser = { id: 'u1', name: 'Sam', email: 'sam@x.com', notifyPush: true, productEmailOptOut: false }
const RUN = {
  id: 'run1', trainerId: 'co1', formId: 'form-1', packageId: null,
  userId: 'u1', clientId: 'c1', status: 'ACTIVE',
  trainer, user: runUser,
}

const journeyStep = (id: string, order: number, over: Record<string, unknown> = {}) => ({
  id, order, blocking: true, enabled: true,
  kind: 'FORM', actor: 'CLIENT', trigger: 'ON_ENQUIRY_SUBMITTED', direction: 'BEFORE_SESSION',
  channels: ['PUSH', 'EMAIL'], important: false, title: null, body: null,
  emailBody: null, payload: { formId: `f_${id}` },
  ...over,
})

describe('processFlowRun', () => {
  beforeEach(() => {
    h.runFindUnique.mockResolvedValue(RUN)
    h.stepFindMany.mockResolvedValue([journeyStep('intake', 0), journeyStep('photos', 1)])
  })

  // The whole of "wait until they've done this before showing the next".
  it('asks only for the step they are on, and never past a blocker', async () => {
    const res = await processFlowRun('run1', NOW)

    expect(res.asked).toBe(1)
    expect(res.waitingOn).toBe('intake')
    expect(res.completed).toBe(false)
    expect(h.sendPush).toHaveBeenCalledTimes(1)
    expect(h.sendPush.mock.calls[0][1].customData).toEqual({ path: '/form/f_intake' })
    expect(h.sendCreate).toHaveBeenCalledWith({ data: { stepId: 'intake', runId: 'run1', userId: 'u1' } })
    // Nothing behind the blocker is touched.
    expect(h.sendCreate.mock.calls.some(c => c[0].data.stepId === 'photos')).toBe(false)
  })

  it('moves on once the blocking step has a completion row', async () => {
    h.completionFindMany.mockResolvedValue([{ stepId: 'intake' }])

    const res = await processFlowRun('run1', NOW)

    expect(res).toMatchObject({ asked: 1, waitingOn: 'photos', completed: false })
    expect(h.sendCreate).toHaveBeenCalledWith({ data: { stepId: 'photos', runId: 'run1', userId: 'u1' } })
  })

  it('closes the run when every step is done', async () => {
    h.completionFindMany.mockResolvedValue([{ stepId: 'intake' }, { stepId: 'photos' }])

    const res = await processFlowRun('run1', NOW)

    expect(res).toMatchObject({ asked: 0, waitingOn: null, completed: true })
    expect(h.runUpdate.mock.calls[0][0].data.status).toBe('COMPLETED')
  })

  // Same idiom as the cron's (step, session, user) row: calling twice asks
  // once. Without it, every advance would re-send the same "fill this in".
  it('asks once however many times it is called', async () => {
    h.sendFindMany.mockResolvedValue([{ stepId: 'intake' }])

    const res = await processFlowRun('run1', NOW)

    expect(res.asked).toBe(0)
    expect(h.sendPush).not.toHaveBeenCalled()
    // It still parks the cursor — a run that has been asked is still waiting.
    expect(res.waitingOn).toBe('intake')
  })

  it('looks the sends up against the RUN, not a session', async () => {
    await processFlowRun('run1', NOW)
    expect(h.sendFindMany.mock.calls[0][0].where).toMatchObject({ runId: 'run1', userId: 'u1' })
  })

  // A journey starts BEFORE the person exists: the enquiry is written first, so
  // an abandoned run still leaves the trainer a name and a phone number.
  it('sequences without a user, and notifies nobody', async () => {
    h.runFindUnique.mockResolvedValue({ ...RUN, userId: null, user: null })

    const res = await processFlowRun('run1', NOW)

    expect(res).toMatchObject({ asked: 0, waitingOn: 'intake' })
    expect(h.sendPush).not.toHaveBeenCalled()
    expect(h.sendCreate).not.toHaveBeenCalled()
  })

  // Re-opening a journey somebody has already walked out of is worse than
  // leaving it closed.
  it('leaves a finished or abandoned run alone', async () => {
    for (const status of ['COMPLETED', 'ABANDONED']) {
      vi.clearAllMocks()
      h.runFindUnique.mockResolvedValue({ ...RUN, status })
      const res = await processFlowRun('run1', NOW)
      expect(res.asked, status).toBe(0)
      expect(h.runUpdate, status).not.toHaveBeenCalled()
      expect(h.sendPush, status).not.toHaveBeenCalled()
    }
  })

  it('does nothing for a run that is not there', async () => {
    h.runFindUnique.mockResolvedValue(null)
    expect(await processFlowRun('gone', NOW)).toMatchObject({ asked: 0, waitingOn: null })
  })

  // "the trainer gets a notification, the trainer accepts the time or moves the
  // time" — the last step of the journey, performed by the other side, and it
  // blocks the run exactly as a client's step does.
  it('a trainer-actor step blocks the run and goes to the trainer', async () => {
    h.stepFindMany.mockResolvedValue([
      journeyStep('accept', 0, { kind: 'APPROVAL', actor: 'TRAINER', title: 'A time to accept', body: '{{name}} picked a slot', payload: {} }),
      journeyStep('welcome', 1),
    ])

    const res = await processFlowRun('run1', NOW)

    expect(res.waitingOn).toBe('accept')
    expect(h.notifyTrainer).toHaveBeenCalledTimes(1)
    expect(h.notifyTrainer.mock.calls[0][1]).toBe('FLOW_STEP_WAITING')
    expect(h.notifyTrainer.mock.calls[0][2]).toMatchObject({ clientName: 'Sam', title: 'A time to accept' })
    // The client is not pushed at, and the step behind it is not reached.
    expect(h.sendPush).not.toHaveBeenCalled()
    expect(h.sendCreate.mock.calls.map(c => c[0].data.stepId)).toEqual(['accept'])
  })

  it('a step the trainer never configured is skipped without blocking silently forever', async () => {
    h.stepFindMany.mockResolvedValue([journeyStep('intake', 0, { payload: {} })])

    const res = await processFlowRun('run1', NOW)

    expect(res.asked).toBe(0)
    expect(h.sendCreate).not.toHaveBeenCalled()
    // It is still what they are waiting on — the trainer finishing it is what
    // gets them moving, and nothing was recorded to stop the ask happening then.
    expect(res.waitingOn).toBe('intake')
  })
})
