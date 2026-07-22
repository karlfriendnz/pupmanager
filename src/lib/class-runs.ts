// Group-class engine. A group Package is a sellable template; a ClassRun
// is one scheduled cohort off it that owns ONE shared TrainingSession
// series (sessions have classRunId set, clientId null). Clients join via
// ClassEnrollment. Capacity, waitlist and drop-in pricing live here so
// the rules are in one place and the pure parts are unit-tested.
//
// The 1:1 ClientPackage path is entirely separate and untouched.
import { prisma } from './prisma'
import type { Prisma, PrismaClient } from '@/generated/prisma'
import { effectiveBufferMins, normalizeBufferMins } from './buffer'

// Re-exported so server code can keep importing it from here; the flag
// itself lives in the client-safe feature-flags module.
export { PUBLIC_CLASS_ENROLLMENT_ENABLED } from './feature-flags'

// ─── Pure logic (no DB — unit-tested in tests/unit/class-runs.test.ts) ───────

/**
 * The shared session schedule for a run: `sessionCount` dates starting at
 * `startDate`, `weeksBetween` apart. sessionCount === 0 (ongoing package)
 * yields a single seed session — ongoing group classes top up elsewhere.
 */
export function generateSessionDates(
  startDate: Date,
  sessionCount: number,
  weeksBetween: number,
): Date[] {
  const n = sessionCount > 0 ? sessionCount : 1
  const gap = Math.max(0, weeksBetween)
  const out: Date[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i * gap * 7)
    out.push(d)
  }
  return out
}

/** Per-run capacity override falls back to the package's, else unlimited. */
export function effectiveCapacity(
  runCapacity: number | null | undefined,
  packageCapacity: number | null | undefined,
): number | null {
  if (typeof runCapacity === 'number') return runCapacity
  if (typeof packageCapacity === 'number') return packageCapacity
  return null
}

/** How many ENROLLED seats are left (null = unlimited, never negative). */
export function seatsRemaining(
  capacity: number | null,
  enrolledCount: number,
): number | null {
  if (capacity === null) return null
  return Math.max(0, capacity - enrolledCount)
}

export type EnrollDecision = 'ENROLLED' | 'WAITLISTED' | 'REJECTED_FULL'

/**
 * What happens when someone tries to enrol: a free seat → ENROLLED;
 * no seat but the package allows a waitlist → WAITLISTED; otherwise
 * REJECTED_FULL. Unlimited capacity always enrols.
 */
export function decideEnrollment(args: {
  capacity: number | null
  enrolledCount: number
  allowWaitlist: boolean
}): EnrollDecision {
  const left = seatsRemaining(args.capacity, args.enrolledCount)
  if (left === null || left > 0) return 'ENROLLED'
  return args.allowWaitlist ? 'WAITLISTED' : 'REJECTED_FULL'
}

/**
 * Price for a DROP_IN joining at 1-based `joinedAtIndex` of a run with
 * `sessionCount` sessions: per-session drop-in rate × sessions they can
 * still attend. Returns null when the package has no drop-in price set.
 */
