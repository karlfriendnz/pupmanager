import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { suggestedHomeworkForSession, assignDefaults } from '@/lib/default-homework'

// The one-tap end of default homework.
//
// GET  — "what would you normally hand out after this session", plus who it
//        would go to and who already has it.
// POST — hand the chosen defaults to the chosen people, as ordinary
//        TrainingTasks the trainer can edit or delete afterwards.
//
// Works for a 1:1 session (one recipient — the session's client) and for a
// group class (every live enrolment on this session), which is the only path
// by which class homework can be set at all.

interface Recipient {
  clientId: string
  dogId: string | null
  clientName: string
  dogName: string | null
  /** Group only — marked present, so the confirm screen can pre-tick. */
  present: boolean
}

async function trainerId() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) return null
  return session.user.trainerId
}

/** Everyone this session's homework could go to. */
async function recipientsFor(
  at: { isGroup: boolean; classRunId: string | null; clientId: string | null },
  sessionId: string,
): Promise<Recipient[]> {
  if (!at.isGroup) {
    if (!at.clientId) return []
    const s = await prisma.trainingSession.findUnique({
      where: { id: sessionId },
      select: {
        dogId: true,
        client: { select: { id: true, user: { select: { name: true } } } },
        dog: { select: { name: true } },
      },
    })
    if (!s?.client) return []
    return [{
      clientId: s.client.id,
      dogId: s.dogId,
      clientName: s.client.user.name ?? 'Client',
      dogName: s.dog?.name ?? null,
      present: true,
    }]
  }

  // Same roster rule as the attendance register: full-course enrolees attend
  // every session, drop-ins only the session they booked.
  const enrollments = await prisma.classEnrollment.findMany({
    where: {
      classRunId: at.classRunId!,
      status: 'ENROLLED',
      OR: [{ type: 'FULL' }, { type: 'DROP_IN', dropInSessionId: sessionId }],
    },
    orderBy: { enrolledAt: 'asc' },
    include: {
      client: { select: { id: true, user: { select: { name: true } } } },
      dog: { select: { id: true, name: true, deceasedAt: true } },
      attendance: { where: { sessionId }, take: 1, select: { status: true } },
    },
  })

  return enrollments
    .filter(e => !e.dog?.deceasedAt)
    .map(e => ({
      clientId: e.client.id,
      dogId: e.dog?.id ?? null,
      clientName: e.client.user.name ?? 'Client',
      dogName: e.dog?.name ?? null,
      // Unmarked reads as present, matching the register's own default.
      present: (e.attendance[0]?.status ?? 'PRESENT') === 'PRESENT',
    }))
}

export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params
  const defaults = await suggestedHomeworkForSession(sessionId, tid)
  // Not part of an offering, or not this trainer's session — either way there
  // is nothing to suggest, and an empty payload says so without leaking which.
  if (!defaults) return NextResponse.json({ packageId: null, sessionIndex: null, tasks: [], recipients: [] })

  const recipients = await recipientsFor(defaults, sessionId)

  // Who already has each suggestion, so nothing is offered twice.
  const clientIds = recipients.map(r => r.clientId)
  const existing = clientIds.length
    ? await prisma.trainingTask.findMany({
        where: { sessionId, clientId: { in: clientIds } },
        select: { clientId: true, title: true, libraryTaskId: true },
      })
    : []

  return NextResponse.json({
    packageId: defaults.packageId,
    packageName: defaults.packageName,
    sessionIndex: defaults.sessionIndex,
    // The curriculum step this homework belongs to, when there is one, so the
    // block can name it instead of a bare session number.
    stepTitle: defaults.stepTitle,
    isGroup: defaults.isGroup,
    recipients,
    tasks: defaults.tasks.map(t => ({
      ...t,
      assignedClientIds: existing
        .filter(e =>
          t.libraryTaskId
            ? e.libraryTaskId === t.libraryTaskId || sameTitle(e.title, t.title)
            : sameTitle(e.title, t.title),
        )
        .map(e => e.clientId),
    })),
  })
}

function sameTitle(a: string, b: string) {
  return a.toLocaleLowerCase('en-NZ') === b.toLocaleLowerCase('en-NZ')
}

const postSchema = z.object({
  /** PackageDefaultTask ids to hand out. Omit for all of them. */
  rowIds: z.array(z.string()).optional(),
  /** Who to give them to. Omit for every recipient on the session. */
  clientIds: z.array(z.string()).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const defaults = await suggestedHomeworkForSession(sessionId, tid)
  if (!defaults) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId: tid },
    select: { scheduledAt: true },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const wanted = parsed.data.rowIds
  const tasks = wanted ? defaults.tasks.filter(t => wanted.includes(t.id)) : defaults.tasks

  const recipients = await recipientsFor(defaults, sessionId)
  // Anything not on the roster is dropped rather than refused — the tab may
  // simply be stale — but a client who isn't on it can never be written to.
  const asked = parsed.data.clientIds
  const chosen = asked ? recipients.filter(r => asked.includes(r.clientId)) : recipients
  if (chosen.length === 0 || tasks.length === 0) return NextResponse.json({ created: 0, tasks: [] })

  const created = await assignDefaults({
    tasks,
    clientIds: chosen.map(r => r.clientId),
    sessionId,
    // Homework is due from the session it came out of.
    date: startOfDay(session.scheduledAt),
    dogIdByClient: Object.fromEntries(chosen.map(r => [r.clientId, r.dogId])),
  })

  // The rows come back so the post-notes flow can drop straight into its
  // review step with them, rather than making the trainer find them again.
  return NextResponse.json({ created: created.length, tasks: created }, { status: 201 })
}

// TrainingTask.date is a @db.Date. Derived exactly the way the session page
// derives the date it posts when homework is added by hand
// (scheduledAt.toISOString().split('T')[0]), so both routes land on the same day.
function startOfDay(d: Date) {
  return new Date(`${d.toISOString().split('T')[0]}T00:00:00.000Z`)
}
