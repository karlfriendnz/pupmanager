// Keeps open-ended, SLOT-scheduled runs — doggy daycare and casual drop-in
// classes — stocked with sessions out to the rolling horizon.
//
// The bug this exists for: a daycare's day-parts are written as bare
// `FREQ=WEEKLY` slots, `planSlotSessions` runs exactly once (at creation), and
// nothing ever topped it up — `extendOngoingPackages` only walks 1:1
// `ClientPackage` assignments. The board and the client booking wizard emptied
// about three months in, silently.
//
// Deliberately the same posture as extendOngoingPackages: fill FORWARD from the
// last session each slot already has, never fill a gap. TrainingSession has no
// soft-delete — /api/schedule/[sessionId] hard-deletes, and syncOfferingRun
// already refuses to rebuild a series for exactly this reason — so a top-up that
// "restored the sessions the rule says should exist" would resurrect the public
// holiday the trainer deleted on purpose, every night, forever.
import { prisma } from './prisma'
import { planSlotSessions, slotHorizonEnd } from './class-runs'

const DAY_MS = 86_400_000

// Only top a slot up once its tail drops inside this window of the horizon, so
// the nightly job isn't writing a handful of rows to every daycare in the system
// every single night. With a 12-month horizon this means one refill a month per
// slot; the tail never gets closer than 11 months out, so nothing on screen ever
// approaches an end.
const REFILL_WHEN_WITHIN_DAYS = 30

// Runaway guards. Neither should ever bite in normal use — a year of a 15-slot
// daycare is ~780 rows across all its slots, and the first pass over an existing
// (12-week) daycare is the only time a run creates that many at once.
const MAX_SESSIONS_PER_RUN = 1200
const MAX_RUNS_PER_CALL = 200

export type ExtendSlotRunsResult = {
  /** Runs that had at least one session added. */
  runsExtended: number
  sessionsCreated: number
  /** True when MAX_RUNS_PER_CALL capped the pass — call again to finish. */
  truncated: boolean
}

/**
 * Top every due slot-scheduled run back up to a full horizon of sessions.
 *
 * Idempotent: a second call finds each slot's tail already past the refill
 * window and does nothing. Safe to call from a cron, a script, or a test.
 */
export async function extendSlotRuns(
  opts: { trainerId?: string; now?: Date } = {},
): Promise<ExtendSlotRunsResult> {
  const now = opts.now ?? new Date()
  const through = slotHorizonEnd(now)
  const refillBelow = new Date(through.getTime() - REFILL_WHEN_WITHIN_DAYS * DAY_MS)

  // The furthest session each slot holds on each run, in one grouped read. This
  // is both the "does it need work?" test and the anchor we fill forward from.
  const tails = await prisma.trainingSession.groupBy({
    by: ['classRunId', 'packageSessionSlotId'],
    where: {
      packageSessionSlotId: { not: null },
      classRunId: { not: null },
      classRun: { status: { in: ['SCHEDULED', 'RUNNING'] } },
      ...(opts.trainerId ? { trainerId: opts.trainerId } : {}),
    },
    _max: { scheduledAt: true },
  })

  // runId → (slotId → the last session that slot already has).
  const dueByRun = new Map<string, Map<string, Date>>()
  for (const t of tails) {
    const tail = t._max.scheduledAt
    if (!t.classRunId || !t.packageSessionSlotId || !tail) continue
    if (tail >= refillBelow) continue
    const slots = dueByRun.get(t.classRunId) ?? new Map<string, Date>()
    slots.set(t.packageSessionSlotId, tail)
    dueByRun.set(t.classRunId, slots)
  }
  if (dueByRun.size === 0) return { runsExtended: 0, sessionsCreated: 0, truncated: false }

  const allRunIds = [...dueByRun.keys()]
  const runIds = allRunIds.slice(0, MAX_RUNS_PER_CALL)

  const runs = await prisma.classRun.findMany({
    where: { id: { in: runIds } },
    select: {
      id: true,
      trainerId: true,
      name: true,
      startDate: true,
      location: true,
      package: {
        select: {
          sessionType: true,
          sessionSlots: {
            select: {
              id: true, order: true, startDate: true, day: true,
              startTime: true, endTime: true, gapMins: true,
              recurrenceRule: true, assignedMembershipIds: true,
              location: { select: { name: true, address: true } },
            },
          },
        },
      },
      trainer: { select: { user: { select: { timezone: true } } } },
    },
  })

  let runsExtended = 0
  let sessionsCreated = 0

  for (const run of runs) {
    const due = dueByRun.get(run.id)
    if (!due) continue
    const tz = run.trainer.user?.timezone || 'Pacific/Auckland'

    type NewRow = {
      scheduledAt: Date
      durationMins: number
      bufferMins: number
      assignedMembershipId: string | null
      packageSessionSlotId: string
      location: string | null
    }
    const rows: NewRow[] = []

    for (const slot of run.package.sessionSlots) {
      const tail = due.get(slot.id)
      // No tail = this slot has NO sessions on this run. Could be a slot added
      // to the timetable after the run was scheduled, or one whose sessions were
      // all deleted deliberately — and we can't tell the two apart, so leave it
      // alone rather than guess. Same call extendOngoingPackages makes.
      if (!tail) continue

      // Re-plan the slot's whole series from its own anchor (so the cadence is
      // identical to the one creation used) and keep only what lands after the
      // tail. A session deleted mid-series stays deleted.
      const plan = planSlotSessions([slot], { runStart: run.startDate, tz, through })
      for (const p of plan) {
        if (p.scheduledAt.getTime() <= tail.getTime()) continue
        rows.push({
          scheduledAt: p.scheduledAt,
          durationMins: p.durationMins,
          bufferMins: p.bufferMins,
          assignedMembershipId: p.assignedMembershipId,
          packageSessionSlotId: slot.id,
          location: slot.location?.address || slot.location?.name || run.location,
        })
      }
    }

    if (rows.length === 0) continue
    rows.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    const capped = rows.slice(0, MAX_SESSIONS_PER_RUN)

    // sessionIndex carries on from what the run already holds — it's the run's
    // position counter, and a slot-scheduled run's title deliberately doesn't
    // quote a total (there isn't one).
    const existing = await prisma.trainingSession.count({ where: { classRunId: run.id } })
    await prisma.trainingSession.createMany({
      data: capped.map((r, i) => ({
        trainerId: run.trainerId,
        classRunId: run.id,
        sessionIndex: existing + i + 1,
        title: run.name,
        sessionType: run.package.sessionType,
        ...r,
      })),
    })

    runsExtended++
    sessionsCreated += capped.length
  }

  // Deliberately no Google Calendar push. A refill is up to a month of a
  // multi-part daycare at a time and syncSessionsToGoogle writes one event per
  // session in parallel; the google-calendar-backfill cron already exists to
  // mirror sessions with no googleCalendarEventId, paged and resumable, and it
  // is the right place for volume like this.
  return { runsExtended, sessionsCreated, truncated: allRunIds.length > runIds.length }
}