export function dropInPriceCents(args: {
  dropInPriceCents: number | null | undefined
  sessionCount: number
  joinedAtIndex: number
}): number | null {
  if (typeof args.dropInPriceCents !== 'number') return null
  const total = args.sessionCount > 0 ? args.sessionCount : 1
  const remaining = Math.max(0, total - (args.joinedAtIndex - 1))
  return args.dropInPriceCents * remaining
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

type Tx = PrismaClient | Prisma.TransactionClient

/**
 * Replace the set of team members assigned to a run. Only memberships that
 * belong to this company (companyId === trainerId) are honoured — anything
 * else is silently dropped, so a caller can't assign someone else's staff.
 * Passing `undefined` leaves the assignments untouched; passing `[]` clears them.
 */
export async function setRunTrainers(
  classRunId: string,
  companyId: string,
  membershipIds: string[] | undefined,
  tx: Tx = prisma,
): Promise<void> {
  if (membershipIds === undefined) return
  const valid = await tx.trainerMembership.findMany({
    where: { id: { in: membershipIds }, companyId },
    select: { id: true },
  })
  const ids = valid.map((m) => m.id)
  await tx.classRunTrainer.deleteMany({ where: { classRunId } })
  if (ids.length > 0) {
    await tx.classRunTrainer.createMany({
      data: ids.map((membershipId) => ({ classRunId, membershipId })),
    })
  }
}

/** Count of seats that consume capacity (ENROLLED only). */
export async function enrolledCount(classRunId: string, tx: Tx = prisma): Promise<number> {
  return tx.classEnrollment.count({
    where: { classRunId, status: 'ENROLLED' },
  })
}

/**
 * Create a ClassRun and its shared session series in one transaction.
 * Sessions carry classRunId + 1-based sessionIndex and no clientId —
 * attendance is per-enrollee via SessionAttendance.
 */
export async function createClassRun(args: {
  trainerId: string
  packageId: string
  name: string
  startDate: Date
  scheduleNote?: string | null
  capacity?: number | null
  // Per-run override of the package's "gap before the next session".
  // undefined/null = inherit the package's bufferMins.
  bufferMins?: number | null
}): Promise<{ id: string; sessionCount: number; createdSessionIds: string[] }> {
  const pkg = await prisma.package.findFirst({
    where: { id: args.packageId, trainerId: args.trainerId, isGroup: true },
  })
  if (!pkg) throw new ClassError('PACKAGE_NOT_FOUND', 'Group package not found')

  const dates = generateSessionDates(args.startDate, pkg.sessionCount, pkg.weeksBetween)
  const buffer = effectiveBufferMins(args.bufferMins, pkg.bufferMins)

  return prisma.$transaction(async (tx) => {
    const run = await tx.classRun.create({
      data: {
        trainerId: args.trainerId,
        packageId: pkg.id,
        name: args.name,
        scheduleNote: args.scheduleNote ?? null,
        startDate: args.startDate,
        capacity: args.capacity ?? null,
        bufferMins: args.bufferMins ?? null,
      },
    })
    await tx.trainingSession.createMany({
      data: dates.map((d, i) => ({
        trainerId: args.trainerId,
        classRunId: run.id,
        sessionIndex: i + 1,
        title:
          pkg.sessionCount > 1
            ? `${args.name} — session ${i + 1}/${pkg.sessionCount}`
            : args.name,
        scheduledAt: d,
        durationMins: pkg.durationMins,
        bufferMins: buffer,
        sessionType: pkg.sessionType,
      })),
    })
    // createMany returns no ids — re-read them (visible inside this tx) so the
    // caller can mirror just these sessions to Google Calendar post-commit.
    const created = await tx.trainingSession.findMany({
      where: { classRunId: run.id },
      select: { id: true },
    })
    return { id: run.id, sessionCount: dates.length, createdSessionIds: created.map((s) => s.id) }
  })
}

/**
 * One-step class creation: a trainer describes the class inline (no separate
 * "make a package first" step), and we transparently create the backing group
 * Package, the ClassRun, and the shared session series together. The package
 * is still created so pricing / re-running stays consistent with the rest of
 * the system — it's just hidden from the 1:1 Packages list.
 */
export async function createClassWithPackage(args: {
  trainerId: string
  name: string
  startDate: Date
  sessionCount: number
  weeksBetween: number
  durationMins: number
  // "Gap before the next session" — travel / clean-up / reset. Stored on the
  // backing package AND snapshotted onto each created session.
  bufferMins?: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  priceCents?: number | null
  capacity?: number | null
  color?: string | null
  scheduleNote?: string | null
  defaultSessionFormId?: string | null
  imageUrl?: string | null
  // TrainerMembership ids (of this company) to assign as the class's trainers.
  assignedMembershipIds?: string[]
  // Tri-state "require payment to enrol": null = inherit trainer default.
  requirePayment?: boolean | null
}): Promise<{ id: string; sessionCount: number; createdSessionIds: string[] }> {
  const count = args.sessionCount > 0 ? args.sessionCount : 1
  const dates = generateSessionDates(args.startDate, count, args.weeksBetween)
  const buffer = normalizeBufferMins(args.bufferMins)

  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.create({
      data: {
        trainerId: args.trainerId,
        name: args.name,
        sessionCount: count,
        weeksBetween: args.weeksBetween,
        durationMins: args.durationMins,
        bufferMins: buffer,
        sessionType: args.sessionType,
        priceCents: args.priceCents ?? null,
        isGroup: true,
        capacity: args.capacity ?? null,
        color: args.color ?? null,
        defaultSessionFormId: args.defaultSessionFormId ?? null,
        order: 0,
      },
    })
    const run = await tx.classRun.create({
      data: {
        trainerId: args.trainerId,
        packageId: pkg.id,
        name: args.name,
        scheduleNote: args.scheduleNote ?? null,
        startDate: args.startDate,
        capacity: args.capacity ?? null,
        imageUrl: args.imageUrl ?? null,
        requirePayment: args.requirePayment ?? null,
      },
    })
    await tx.trainingSession.createMany({
      data: dates.map((d, i) => ({
        trainerId: args.trainerId,
        classRunId: run.id,
        sessionIndex: i + 1,
        title: count > 1 ? `${args.name} — session ${i + 1}/${count}` : args.name,
        scheduledAt: d,
        durationMins: args.durationMins,
        bufferMins: buffer,
        sessionType: args.sessionType,
      })),
    })
    await setRunTrainers(run.id, args.trainerId, args.assignedMembershipIds, tx)
    // createMany returns no ids — re-read them (visible inside this tx) so the
    // caller can mirror just these sessions to Google Calendar post-commit.
    const created = await tx.trainingSession.findMany({
      where: { classRunId: run.id },
      select: { id: true },
    })
    return { id: run.id, sessionCount: dates.length, createdSessionIds: created.map((s) => s.id) }
  })
}

