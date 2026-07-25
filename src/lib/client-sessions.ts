import { prisma } from './prisma'
import type { SessionStatus, SessionType } from '@/generated/prisma'

/**
 * Every session a client actually attends — 1:1 AND group class.
 *
 * A 1:1 session carries `clientId`. A class session does not: it belongs to the
 * class run and is shared by everyone on it, with attendance expressed through
 * ClassEnrollment. So `trainingSession.findMany({ where: { clientId } })` — the
 * obvious query, and the one the trainer's screens used — returns nothing at
 * all for a client who only does classes. Their own app merged both and showed
 * the sessions; the trainer's client record said "Sessions 0" for the same
 * person. Reported from production, July 2026.
 *
 * Drop-ins are honoured: a FULL enrolment attends every session of the run, a
 * DROP_IN attends only the one it names.
 */

export interface ClientSessionRow {
  id: string
  title: string
  scheduledAt: Date
  durationMins: number
  sessionType: SessionType
  status: SessionStatus
  location: string | null
  virtualLink: string | null
  description: string | null
  invoicedAt: Date | null
  dogName: string | null
  /** Set when this session comes from a class the client is enrolled in. */
  className: string | null
  classRunId: string | null
}

const SESSION_SELECT = {
  id: true, title: true, scheduledAt: true, durationMins: true, sessionType: true,
  status: true, location: true, virtualLink: true, description: true, invoicedAt: true,
} as const

export async function loadClientSessions(clientId: string): Promise<ClientSessionRow[]> {
  const [oneToOne, enrollments] = await Promise.all([
    prisma.trainingSession.findMany({
      where: { clientId },
      select: { ...SESSION_SELECT, dog: { select: { name: true } } },
    }),
    prisma.classEnrollment.findMany({
      where: { clientId, status: { not: 'WITHDRAWN' } },
      select: {
        dropInSessionId: true,
        dog: { select: { name: true } },
        classRun: {
          select: { id: true, name: true, sessions: { select: SESSION_SELECT } },
        },
      },
    }),
  ])

  const rows: ClientSessionRow[] = oneToOne.map(s => ({
    ...s,
    dogName: s.dog?.name ?? null,
    className: null,
    classRunId: null,
  }))

  for (const e of enrollments) {
    // A drop-in bought one session, not the term.
    const sessions = e.dropInSessionId
      ? e.classRun.sessions.filter(s => s.id === e.dropInSessionId)
      : e.classRun.sessions
    for (const s of sessions) {
      rows.push({
        ...s,
        dogName: e.dog?.name ?? null,
        className: e.classRun.name,
        classRunId: e.classRun.id,
      })
    }
  }

  // Newest first, matching what the client record showed before.
  return rows.sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())
}

/**
 * The next upcoming session per client, across 1:1 and classes — for the
 * clients list's "Next session" column, which had the same blind spot.
 */
export async function nextSessionByClient(clientIds: string[]): Promise<Map<string, Date>> {
  if (clientIds.length === 0) return new Map()
  const now = new Date()

  const [oneToOne, enrollments] = await Promise.all([
    prisma.trainingSession.findMany({
      where: { clientId: { in: clientIds }, scheduledAt: { gte: now } },
      orderBy: { scheduledAt: 'asc' },
      distinct: ['clientId'],
      select: { clientId: true, scheduledAt: true },
    }),
    prisma.classEnrollment.findMany({
      where: { clientId: { in: clientIds }, status: { not: 'WITHDRAWN' } },
      select: {
        clientId: true,
        dropInSessionId: true,
        classRun: {
          select: { sessions: { where: { scheduledAt: { gte: now } }, select: { id: true, scheduledAt: true } } },
        },
      },
    }),
  ])

  const next = new Map<string, Date>()
  const consider = (clientId: string | null, at: Date) => {
    if (!clientId) return
    const current = next.get(clientId)
    if (!current || at < current) next.set(clientId, at)
  }

  for (const s of oneToOne) consider(s.clientId, s.scheduledAt)
  for (const e of enrollments) {
    const sessions = e.dropInSessionId
      ? e.classRun.sessions.filter(s => s.id === e.dropInSessionId)
      : e.classRun.sessions
    for (const s of sessions) consider(e.clientId, s.scheduledAt)
  }
  return next
}
