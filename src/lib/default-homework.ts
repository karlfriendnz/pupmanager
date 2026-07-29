import { prisma } from '@/lib/prisma'
import { resolveSeriesSteps, stepForIndex } from '@/lib/series'

// Default homework — the tasks a trainer sets up ONCE on an offering, so the
// same five library items don't have to be hunted out after every session.
//
// Nothing here assigns anything. It resolves "what would you normally hand out
// after this session", and the trainer confirms the lot in one tap. On confirm
// the rows become ordinary TrainingTasks (snapshots), editable per client like
// any other homework.
//
// A default may be a LIBRARY item (text read live, so editing the library keeps
// every offering current) or an inline one-off. sessionIndex is the 1-based
// session number it belongs to; null means "after every session".

export interface SuggestedTask {
  /** PackageDefaultTask.id — what the confirm call sends back. */
  id: string
  libraryTaskId: string | null
  title: string
  description: string | null
  repetitions: number | null
  videoUrl: string | null
  order: number
}

export interface SessionDefaults {
  packageId: string
  packageName: string
  /** 1-based session number this session sits at, when it is knowable. */
  sessionIndex: number | null
  /**
   * The curriculum step this number belongs to, when the offering is a series.
   * Named so the session screen can say "step 3 · Loose-lead walking" over the
   * homework it is offering, rather than a bare number the trainer has to go
   * and look up — and so the two can never name different steps.
   */
  stepTitle: string | null
  /** True when this session belongs to a group class run. */
  isGroup: boolean
  classRunId: string | null
  /** The client a 1:1 session is for. Null for group sessions. */
  clientId: string | null
  tasks: SuggestedTask[]
}

/**
 * Resolve which offering a session belongs to, and where in the series it sits.
 *
 * Group sessions carry `sessionIndex` on the row already. A 1:1 session gets
 * its number from its position within its ClientPackage, ordered the way the
 * series was laid out — a session with no package has no number, and only
 * picks up the "every session" defaults.
 *
 * On a 1:1 SERIES the number is not the position. The trainer may have skipped
 * a step, so the session's number is the number of the CURRICULUM STEP it
 * covers — which is what makes the homework follow the step rather than the
 * slot. That is resolved through lib/series.ts, the same code the session
 * screen renders from, so the homework offered can never disagree with the
 * step shown.
 *
 * On a CLASS series there is nothing to reconcile — a cohort's step is its week
 * — so the number the row already carries IS the step number, and the only
 * thing looked up is the step's NAME. Both shapes go through lib/series.ts so
 * "which step is this" is answered in one place either way.
 */
async function locateSession(sessionId: string, trainerId: string) {
  const session = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    select: {
      id: true,
      clientId: true,
      sessionIndex: true,
      scheduledAt: true,
      clientPackageId: true,
      classRunId: true,
      classRun: {
        select: {
          id: true,
          packageId: true,
          package: {
            select: {
              id: true,
              name: true,
              isSeries: true,
              sessionPlans: { select: { id: true, sessionIndex: true, title: true } },
            },
          },
        },
      },
      clientPackage: {
        select: {
          id: true,
          package: {
            select: {
              id: true,
              name: true,
              isSeries: true,
              sessionPlans: { select: { id: true, sessionIndex: true, title: true } },
            },
          },
        },
      },
    },
  })
  if (!session) return null

  if (session.classRun) {
    const pkg = session.classRun.package
    return {
      packageId: pkg.id,
      packageName: pkg.name,
      sessionIndex: session.sessionIndex,
      // Week N is step N for a cohort — the number is already right, so only
      // the step's name has to be looked up.
      stepTitle: pkg.isSeries
        ? (stepForIndex(pkg.sessionPlans, session.sessionIndex)?.title ?? null)
        : null,
      isGroup: true,
      classRunId: session.classRun.id,
      clientId: null as string | null,
    }
  }

  if (!session.clientPackage) return null

  // Position within the package's own series. Sessions are created in one go
  // and can be dragged around afterwards, so the ORDER ON THE CALENDAR is what
  // "session 3" means — not creation order.
  const siblings = await prisma.trainingSession.findMany({
    where: { clientPackageId: session.clientPackageId! },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, sessionPlanId: true },
  })
  const pos = siblings.findIndex(s => s.id === session.id)

  const pkg = session.clientPackage.package
  // A series answers with the step it COVERS. A skipped step means this
  // session's homework is the next step's homework, not this slot's.
  const step = pkg.isSeries
    ? (resolveSeriesSteps(pkg.sessionPlans, siblings).find(r => r.sessionId === session.id)?.step ?? null)
    : null
  const sessionIndex = pkg.isSeries
    ? (step?.sessionIndex ?? null)
    : pos === -1 ? null : pos + 1

  return {
    packageId: pkg.id,
    packageName: pkg.name,
    sessionIndex,
    stepTitle: step?.title ?? null,
    isGroup: false,
    classRunId: null as string | null,
    clientId: session.clientId,
  }
}