/**
 * Edit a class. Settings (name, price, capacity, duration, format, schedule
 * note) always apply. Changing the *schedule* (start/cadence/weeks) rebuilds
 * the session series — but only when no attendance has been recorded yet, so
 * we never wipe history; otherwise it throws HAS_ATTENDANCE and the caller
 * should keep the schedule fixed.
 */
export async function updateClass(args: {
  runId: string
  trainerId: string
  name: string
  scheduleNote: string | null
  capacity: number | null
  priceCents: number | null
  durationMins: number
  // "Gap before the next session"; undefined leaves it untouched.
  bufferMins?: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  startDate: Date
  sessionCount: number
  weeksBetween: number
  defaultSessionFormId?: string | null
  imageUrl?: string | null
  // TrainerMembership ids to assign; undefined leaves assignments untouched.
  assignedMembershipIds?: string[]
  // Tri-state "require payment to enrol"; undefined leaves it untouched.
  requirePayment?: boolean | null
  // When the schedule was rebuilt: the ids of the freshly-created sessions (to
  // mirror to Google) and the Google event ids of the deleted ones (to remove).
}): Promise<{ scheduleChanged: boolean; createdSessionIds: string[]; deletedEventIds: string[] }> {
  const run = await prisma.classRun.findFirst({
    where: { id: args.runId, trainerId: args.trainerId },
    include: {
      package: true,
      sessions: { select: { id: true, sessionIndex: true, googleCalendarEventId: true } },
    },
  })
  if (!run) throw new ClassError('RUN_NOT_FOUND', 'Class not found')

  const scheduleChanged =
    run.startDate.getTime() !== args.startDate.getTime() ||
    run.package.weeksBetween !== args.weeksBetween ||
    run.package.sessionCount !== args.sessionCount

  if (scheduleChanged) {
    const attended = await prisma.sessionAttendance.count({
      where: { session: { classRunId: run.id } },
    })
    if (attended > 0) {
      throw new ClassError(
        'HAS_ATTENDANCE',
        "Can't reschedule a class that already has attendance recorded. Change the other details, or cancel this class and create a new one.",
      )
    }
  }

  // The gap the class's sessions should now carry. A class edited through the
  // form always writes the buffer onto its backing package, so the run-level
  // override stays null and the two can never drift.
  const buffer =
    args.bufferMins !== undefined
      ? normalizeBufferMins(args.bufferMins)
      : effectiveBufferMins(run.bufferMins, run.package.bufferMins)

  // A rebuild deletes the old sessions — capture their mirrored Google event ids
  // first so the caller can remove them from the calendar post-commit.
  const deletedEventIds = scheduleChanged
    ? run.sessions.map((s) => s.googleCalendarEventId).filter((id): id is string => !!id)
    : []
  let createdSessionIds: string[] = []

  await prisma.$transaction(async (tx) => {
    await tx.package.update({
      where: { id: run.packageId },
      data: {
        name: args.name,
        priceCents: args.priceCents,
        durationMins: args.durationMins,
        sessionType: args.sessionType,
        capacity: args.capacity,
        sessionCount: args.sessionCount,
        weeksBetween: args.weeksBetween,
        ...(args.bufferMins !== undefined && { bufferMins: buffer }),
        ...(args.defaultSessionFormId !== undefined && { defaultSessionFormId: args.defaultSessionFormId }),
      },
    })
    await tx.classRun.update({
      where: { id: run.id },
      data: {
        name: args.name,
        scheduleNote: args.scheduleNote,
        capacity: args.capacity,
        startDate: args.startDate,
        ...(args.bufferMins !== undefined && { bufferMins: buffer }),
        ...(args.imageUrl !== undefined && { imageUrl: args.imageUrl }),
        ...(args.requirePayment !== undefined && { requirePayment: args.requirePayment }),
      },
    })

    await setRunTrainers(run.id, args.trainerId, args.assignedMembershipIds, tx)

    if (scheduleChanged) {
      await tx.trainingSession.deleteMany({ where: { classRunId: run.id } })
      const dates = generateSessionDates(args.startDate, args.sessionCount, args.weeksBetween)
      await tx.trainingSession.createMany({
        data: dates.map((d, i) => ({
          trainerId: args.trainerId,
          classRunId: run.id,
          sessionIndex: i + 1,
          title: args.sessionCount > 1 ? `${args.name} — session ${i + 1}/${args.sessionCount}` : args.name,
          scheduledAt: d,
          durationMins: args.durationMins,
          bufferMins: buffer,
          sessionType: args.sessionType,
        })),
      })
      // Re-read the fresh ids (visible in-tx) to mirror just these to Google.
      const created = await tx.trainingSession.findMany({
        where: { classRunId: run.id },
        select: { id: true },
      })
      createdSessionIds = created.map((s) => s.id)
    } else {
      // Schedule unchanged — propagate name/duration/buffer/format to existing
      // sessions. A class is one shared event the trainer is editing head-on, so
      // (unlike a 1:1 package) changing its gap here is meant to apply to it.
      for (const s of run.sessions) {
        const idx = s.sessionIndex ?? 1
        await tx.trainingSession.update({
          where: { id: s.id },
          data: {
            title: args.sessionCount > 1 ? `${args.name} — session ${idx}/${args.sessionCount}` : args.name,
            durationMins: args.durationMins,
            ...(args.bufferMins !== undefined && { bufferMins: buffer }),
            sessionType: args.sessionType,
          },
        })
      }
    }
  })

  return { scheduleChanged, createdSessionIds, deletedEventIds }
}

