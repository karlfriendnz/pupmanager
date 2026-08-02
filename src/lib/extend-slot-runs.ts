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
//
// ── The other half: a day-part added to a daycare that already exists ────────
//
// Filling forward from a tail says nothing about a slot that has NO tail, and
// that is exactly what a new day-part is. A trainer adding "Afternoon" to a
// running daycare got a row in the setup table and not one session anywhere:
// the run's series is only ever laid down by createClassRunIn, syncOfferingRun
// refuses to touch a slot-scheduled run's dates, and this file used to skip a
// tail-less slot outright. Only the day-parts present on the day the daycare
// was created ever had sessions.
//
// A tail-less slot is now filled when — and only when — it is NEWER than the
// run. That is the honest discriminator: every slot that existed when the run
// was scheduled had its whole horizon written then, so one sitting empty now is
// one whose sessions were removed, and removals stay removed. A slot created
// after the run is one this generator has never seen.
//
// See fillFromForNewSlot for how far back a new day-part fills (it doesn't).
import { prisma } from './prisma'
import { planSlotSessions, slotHorizonEnd, type ScheduleSlot } from './class-runs'
import { spokenForInstants } from './run-occurrences'
import { dateOnlyUtc, utcToZonedDateAndMinutes } from './timezone'

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
  opts: { trainerId?: string; packageId?: string; now?: Date } = {},
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
      classRun: {
        status: { in: ['SCHEDULED', 'RUNNING'] },
        ...(opts.packageId ? { packageId: opts.packageId } : {}),
      },
      ...(opts.trainerId ? { trainerId: opts.trainerId } : {}),
    },
    _max: { scheduledAt: true },
  })

  // runId → (slotId → the last session that slot already has). EVERY pair, not
  // only the due ones: which pairs are absent is what tells us a day-part has no
  // sessions at all. A cancelled occurrence is still a row, so a slot whose only
  // date has been called off has a tail here and is never mistaken for a new one.
  const have = new Map<string, Map<string, Date>>()
  for (const t of tails) {
    const tail = t._max.scheduledAt
    if (!t.classRunId || !t.packageSessionSlotId || !tail) continue
    const slots = have.get(t.classRunId) ?? new Map<string, Date>()
    slots.set(t.packageSessionSlotId, tail)
    have.set(t.classRunId, slots)
  }
  // No slot-scheduled run anywhere in scope — nothing this file can do.
  if (have.size === 0) return { runsExtended: 0, sessionsCreated: 0, truncated: false }

  const freshByRun = await newSlotsByRun(opts, have)

  // runId → (slotId → tail) for the slots that are running out. A run is due
  // when a slot is running out OR it has a day-part that has never been
  // generated; the two reasons are handled separately in the loop below.
  const dueByRun = new Map<string, Map<string, Date>>()
  for (const [runId, slots] of have) {
    const due = new Map<string, Date>()
    for (const [slotId, tail] of slots) if (tail < refillBelow) due.set(slotId, tail)
    if (due.size > 0 || freshByRun.has(runId)) dueByRun.set(runId, due)
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

    const fresh = freshByRun.get(run.id)
    for (const slot of run.package.sessionSlots) {
      const tail = due.get(slot.id)
      // No tail = this slot has NO sessions on this run, and there are only two
      // ways that happens. A day-part added to the timetable after the run was
      // scheduled has never been generated — fill it. A day-part that was there
      // at the start has already had its whole horizon written once, so an empty
      // one is one whose sessions were removed on purpose, and it stays empty
      // (the same call extendOngoingPackages makes). newSlotsByRun tells them
      // apart on createdAt.
      const isNew = !tail && (fresh?.has(slot.id) ?? false)
      if (!tail && !isNew) continue

      // Re-plan the slot's whole series from its own anchor (so the cadence is
      // identical to the one creation used) and keep only what lands after the
      // tail. A session deleted mid-series stays deleted.
      //
      // A NEW day-part has no anchor of its own that means anything — the run's
      // start date is months or years back — so it is re-anchored on today; see
      // anchorForNewSlot. The cutoff is a separate thing from the anchor: the
      // anchor is a calendar day the cadence is measured from, the cutoff is the
      // instant past which a session is worth writing at all.
      const source = isNew ? { ...slot, startDate: anchorForNewSlot(slot, tz, now) } : slot
      const planned = planSlotSessions([source], { runStart: run.startDate, tz, through })
      const after = tail ?? now
      const dead = spokenFor.get(`${run.id}:${slot.id}`)
      for (const p of planned) {
        if (p.scheduledAt.getTime() <= after.getTime()) continue
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

/**
 * The day-parts each run has never generated a single session for — the ones
 * added to a timetable AFTER the run was scheduled.
 *
 * The discriminator is `createdAt`, and it is the only honest one available.
 * Creation writes the whole horizon for every slot the package holds, in the
 * same transaction that creates the run, so:
 *
 *   • slot.createdAt <= run.createdAt — this slot HAS been generated. If it has
 *     no sessions now, they were removed on purpose. Leave it alone; that is the
 *     whole reason this file fills forward rather than gap-filling.
 *   • slot.createdAt >  run.createdAt — this slot appeared afterwards, and no
 *     code path has ever laid its series down. Fill it.
 *
 * Equal timestamps read as "already generated", which is the safe direction and
 * also the true one: Postgres gives every row in one transaction the same
 * CURRENT_TIMESTAMP, so a slot and the run created together tie.
 *
 * A slot that was added later and then had every one of its sessions deleted by
 * hand would be re-filled, once, from today. That window needs a trainer to
 * delete a year of dates one at a time (there is no bulk delete, and the
 * supported tool — cancelling an occurrence — leaves the row, and therefore a
 * tail, behind), and once refilled the slot has a tail again and fill-forward
 * protects it permanently.
 *
 * Deliberately its own small query rather than a widening of the run read
 * below: it returns ids and two timestamps for the slot-scheduled runs only,
 * and it has to run on a pass where nothing else is due — a new day-part is
 * urgent in a way a tail 11 months out is not.
 */
async function newSlotsByRun(
  scope: { trainerId?: string; packageId?: string },
  have: Map<string, Map<string, Date>>,
): Promise<Map<string, Set<string>>> {
  const meta = await prisma.classRun.findMany({
    // The same population the tails groupBy above walked, asked for the same
    // way rather than as an `IN` list of every run id it returned.
    where: {
      status: { in: ['SCHEDULED', 'RUNNING'] },
      package: { sessionSlots: { some: {} } },
      ...(scope.trainerId ? { trainerId: scope.trainerId } : {}),
      ...(scope.packageId ? { packageId: scope.packageId } : {}),
    },
    select: {
      id: true,
      createdAt: true,
      package: { select: { sessionSlots: { select: { id: true, createdAt: true } } } },
    },
  })

  const out = new Map<string, Set<string>>()
  for (const run of meta) {
    const generated = have.get(run.id)
    // A run with no slot-generated session at all is not one to guess about: it
    // is either not slot-scheduled or it has been emptied, and creation is what
    // stocks a new run. Only runs the groupBy saw are candidates.
    if (!generated) continue
    const ids = new Set<string>()
    for (const slot of run.package?.sessionSlots ?? []) {
      if (generated.has(slot.id)) continue
      // Both are `@default(now())` columns and can only be missing when a caller
      // didn't select them. "Not loaded" must never read as "new", or a single
      // missing select would carpet a trainer's diary.
      if (!(slot.createdAt instanceof Date) || !(run.createdAt instanceof Date)) continue
      if (slot.createdAt.getTime() <= run.createdAt.getTime()) continue
      ids.add(slot.id)
    }
    if (ids.size > 0) out.set(run.id, ids)
  }
  return out
}

/**
 * The calendar day a brand-new day-part starts running from: TODAY in the
 * trainer's timezone, or the slot's own "starts from" when the trainer set one
 * in the future.
 *
 * How far BACK a new day-part fills is the one real decision here, and the
 * answer is: not at all. The alternative — filling the horizon the rest of the
 * run already covers, from the run's start date — writes months of sessions
 * into weeks that have already happened: a board and a week view showing an
 * afternoon nobody ran, no attendance against it forever, and a register the
 * trainer has to explain. A daycare's past is a record of what happened, and
 * adding a day-part today is not a claim about March. The visible hole this
 * leaves is the truth, and it is behind the trainer rather than in front of
 * them, which is the direction Karl's rule cares about ("it should never look
 * like it stops").
 *
 * Anchoring on the calendar DAY rather than the instant is what keeps the
 * cadence right: `planSlotSessions` rolls the anchor forward to the slot's
 * weekday, so a Wednesday part added on a Monday starts this Wednesday. Sessions
 * that land earlier today are then dropped by the caller's own cutoff, because a
 * morning part added at lunchtime did not run this morning.
 */
function anchorForNewSlot(slot: ScheduleSlot, tz: string, now: Date): Date {
  const today = dateOnlyUtc(utcToZonedDateAndMinutes(now, tz).dateStr)
  if (slot.startDate && slot.startDate.getTime() > today.getTime()) return slot.startDate
  return today
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
