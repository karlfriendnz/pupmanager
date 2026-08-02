import { describe, it, expect, vi, beforeEach } from 'vitest'

// Completing a session publishes its write-up. This is the half that decides
// who gets TOLD, and how often — see lib/recap-notify.

const h = vi.hoisted(() => ({
  trainerFindUnique: vi.fn(),
  responseFindMany: vi.fn(),
  responseUpdateMany: vi.fn(),
  attendanceFindMany: vi.fn(),
  attendanceUpdateMany: vi.fn(),
  notifyClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerFindUnique },
    sessionFormResponse: { findMany: h.responseFindMany, updateMany: h.responseUpdateMany },
    sessionAttendance: { findMany: h.attendanceFindMany, updateMany: h.attendanceUpdateMany },
  },
}))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))

import { releaseRecaps } from '@/lib/recap-notify'

const TRAINER = 'co1'

function response(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', sessionId: 's1',
    answers: { q1: 'Great recall' }, introMessage: null, closingMessage: null,
    session: {
      title: 'Recall', scheduledAt: new Date('2026-07-01T02:00:00Z'),
      dog: { name: 'Rusty' }, client: { userId: 'user-a' },
    },
    ...over,
  }
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.trainerFindUnique.mockResolvedValue({ businessName: 'Pup School', user: { name: 'Olivia' } })
  h.responseFindMany.mockResolvedValue([])
  h.attendanceFindMany.mockResolvedValue([])
  h.responseUpdateMany.mockResolvedValue({ count: 0 })
  h.attendanceUpdateMany.mockResolvedValue({ count: 0 })
})

describe('releaseRecaps', () => {
  it('does nothing at all when given nothing — no query, no trainer lookup', async () => {
    expect(await releaseRecaps({ trainerId: TRAINER })).toEqual({ sent: 0 })
    expect(h.trainerFindUnique).not.toHaveBeenCalled()
    expect(h.responseFindMany).not.toHaveBeenCalled()
  })

  it('only ever considers recaps the client has not already been told about', async () => {
    await releaseRecaps({ trainerId: TRAINER, sessionIds: ['s1'] })
    const where = h.responseFindMany.mock.calls[0][0].where
    expect(where.sentAt).toBeNull()
    // Tenant scoping: a session belonging to another business can't match.
    expect(where.session).toEqual({ trainerId: TRAINER })
  })

  it('scopes group-class reports through the class run, not the session alone', async () => {
    await releaseRecaps({ trainerId: TRAINER, sessionIds: ['s1'] })
    const where = h.attendanceFindMany.mock.calls[0][0].where
    expect(where.reportSentAt).toBeNull()
    expect(where.session).toEqual({ classRun: { trainerId: TRAINER } })
  })

  it('stamps and announces a written-up session', async () => {
    h.responseFindMany.mockResolvedValue([response()])
    const out = await releaseRecaps({ trainerId: TRAINER, sessionIds: ['s1'] })
    expect(out).toEqual({ sent: 1 })
    expect(h.responseUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['r1'] } } }),
    )
    expect(h.notifyClient).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-a', trainerId: TRAINER, type: 'CLIENT_RECAP_READY',
        link: '/my-sessions/s1',
      }),
    )
  })

  it('will not announce an empty write-up — attaching a form creates one', async () => {
    h.responseFindMany.mockResolvedValue([response({ answers: {} })])
    const out = await releaseRecaps({ trainerId: TRAINER, sessionIds: ['s1'] })
    expect(out).toEqual({ sent: 0 })
    expect(h.responseUpdateMany).not.toHaveBeenCalled()
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('one client with three recaps gets ONE notification, pointed at the newest', async () => {
    // Bulk-completing a week of sessions must not fire three pushes at one
    // person in the same second.
    h.responseFindMany.mockResolvedValue([
      response({ id: 'r1', sessionId: 's-old', session: { ...response().session, scheduledAt: new Date('2026-07-01T02:00:00Z') } }),
      response({ id: 'r2', sessionId: 's-new', session: { ...response().session, scheduledAt: new Date('2026-07-08T02:00:00Z') } }),
      response({ id: 'r3', sessionId: 's-mid', session: { ...response().session, scheduledAt: new Date('2026-07-04T02:00:00Z') } }),
    ])
    const out = await releaseRecaps({ trainerId: TRAINER, sessionIds: ['s-old', 's-new', 's-mid'] })
    // All three are revealed and stamped…
    expect(out).toEqual({ sent: 3 })
    expect(h.responseUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['r1', 'r2', 'r3'] } } }),
    )
    // …but the person hears once.
    expect(h.notifyClient).toHaveBeenCalledTimes(1)
    expect(h.notifyClient).toHaveBeenCalledWith(
      expect.objectContaining({ link: '/my-sessions/s-new' }),
    )
  })

  it('twelve sessions for twelve people is twelve notifications', async () => {
    h.responseFindMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => response({
        id: `r${i}`, sessionId: `s${i}`,
        session: { ...response().session, client: { userId: `user-${i}` } },
      })),
    )
    await releaseRecaps({ trainerId: TRAINER, sessionIds: ['whatever'] })
    expect(h.notifyClient).toHaveBeenCalledTimes(12)
  })

  it('a session with no activated client is revealed but notifies nobody', async () => {
    h.responseFindMany.mockResolvedValue([response({ session: { ...response().session, client: null } })])
    const out = await releaseRecaps({ trainerId: TRAINER, sessionIds: ['s1'] })
    expect(out).toEqual({ sent: 1 })
    expect(h.notifyClient).not.toHaveBeenCalled()
  })

  it('releases a group-class report and names the run', async () => {
    h.attendanceFindMany.mockResolvedValue([
      {
        id: 'a1', sessionId: 's1', report: { answers: { q1: 'Settled beautifully' } },
        session: { scheduledAt: new Date('2026-07-01T02:00:00Z') },
        enrollment: {
          client: { userId: 'user-b' }, dog: { name: 'Bailey' },
          classRun: { name: 'Puppy Foundations' },
        },
      },
    ])
    const out = await releaseRecaps({ trainerId: TRAINER, sessionIds: ['s1'] })
    expect(out).toEqual({ sent: 1 })
    expect(h.notifyClient).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-b',
        vars: expect.objectContaining({ dogName: 'Bailey', planName: 'Puppy Foundations' }),
      }),
    )
  })

  it('an explicit id and a session id can be asked for together without matching everything', async () => {
    await releaseRecaps({ trainerId: TRAINER, responseIds: ['r9'], sessionIds: ['s9'] })
    expect(h.responseFindMany.mock.calls[0][0].where.OR).toEqual([
      { id: { in: ['r9'] } },
      { sessionId: { in: ['s9'] } },
    ])
  })
})