/**
 * Enrol a client+dog into a run. Server-authoritative capacity/waitlist —
 * the decision is recomputed inside the transaction so two concurrent
 * enrols can't both take the last seat. Drop-in stamps joinedAtIndex
 * (the next not-yet-held session) so the roster/pricing start there.
 */
export async function enrollInRun(args: {
  classRunId: string
  clientId: string
  dogId?: string | null
  type?: 'FULL' | 'DROP_IN'
  source?: 'TRAINER' | 'SELF_SERVE'
}): Promise<{ enrollmentId: string; status: 'ENROLLED' | 'WAITLISTED' }> {
  return prisma.$transaction(async (tx) => {
    const run = await tx.classRun.findUnique({
      where: { id: args.classRunId },
      include: { package: true },
    })
    if (!run) throw new ClassError('RUN_NOT_FOUND', 'Class not found')
    if (run.status === 'CANCELLED' || run.status === 'COMPLETED') {
      throw new ClassError('RUN_CLOSED', 'This class is no longer taking enrolments')
    }
    const type = args.type ?? 'FULL'
    if (type === 'DROP_IN' && !run.package.allowDropIn) {
      throw new ClassError('NO_DROP_IN', 'This class does not allow drop-ins')
    }

    // Re-enrolling after withdrawal reuses the row; a live enrolment is a
    // conflict (the unique index also enforces this at the DB level).
    // findFirst, not findUnique: the @@unique includes nullable dogId, and
    // SQL NULLs aren't equal — Prisma's compound-unique selector can't
    // express "dogId IS NULL". A plain equality where handles both cases.
    const existing = await tx.classEnrollment.findFirst({
      where: {
        classRunId: args.classRunId,
        clientId: args.clientId,
        dogId: args.dogId ?? null,
      },
    })
    if (existing && existing.status !== 'WITHDRAWN') {
      throw new ClassError('ALREADY_ENROLLED', 'Already enrolled in this class')
    }

    const count = await enrolledCount(args.classRunId, tx)
    const capacity = effectiveCapacity(run.capacity, run.package.capacity)
    const decision = decideEnrollment({
      capacity,
      enrolledCount: count,
      allowWaitlist: run.package.allowWaitlist,
    })
    if (decision === 'REJECTED_FULL') {
      throw new ClassError('FULL', 'This class is full')
    }

    let waitlistPosition: number | null = null
    if (decision === 'WAITLISTED') {
      const last = await tx.classEnrollment.aggregate({
        where: { classRunId: args.classRunId, status: 'WAITLISTED' },
        _max: { waitlistPosition: true },
      })
      waitlistPosition = (last._max.waitlistPosition ?? 0) + 1
    }

    let joinedAtIndex: number | null = null
    if (type === 'DROP_IN') {
      const nextSession = await tx.trainingSession.findFirst({
        where: { classRunId: args.classRunId, scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: 'asc' },
        select: { sessionIndex: true },
      })
      joinedAtIndex = nextSession?.sessionIndex ?? 1
    }

    const data = {
      classRunId: args.classRunId,
      clientId: args.clientId,
      dogId: args.dogId ?? null,
      type,
      status: decision,
      waitlistPosition,
      joinedAtIndex,
      source: args.source ?? 'TRAINER',
      withdrawnAt: null,
    } as const

    const enrollment = existing
      ? await tx.classEnrollment.update({ where: { id: existing.id }, data })
      : await tx.classEnrollment.create({ data })

    return { enrollmentId: enrollment.id, status: decision as 'ENROLLED' | 'WAITLISTED' }
  })
}

