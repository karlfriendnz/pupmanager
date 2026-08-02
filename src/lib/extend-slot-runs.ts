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
// last session each slot already has, never fill a gap. A top-up that "restored
// the sessions the rule says should exist" would resurrect the public holiday
// the trainer deleted on purpose, every night, forever.
//
// Filling forward is not enough on its own, though, because the two things a
// trainer can now do to a single occurrence both move the tail:
//
//   • CANCELLING the last one leaves the row in place (cancelledAt set), so the
//     tail doesn't move and the date is inert. Safe by construction — this is
//     one of the reasons a cancellation is a column and not a delete.
//   • MOVING one EARLIER does move the tail back, and the rule still says a
//     session belongs at the old time. So the planner is also given the set of
//     instants that are already spoken for — a moved session's
//     originalScheduledAt, and a cancelled one's own time — and skips them.
//
// See lib/run-occurrences.ts.
import { prisma } from './prisma'
import { planSlotSessions, slotHorizonEnd } from './class-runs'
import { spokenForInstants } from './run-occurrences'

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

  // Every occurrence on these runs that was cancelled or moved by hand. Small
  // by nature — most runs have none — and it is the only thing standing between
  // a moved week and the cron putting it back at its old time tomorrow night.
  const touched = await prisma.trainingSession.findMany({
    where: {
      classRunId: { in: allRunIds.slice(0, MAX_RUNS_PER_CALL) },
      packageSessionSlotId: { not: null },
      OR: [{ cancelledAt: { not: null } }, { scheduleOverriddenAt: { not: null } }],
    },
    select: {
      classRunId: true, packageSessionSlotId: true,
      scheduledAt: true, cancelledAt: true, originalScheduledAt: true,
    },
  })
  // (runId, slotId) → the instants that slot must not plan again.
  const spokenFor = new Map<string, Set<number>>()
  for (const [key, rows] of groupBySlot(touched)) spokenFor.set(key, spokenForInstants(rows))

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
      const dead = spokenFor.get(`${run.id}:${slot.id}`)
      for (const p of plan) {
        if (p.scheduledAt.getTime() <= tail.getTime()) continue
        // A week the trainer moved out of the way, or called off, does not come
        // back — even when the tail has since fallen behind it.
        if (dead?.has(p.scheduledAt.getTime())) continue
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

/** (runId:slotId) → its rows. Both ids are non-null by the query's own where. */
function groupBySlot<T extends { classRunId: string | null; packageSessionSlotId: string | null }>(
  rows: T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    if (!r.classRunId || !r.packageSessionSlotId) continue
    const key = `${r.classRunId}:${r.packageSessionSlotId}`
    const list = out.get(key) ?? []
    list.push(r)
    out.set(key, list)
  }
  return out
}
