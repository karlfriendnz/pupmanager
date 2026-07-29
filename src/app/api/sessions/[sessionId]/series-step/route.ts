import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveSeriesSteps, stampsForStepChange, stepForIndex, stepOptions } from '@/lib/series'

// Which curriculum step a SERIES session covers.
//
// GET   — the step this session is on, and (on a consult) every step it could
//         be moved to.
// PATCH — move it. Only the TRAINER can: skipping a step is a judgement about
//         a particular dog ("she already has recall"), never something a client
//         does, so there is no client-facing route to this.
//
// Serves BOTH shapes of series, because a curriculum belongs to the Package and
// a Package is the template behind a class as well as a consult:
//
//   • a 1:1 CONSULT session resolves against its client's own sessions, and can
//     be moved — `pinnable: true`;
//   • a GROUP CLASS session is week N of a cohort, so its step is its own
//     session number and there is nothing to move — `pinnable: false`. A class
//     that let one session be re-pointed would be re-pointing it for everyone
//     in the room, which is not what "skip a step for this dog" means.
//
// Returns an empty payload rather than 404 when the session isn't part of a
// series, so the screen renders nothing instead of an error.

async function trainerId() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) return null
  return session.user.trainerId
}

const PLAN_SELECT = {
  orderBy: { sessionIndex: 'asc' },
  select: { id: true, sessionIndex: true, title: true, description: true },
} as const

/** The session, its curriculum, and — on a 1:1 session — its siblings in calendar order. */
async function loadSeries(sessionId: string, tid: string) {
  const session = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId: tid },
    select: {
      id: true,
      sessionIndex: true,
      clientPackageId: true,
      classRun: {
        select: {
          id: true,
          package: { select: { id: true, name: true, isSeries: true, sessionPlans: PLAN_SELECT } },
        },
      },
      clientPackage: {
        select: {
          package: { select: { id: true, name: true, isSeries: true, sessionPlans: PLAN_SELECT } },
        },
      },
    },
  })
  if (!session) return null

  // A class cohort: the step IS the week, so no siblings are read and nothing
  // is pinnable.
  if (session.classRun) {
    const pkg = session.classRun.package
    if (!pkg.isSeries) return null
    return { session, pkg, siblings: [], isGroup: true as const }
  }

  if (!session.clientPackageId || !session.clientPackage?.package.isSeries) return null

  const siblings = await prisma.trainingSession.findMany({
    where: { clientPackageId: session.clientPackageId },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, sessionPlanId: true },
  })
  return { session, pkg: session.clientPackage.package, siblings, isGroup: false as const }
}

export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { sessionId } = await params

  const loaded = await loadSeries(sessionId, tid)
  if (!loaded) return NextResponse.json({ isSeries: false, pinnable: false, step: null, steps: [] })

  // The one difference between the two shapes, in one place: a cohort's step is
  // its week, a client's step is whatever the trainer pinned it to.
  const mine = loaded.isGroup
    ? { step: stepForIndex(loaded.pkg.sessionPlans, loaded.session.sessionIndex), pinned: false }
    : resolveSeriesSteps(loaded.pkg.sessionPlans, loaded.siblings).find(r => r.sessionId === sessionId) ?? null
  const detail = mine?.step ? loaded.pkg.sessionPlans.find(p => p.id === mine.step!.id) ?? null : null

  return NextResponse.json({
    isSeries: true,
    isGroup: loaded.isGroup,
    // A class session cannot be moved to another step — see loadSeries.
    pinnable: !loaded.isGroup,
    packageName: loaded.pkg.name,
    // Where this session sits on the calendar, which is NOT its step number
    // once anything has been skipped — the screen shows both so the difference
    // is visible rather than confusing. A class can't diverge, so it just
    // reports its own week.
    position: loaded.isGroup
      ? loaded.session.sessionIndex
      : loaded.siblings.findIndex(s => s.id === sessionId) + 1,
    total: loaded.isGroup ? loaded.pkg.sessionPlans.length : loaded.siblings.length,
    step: mine?.step
      ? {
          id: mine.step.id,
          sessionIndex: mine.step.sessionIndex,
          title: mine.step.title,
          description: detail?.description ?? null,
          pinned: mine.pinned,
        }
      : null,
    // Nothing to choose from on a class — an empty list is what stops the
    // screen offering a picker that PATCH would refuse.
    steps: loaded.isGroup ? [] : stepOptions(loaded.pkg.sessionPlans).map(s => ({
      id: s.id,
      sessionIndex: s.sessionIndex,
      title: s.title,
    })),
  })
}

const patchSchema = z.object({
  /** The step to move to, or null to hand it back to the natural order. */
  stepId: z.string().nullable(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { sessionId } = await params

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const loaded = await loadSeries(sessionId, tid)
  if (!loaded) return NextResponse.json({ error: 'Not a series session' }, { status: 404 })

  // A cohort moves through the curriculum together: "skip this one for her"
  // has no meaning when the room is doing week 3 either way. Refused here as
  // well as hidden in the UI, because the UI is not a permission.
  if (loaded.isGroup) {
    return NextResponse.json(
      { error: 'A class covers its curriculum a week at a time — steps are not moved per session.' },
      { status: 409 },
    )
  }

  // The step must belong to THIS series. Otherwise a session could be pointed at
  // another offering's curriculum, and the homework join would follow it there.
  if (parsed.data.stepId && !loaded.pkg.sessionPlans.some(p => p.id === parsed.data.stepId)) {
    return NextResponse.json({ error: 'Step not found' }, { status: 404 })
  }

  // A skip shifts everything after it, so the whole tail is restamped in one
  // transaction — see stampsForStepChange for why this isn't one row.
  const changes = stampsForStepChange({
    steps: loaded.pkg.sessionPlans,
    sessions: loaded.siblings,
    sessionId,
    stepId: parsed.data.stepId,
  })

  if (changes.length) {
    await prisma.$transaction(
      changes.map(c =>
        prisma.trainingSession.update({ where: { id: c.sessionId }, data: { sessionPlanId: c.sessionPlanId } }),
      ),
    )
  }

  return NextResponse.json({ ok: true, changed: changes.length })
}