/**
 * Withdraw an enrolment. If it freed a real seat (was ENROLLED) and the
 * package allows a waitlist, promote the lowest-position WAITLISTED
 * enrolment. Returns the promoted enrolment id (for notification) if any.
 */
export async function withdrawEnrollment(
  enrollmentId: string,
): Promise<{ promotedEnrollmentId: string | null }> {
  return prisma.$transaction(async (tx) => {
    const enr = await tx.classEnrollment.findUnique({
      where: { id: enrollmentId },
      select: { id: true, classRunId: true, status: true },
    })
    if (!enr) throw new ClassError('ENROLLMENT_NOT_FOUND', 'Enrolment not found')

    await tx.classEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'WITHDRAWN', withdrawnAt: new Date(), waitlistPosition: null },
    })

    if (enr.status !== 'ENROLLED') return { promotedEnrollmentId: null }

    const next = await tx.classEnrollment.findFirst({
      where: { classRunId: enr.classRunId, status: 'WAITLISTED' },
      orderBy: { waitlistPosition: 'asc' },
      select: { id: true },
    })
    if (!next) return { promotedEnrollmentId: null }

    await tx.classEnrollment.update({
      where: { id: next.id },
      data: { status: 'ENROLLED', waitlistPosition: null },
    })
    return { promotedEnrollmentId: next.id }
  })
}

/**
 * Withdraw an enrolment AND notify the promoted waitlister, if any. Shared by
 * the trainer-side withdraw route and the client self-cancel route so promotion
 * + the "you're off the waitlist" notification behave identically in both. The
 * promote notification is best-effort and never blocks the withdraw. Returns the
 * promoted enrolment id (or null).
 */
export async function withdrawEnrollmentAndNotify(
  enrollmentId: string,
  trainerId: string,
): Promise<{ promotedEnrollmentId: string | null }> {
  const { promotedEnrollmentId } = await withdrawEnrollment(enrollmentId)

  if (promotedEnrollmentId) {
    const promoted = await prisma.classEnrollment.findUnique({
      where: { id: promotedEnrollmentId },
      select: { clientId: true, classRun: { select: { name: true } } },
    })
    if (promoted) {
      await prisma.clientNotification
        .create({
          data: {
            clientId: promoted.clientId,
            trainerId,
            subject: `You're off the waitlist for ${promoted.classRun.name}`,
            notes: `A spot opened up and you've been enrolled in ${promoted.classRun.name}.`,
          },
        })
        .catch(e => console.error('[class withdraw] promote notify failed', e))
    }
  }
  return { promotedEnrollmentId }
}

/**
 * Is a class run finished (i.e. belongs on the "Past" tab)?
 *
 * Explicitly completed/cancelled runs are always past. Otherwise a run is past
 * once its LAST session has been and gone — not merely because it started a
 * while ago, since a 6-week course starting last month is still running.
 * Falls back to the start date when no sessions exist yet.
 */
export function isClassRunPast(
  run: { status: string; startDate: Date; lastSessionAt?: Date | null },
  now: Date = new Date(),
): boolean {
  if (run.status === 'COMPLETED' || run.status === 'CANCELLED') return true
  return (run.lastSessionAt ?? run.startDate).getTime() < now.getTime()
}

export class ClassError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'ClassError'
  }
}