/**
 * The default homework suggested for one session — the offering's rows for this
 * session number, plus any marked "every session".
 *
 * Returns null when the session isn't part of an offering at all (a one-off
 * appointment), which is the signal to show nothing rather than an empty block.
 */
export async function suggestedHomeworkForSession(
  sessionId: string,
  trainerId: string,
): Promise<SessionDefaults | null> {
  const at = await locateSession(sessionId, trainerId)
  if (!at) return null

  const rows = await prisma.packageDefaultTask.findMany({
    where: {
      packageId: at.packageId,
      // A row pinned to a session number only applies to that one. Rows with no
      // number apply to every session, including a session we couldn't number.
      OR: [{ sessionIndex: null }, ...(at.sessionIndex ? [{ sessionIndex: at.sessionIndex }] : [])],
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: { libraryTask: { select: { id: true, title: true, description: true, repetitions: true, videoUrl: true } } },
  })

  const tasks: SuggestedTask[] = rows
    .map(r => {
      // A library-backed default reads through to the item, so renaming the
      // item updates every offering that suggests it.
      const title = r.libraryTask?.title ?? r.title
      if (!title) return null
      return {
        id: r.id,
        libraryTaskId: r.libraryTask?.id ?? null,
        title,
        description: r.libraryTask ? r.libraryTask.description : r.description,
        repetitions: r.libraryTask ? r.libraryTask.repetitions : r.repetitions,
        videoUrl: r.libraryTask ? r.libraryTask.videoUrl : r.videoUrl,
        order: r.order,
      }
    })
    .filter((t): t is SuggestedTask => t !== null)

  return { ...at, tasks }
}

/**
 * Hand a set of defaults to a set of clients as real homework.
 *
 * Snapshot semantics, same as every other library assignment: the text is
 * copied onto the TrainingTask and `libraryTaskId` is kept only as provenance,
 * so later edits to the library never rewrite work already handed out.
 *
 * Skips anything a client already has on this session — tapping "Add all"
 * twice, or after adding one by hand, must not double up.
 */
export async function assignDefaults({
  tasks,
  clientIds,
  sessionId,
  date,
  dogIdByClient,
}: {
  tasks: SuggestedTask[]
  clientIds: string[]
  sessionId: string
  date: Date
  /** Optional per-client dog, so class homework lands on the right dog. */
  dogIdByClient?: Record<string, string | null>
}) {
  if (tasks.length === 0 || clientIds.length === 0) return []

  const existing = await prisma.trainingTask.findMany({
    where: { sessionId, clientId: { in: clientIds } },
    select: { clientId: true, title: true, libraryTaskId: true, order: true },
  })

  const rows: {
    clientId: string
    dogId: string | null
    sessionId: string
    date: Date
    title: string
    description: string | null
    repetitions: number | null
    videoUrl: string | null
    libraryTaskId: string | null
    order: number
  }[] = []

  for (const clientId of clientIds) {
    const mine = existing.filter(e => e.clientId === clientId)
    // Match on the library item where there is one, and fall back to the title
    // for inline defaults and for homework added before provenance existed.
    const haveIds = new Set(mine.map(e => e.libraryTaskId).filter((v): v is string => !!v))
    const haveTitles = new Set(mine.map(e => e.title.toLocaleLowerCase('en-NZ')))
    let order = mine.reduce((max, e) => Math.max(max, e.order), -1) + 1

    for (const t of tasks) {
      const dupe = t.libraryTaskId
        ? haveIds.has(t.libraryTaskId) || haveTitles.has(t.title.toLocaleLowerCase('en-NZ'))
        : haveTitles.has(t.title.toLocaleLowerCase('en-NZ'))
      if (dupe) continue
      haveTitles.add(t.title.toLocaleLowerCase('en-NZ'))
      if (t.libraryTaskId) haveIds.add(t.libraryTaskId)
      rows.push({
        clientId,
        dogId: dogIdByClient?.[clientId] ?? null,
        sessionId,
        date,
        title: t.title,
        description: t.description,
        repetitions: t.repetitions,
        videoUrl: t.videoUrl,
        libraryTaskId: t.libraryTaskId,
        order: order++,
      })
    }
  }

  if (rows.length === 0) return []
  // ...AndReturn so the caller can hand the new tasks straight to the review
  // step, instead of re-querying and guessing which rows are the new ones.
  return prisma.trainingTask.createManyAndReturn({ data: rows })
}
