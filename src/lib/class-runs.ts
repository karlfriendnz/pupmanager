// Group-class engine. A group Package is a sellable template; a ClassRun
// is one scheduled cohort off it that owns ONE shared TrainingSession
// series (sessions have classRunId set, clientId null). Clients join via
// ClassEnrollment. Capacity, waitlist and drop-in pricing live here so
// the rules are in one place and the pure parts are unit-tested.
//
// The 1:1 ClientPackage path is entirely separate and untouched.
import { randomUUID } from 'crypto'
import { prisma } from './prisma'
import type { Prisma, PrismaClient } from '@/generated/prisma'
import { effectiveBufferMins, normalizeBufferMins } from './buffer'
import { expandRule, rollForwardToWeekday, OPEN_ENDED_OCCURRENCES } from './recurrence'
import { zonedToUtc } from './timezone'

// Re-exported so server code can keep importing it from here; the flag
// itself lives in the client-safe feature-flags module.
export { PUBLIC_CLASS_ENROLLMENT_ENABLED } from './feature-flags'

// ─── Pure logic (no DB — unit-tested in tests/unit/class-runs.test.ts) ───────

/**
 * The shared session schedule for a run: `sessionCount` dates starting at
 * `startDate`, `weeksBetween` apart. sessionCount === 0 (ongoing package)
 * yields a single seed session — ongoing group classes top up elsewhere.
 *
 * A cadence of 0 weeks used to be taken literally: six sessions all landed on
 * `startDate`, and `createClassRunIn` wrote six TrainingSession rows at the
 * same instant. The schedule grid positions every block off its own
 * `scheduledAt` and labels it with the RUN's name, so those six stacked
 * pixel-perfectly and read as one class drawn over and over — the "classes are
 * duplicating" report. Nothing in the product means "several sessions at once",
 * and the packages API still accepts weeksBetween 0 (it's meaningful for a
 * one-off and for an ongoing package), so the floor belongs here, at the one
 * place every caller goes through.
 */
export function generateSessionDates(
  startDate: Date,
  sessionCount: number,
  weeksBetween: number,
): Date[] {
  const n = sessionCount > 0 ? sessionCount : 1
  // Only a multi-session run needs a gap; a single session has nothing to space.
  const gap = n > 1 ? Math.max(1, weeksBetween) : Math.max(0, weeksBetween)
  const out: Date[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i * gap * 7)
    out.push(d)
  }
  return out
}

// Re-exported so server code can keep importing them from here; the run-kind
// predicates themselves live in the client-safe run-kind module, because the
// schedule grid (a client component) routes with them too and can't pull this
// file's prisma import across the boundary.
export { EVENT_PACKAGE, NON_EVENT_PACKAGE, isEventPackage } from './run-kind'

// ─── Drop-in schedule slots ──────────────────────────────────────────────────

/** The parts of a PackageSessionSlot the scheduler needs. Structural, so both
 *  a DB row and a plain object from the API layer satisfy it. */
export type ScheduleSlot = {
  id: string
  order: number
  startDate: Date | null
  day: number
  startTime: string
  endTime: string
  gapMins: number
  recurrenceRule: string | null
  assignedMembershipIds: string[]
}

/** One session a slot will produce, ready to be written as a TrainingSession. */
export type PlannedSession = {
  slotId: string
  scheduledAt: Date
  durationMins: number
  bufferMins: number
  assignedMembershipId: string | null
}

/** Minutes from "HH:mm" to "HH:mm". An end at or before the start is read as
 *  running past midnight (a 21:00–00:30 night class), never as zero/negative. */
export function slotDurationMins(startTime: string, endTime: string): number {
  const mins = (t: string) => {
    const [h, m] = (t || '').split(':').map(Number)
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
  }
  const start = mins(startTime)
  const end = mins(endTime)
  const raw = end - start
  return raw > 0 ? raw : raw + 24 * 60
}

/**
 * Every session a drop-in class's slots produce, in chronological order.
 *
 * Each slot contributes its own series: the first occurrence is its startDate
 * (or the run's) rolled forward to its weekday, then its recurrenceRule repeats
 * from there. Times are wall-clock in the trainer's timezone — a class meets at
 * 3pm whether or not the clocks have changed.
 *
 * Pure (given a tz): unit-tested in tests/unit/class-runs.test.ts.
 */
export function planSlotSessions(
  slots: ScheduleSlot[],
  opts: { runStart: Date; tz: string; maxPerSlot?: number },
): PlannedSession[] {
  const max = opts.maxPerSlot ?? OPEN_ENDED_OCCURRENCES
  const out: PlannedSession[] = []

  for (const slot of [...slots].sort((a, b) => a.order - b.order)) {
    const anchor = rollForwardToWeekday(slot.startDate ?? opts.runStart, slot.day)
    const duration = slotDurationMins(slot.startTime, slot.endTime)
    const [h, m] = (slot.startTime || '00:00').split(':').map(Number)
    for (const d of expandRule(slot.recurrenceRule ?? '', anchor, max)) {
      out.push({
        slotId: slot.id,
        scheduledAt: zonedToUtc(
          d.getFullYear(), d.getMonth() + 1, d.getDate(),
          Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0,
          opts.tz,
        ),
        durationMins: duration,
        bufferMins: normalizeBufferMins(slot.gapMins),
        // One session has one assigned trainer; extra names on the slot are
        // co-runners we don't model yet, so the first is the owner.
        assignedMembershipId: slot.assignedMembershipIds[0] ?? null,
      })
    }
  }

  return out.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
}

/**
 * What ONE session of a drop-in costs: the slot's own special price, then its
 * price, falling back to the package's flat drop-in rate for classic group
 * classes that just tick "allow drop-ins" and have no slots.
 */
export function sessionDropInPriceCents(
  slot: { priceCents: number | null; specialPriceCents: number | null } | null | undefined,
  pkg: { dropInPriceCents: number | null | undefined },
): number | null {
  if (slot) {
    if (typeof slot.specialPriceCents === 'number') return slot.specialPriceCents
    if (typeof slot.priceCents === 'number') return slot.priceCents
  }
  return dropInPriceCents({ dropInPriceCents: pkg.dropInPriceCents })
}

/**
 * What the WHOLE run costs when the offering is only priced per session.
 *
 * A casual class has no course price — the trainer sets a price on each session
 * row — so a full-run seat is the sum of those, slot by slot, because each
 * session is free to cost something different. Falls back to the package-level
 * per-session price for a slot that doesn't carry its own.
 *
 * Returns null when nothing anywhere has a price, so a genuinely free class
 * still charges nothing rather than raising a £0 invoice.
 *
 * Lives here, beside sessionDropInPriceCents, because BOTH ways of paying for a
 * full run have to agree on the figure: the receivable the trainer raises
 * (invoicing.ts) and the card checkout a client goes through when they enrol
 * themselves. It used to exist only on the invoicing side, so the same six-week
 * casual class was billed £180 on an invoice and charged £30 at the checkout.
 */
export function wholeRunFromSessions(pkg: {
  dropInPriceCents: number | null
  sessionSlots: { priceCents: number | null; specialPriceCents: number | null }[]
}): number | null {
  if (pkg.sessionSlots.length === 0) return pkg.dropInPriceCents
  let total = 0
  let priced = false
  for (const slot of pkg.sessionSlots) {
    const each = sessionDropInPriceCents(slot, pkg)
    if (each == null) continue
    total += each
    priced = true
  }
  return priced ? total : null
}

/**
 * What a FULL seat on a per-session-priced class actually costs: every session
 * the run holds, each at its own price.
 *
 * This has to read the RUN's sessions, not the package's slots, because those
 * are two different things and only one of them is the answer:
 *
 *   • A slot is a RECURRING TEMPLATE ("Saturdays 10am"), not a session. Two
 *     slots running for six weeks are twelve sessions. Summing the slots gives
 *     the price of one week of the timetable.
 *   • A classic casual class — "allow drop-ins" ticked, no slot schedule at
 *     all — has zero slots, so summing them gives one session's drop-in rate.
 *
 * wholeRunFromSessions does exactly those two wrong things (it was written
 * against the package alone, which cannot see how many sessions a run has), and
 * that is why a six-week class carried on invoicing at £30 after the fix that
 * was supposed to make it £180. Sessions are the unit a trainer means by "the
 * whole run", so sessions are what we count.
 *
 * Null when nothing anywhere carries a price — a free class raises no invoice
 * rather than a £0 one.
 */
export async function wholeRunPriceCents(
  classRunId: string,
  pkg: { dropInPriceCents: number | null },
  tx: Tx = prisma,
): Promise<number | null> {
  const sessions = await tx.trainingSession.findMany({
    where: { classRunId },
    select: { packageSessionSlot: { select: { priceCents: true, specialPriceCents: true } } },
  })
  if (sessions.length === 0) return pkg.dropInPriceCents
  let total = 0
  let priced = false
  for (const s of sessions) {
    const each = sessionDropInPriceCents(s.packageSessionSlot, pkg)
    if (each == null) continue
    total += each
    priced = true
  }
  return priced ? total : null
}

/**
 * How many people fit in ONE session: its slot's capacity when the slot sets
 * one, else the run/package capacity. Lets a class cap Saturdays at 6 and
 * Tuesdays at 12.
 */
export function sessionCapacity(
  slot: { capacity: number | null } | null | undefined,
  runCapacity: number | null | undefined,
  packageCapacity: number | null | undefined,
): number | null {
  if (slot && typeof slot.capacity === 'number') return slot.capacity
  return effectiveCapacity(runCapacity, packageCapacity)
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
 *
 * `seats` is how many places the booking takes — 1 for a class seat, but an
 * event ticket can be bought several at a time ("2 × General"), and two of the
 * three remaining places is a fit while four is not.
 */
export function decideEnrollment(args: {
  capacity: number | null
  enrolledCount: number
  allowWaitlist: boolean
  seats?: number
}): EnrollDecision {
  const seats = Math.max(1, args.seats ?? 1)
  const left = seatsRemaining(args.capacity, args.enrolledCount)
  if (left === null || left >= seats) return 'ENROLLED'
  return args.allowWaitlist ? 'WAITLISTED' : 'REJECTED_FULL'
}

/** The most tickets one enrolment can hold. High enough for a family or a
 *  workplace group, low enough that a fat-fingered "100" is caught. */
export const MAX_TICKET_QUANTITY = 20

/** Coerce a submitted ticket quantity into 1…MAX_TICKET_QUANTITY. Anything
 *  missing, fractional or out of range lands on a sane whole number rather
 *  than billing a client for 0 (or 10,000) places. */
export function normalizeTicketQuantity(value: unknown): number {
  const n = typeof value === 'number' ? Math.trunc(value) : NaN
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(n, MAX_TICKET_QUANTITY))
}

/** One line of a ticket basket: how many of one ticket type. */
export type TicketSelection = { ticketTierId: string; quantity: number }

/**
 * Tidy a submitted basket ("3 General, 0 Other, 3 VIP") into the lines that are
 * actually being bought.
 *
 * - A quantity of 0 (or negative, or fractional-down-to-nothing) is NOT a
 *   purchase — it's a stepper the trainer left alone — so it's dropped rather
 *   than written as an empty enrolment row.
 * - The same ticket type twice is added up, never two rows for one type.
 * - Each surviving line is clamped to 1…MAX_TICKET_QUANTITY, same as the
 *   single-ticket path.
 *
 * Pure — the tier ids are NOT validated here; enrollInRunTickets does that
 * against the run's own offering.
 */
export function normalizeTicketBasket(lines: TicketSelection[] | null | undefined): TicketSelection[] {
  const merged = new Map<string, number>()
  for (const line of lines ?? []) {
    if (!line || typeof line.ticketTierId !== 'string' || line.ticketTierId.length === 0) continue
    const n = typeof line.quantity === 'number' ? Math.trunc(line.quantity) : NaN
    if (!Number.isFinite(n) || n <= 0) continue
    merged.set(line.ticketTierId, (merged.get(line.ticketTierId) ?? 0) + n)
  }
  return [...merged.entries()].map(([ticketTierId, quantity]) => ({
    ticketTierId,
    quantity: Math.min(quantity, MAX_TICKET_QUANTITY),
  }))
}

/** How many places a whole basket takes up in the room — the number that has to
 *  fit the EVENT's capacity, on top of each type fitting its own. */
export function ticketBasketSeats(lines: TicketSelection[]): number {
  return lines.reduce((n, l) => n + Math.max(0, l.quantity), 0)
}

/**
 * What a basket costs, priced line by line off each ticket type's OWN price.
 * Never the offering's flat price — charging that for a ticket is the live bug
 * fixed in d736544 ($45 taken for a $200 ticket).
 */
export function ticketBasketTotalCents(
  lines: TicketSelection[],
  tiers: { id: string; priceCents: number | null }[],
): number {
  const priceOf = new Map(tiers.map(t => [t.id, t.priceCents ?? 0]))
  return lines.reduce((sum, l) => sum + (priceOf.get(l.ticketTierId) ?? 0) * Math.max(0, l.quantity), 0)
}

/**
 * Price for a single-session DROP_IN: the flat per-session drop-in rate for
 * the one session they're attending. Returns null when the package has no
 * drop-in price set.
 *
 * (Was "per-session × remaining sessions" under the old late-joiner model; a
 * drop-in is now one session, sold one at a time.)
 */
export function dropInPriceCents(args: {
  dropInPriceCents: number | null | undefined
}): number | null {
  return typeof args.dropInPriceCents === 'number' ? args.dropInPriceCents : null
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

/** Count of FULL-course seats that consume the run's capacity (ENROLLED only).
 * Drop-ins don't take a course seat — they take a single session's seat, so
 * they're counted per-session by sessionAttendeeCount, not here.
 *
 * Sums `quantity`, not rows: one event enrolment can hold several tickets, and
 * counting it as a single place would oversell the room. Every other enrolment
 * has quantity 1, so this is the old count for classes. */
export async function enrolledCount(classRunId: string, tx: Tx = prisma): Promise<number> {
  const agg = await tx.classEnrollment.aggregate({
    where: { classRunId, status: 'ENROLLED', type: 'FULL' },
    _sum: { quantity: true },
  })
  return agg._sum?.quantity ?? 0
}

/** How many people are in the room for ONE session: every FULL enrolment (they
 * attend all sessions) plus the drop-ins booked onto exactly this session.
 * This is the number a drop-in's capacity check must respect — a course that's
 * "full" for the whole term can still have a spare seat in a given week.
 * Sums `quantity` for the same reason as enrolledCount. */
export async function sessionAttendeeCount(
  classRunId: string,
  sessionId: string,
  tx: Tx = prisma,
): Promise<number> {
  const agg = await tx.classEnrollment.aggregate({
    where: {
      classRunId,
      status: 'ENROLLED',
      OR: [{ type: 'FULL' }, { type: 'DROP_IN', dropInSessionId: sessionId }],
    },
    _sum: { quantity: true },
  })
  return agg._sum?.quantity ?? 0
}

/** Per-session spaces for a run, computed once from its live enrolments — the
 * single source of truth both the client wizard and the trainer assign modal
 * read, so "spaces left this session" can never drift between the two views.
 * capacity null = unlimited (spacesLeftFor returns null).
 *
 * Pure: hand it the enrolments you've already loaded; no DB round-trip. */
export function classSessionSpaces(
  capacity: number | null,
  /** `quantity` is how many places the booking holds (an event ticket can be
   *  several); omit it and each enrolment counts as one, as it always has. */
  enrolments: { type: 'FULL' | 'DROP_IN'; dropInSessionId: string | null; quantity?: number }[],
): {
  fullSeats: number
  /** Spaces left in one session. `sessionCap` overrides the run capacity for
   *  sessions whose drop-in slot sets its own (Saturdays 6, Tuesdays 12);
   *  omit it to use the run/package capacity. */
  spacesLeftFor: (sessionId: string, sessionCap?: number | null) => number | null
} {
  const seats = (e: { quantity?: number }) => Math.max(1, e.quantity ?? 1)
  const fullSeats = enrolments.filter(e => e.type === 'FULL').reduce((n, e) => n + seats(e), 0)
  const dropInsBySession = new Map<string, number>()
  for (const e of enrolments) {
    if (e.type === 'DROP_IN' && e.dropInSessionId) {
      dropInsBySession.set(e.dropInSessionId, (dropInsBySession.get(e.dropInSessionId) ?? 0) + seats(e))
    }
  }
  return {
    fullSeats,
    spacesLeftFor: (sessionId, sessionCap) => {
      const cap = sessionCap === undefined ? capacity : sessionCap
      return cap == null ? null : Math.max(0, cap - fullSeats - (dropInsBySession.get(sessionId) ?? 0))
    },
  }
}

/** The most-attended single session in a run (max headcount across sessions).
 * A FULL enrolment attends every session, so it must fit the busiest one. */
async function busiestSessionHeadcount(classRunId: string, tx: Tx = prisma): Promise<number> {
  // Sums `quantity` rather than counting rows — see enrolledCount.
  const fulls = await tx.classEnrollment.aggregate({
    where: { classRunId, status: 'ENROLLED', type: 'FULL' },
    _sum: { quantity: true },
  })
  const perSession = await tx.classEnrollment.groupBy({
    by: ['dropInSessionId'],
    where: { classRunId, status: 'ENROLLED', type: 'DROP_IN', dropInSessionId: { not: null } },
    _sum: { quantity: true },
  })
  const maxDropIns = perSession.reduce((m, r) => Math.max(m, r._sum?.quantity ?? 0), 0)
  return (fulls._sum?.quantity ?? 0) + maxDropIns
}

export type CreateRunArgs = {
  trainerId: string
  packageId: string
  name: string
  startDate: Date
  scheduleNote?: string | null
  capacity?: number | null
  // Per-run override of the package's "gap before the next session".
  // undefined/null = inherit the package's bufferMins.
  bufferMins?: number | null
  /** Cover image for the run (Vercel Blob URL). */
  imageUrl?: string | null
  /** Where the class meets. Copied onto every generated session. */
  location?: string | null
  /** TrainerMembership ids (of this company) running this class. */
  assignedMembershipIds?: string[]
  /** Tri-state "require payment to enrol": null = inherit the trainer default. */
  requirePayment?: boolean | null
}

/**
 * Create a ClassRun and its shared session series in one transaction.
 * Sessions carry classRunId + 1-based sessionIndex and no clientId —
 * attendance is per-enrollee via SessionAttendance.
 */
export async function createClassRun(
  args: CreateRunArgs,
): Promise<{ id: string; sessionCount: number; createdSessionIds: string[] }> {
  return prisma.$transaction((tx) => createClassRunIn(tx, args))
}

/**
 * The body of createClassRun, against a caller-supplied client — so a route
 * that has just created the package inside its own transaction can schedule the
 * run in that SAME transaction, instead of committing a package and then
 * possibly failing to give it a run (Prisma has no nested interactive
 * transactions, so the caller must own the outer one).
 */
export async function createClassRunIn(
  tx: Tx,
  args: CreateRunArgs,
): Promise<{ id: string; sessionCount: number; createdSessionIds: string[] }> {
  const pkg = await tx.package.findFirst({
    where: { id: args.packageId, trainerId: args.trainerId, isGroup: true },
    include: {
      sessionSlots: { include: { location: { select: { name: true, address: true } } } },
      trainer: { select: { user: { select: { timezone: true } } } },
    },
  })
  if (!pkg) throw new ClassError('PACKAGE_NOT_FOUND', 'Group package not found')

  const buffer = effectiveBufferMins(args.bufferMins, pkg.bufferMins)

  // A run inherits the offering's venue unless it names its own. An offering
  // can be defined before it's scheduled, and the address the trainer typed
  // then has to survive into the class they schedule off it later. Inheritance
  // is create-time only — nothing here touches a run that already exists.
  const venue = args.location?.trim() || pkg.location?.trim() || null

  // A drop-in class schedules itself from its slots (each with its own day,
  // time, venue and gap); everything else uses the flat N-sessions-every-W-weeks
  // cadence. Both end up as one chronological series on the run.
  const tz = pkg.trainer.user?.timezone || 'Pacific/Auckland'
  const planned = pkg.sessionSlots.length
    ? planSlotSessions(pkg.sessionSlots, { runStart: args.startDate, tz })
    : null
  const rows = planned
    ? planned.map((s) => {
        const slot = pkg.sessionSlots.find((x) => x.id === s.slotId)
        return {
          scheduledAt: s.scheduledAt,
          durationMins: s.durationMins,
          bufferMins: s.bufferMins,
          assignedMembershipId: s.assignedMembershipId,
          packageSessionSlotId: s.slotId,
          location: slot?.location?.address || slot?.location?.name || null,
        }
      })
    : generateSessionDates(args.startDate, pkg.sessionCount, pkg.weeksBetween).map((d) => ({
        scheduledAt: d,
        durationMins: pkg.durationMins,
        bufferMins: buffer,
        assignedMembershipId: null,
        packageSessionSlotId: null,
        // The run's venue, unless a slot named its own above.
        location: venue,
      }))

  const run = await tx.classRun.create({
    data: {
      trainerId: args.trainerId,
      packageId: pkg.id,
      name: args.name,
      scheduleNote: args.scheduleNote?.trim() || null,
      startDate: args.startDate,
      capacity: args.capacity ?? null,
      bufferMins: args.bufferMins ?? null,
      imageUrl: args.imageUrl ?? null,
      location: venue,
      requirePayment: args.requirePayment ?? null,
    },
  })
  await tx.trainingSession.createMany({
    data: rows.map((r, i) => ({
      trainerId: args.trainerId,
      classRunId: run.id,
      sessionIndex: i + 1,
      title:
        rows.length > 1
          ? `${args.name} — session ${i + 1}/${rows.length}`
          : args.name,
      sessionType: pkg.sessionType,
      ...r,
    })),
  })
  await setRunTrainers(run.id, args.trainerId, args.assignedMembershipIds, tx)
  // createMany returns no ids — re-read them (visible inside this tx) so the
  // caller can mirror just these sessions to Google Calendar post-commit.
  const created = await tx.trainingSession.findMany({
    where: { classRunId: run.id },
    select: { id: true },
  })
  return { id: run.id, sessionCount: rows.length, createdSessionIds: created.map((s) => s.id) }
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
  /** Where the class meets. Free text; copied onto every generated session. */
  location?: string | null
  /** What the class actually is. Lives on the backing package (the class has
   *  no description column of its own) and is what the booking email shows. */
  description?: string | null
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
        description: args.description?.trim() || null,
        // The offering keeps the venue too, so a SECOND cohort scheduled off
        // this package later starts at the same place rather than blank.
        location: args.location?.trim() || null,
        sessionCount: count,
        weeksBetween: args.weeksBetween,
        durationMins: args.durationMins,
        bufferMins: buffer,
        sessionType: args.sessionType,
        priceCents: args.priceCents ?? null,
        isGroup: true,
        // A class made here is a CLASS, however few times it meets. Stated
        // rather than left to the column default: this is the path behind the
        // class form's "Doesn't repeat (one-off)" option, which writes
        // sessionCount 1 — the exact shape that used to be read as an event and
        // filed the class away under /events. Session count and offering type
        // are independent now, and this is where that starts.
        isEvent: false,
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
        location: args.location?.trim() || null,
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
        // Sessions carry their own location so one week can move venue without
        // rewriting the class.
        location: args.location?.trim() || null,
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
 * Keep a scheduled offering's run in step when the offering itself is edited.
 *
 * Only when the package has exactly ONE run. The offerings form and the class
 * are the same thing to a trainer who created it through the wizard, so editing
 * the venue there must move the class. A package with several cohorts is a
 * different story — the form can't say which one you meant — so those are left
 * alone and managed per-run on /classes/[runId].
 *
 * Covers presentation (name, note, venue, cover, staff) AND the schedule
 * (start, how many, how far apart). A schedule change rebuilds the session
 * series, and is refused outright once attendance has been recorded — we never
 * silently delete a session someone was marked present at.
 *
 * Returns the run it touched — with the ids the caller needs to mirror to
 * Google Calendar — or null when it deliberately did nothing.
 */
export async function syncOfferingRun(
  tx: Tx,
  packageId: string,
  trainerId: string,
  fields: {
    name?: string
    scheduleNote?: string | null
    location?: string | null
    imageUrl?: string | null
    assignedMembershipIds?: string[]
    /** Where the class is up to — SCHEDULED / RUNNING / COMPLETED / CANCELLED. */
    status?: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
    /**
     * How many fit. The run's own capacity OVERRIDES the package's everywhere
     * seats are counted (see effectiveCapacity), so writing the new number to
     * the package alone left the class still enforcing the old one — the
     * trainer changed the cap, saved, and nothing moved. Undefined leaves the
     * run's value alone.
     */
    capacity?: number | null
    /** Schedule. Provide all three to move the series; omit to leave it be. */
    startDate?: Date
    sessionCount?: number
    weeksBetween?: number
    /**
     * What the package held BEFORE this save. Required to tell a real change
     * from a no-op, because the only caller updates the package row inside the
     * same transaction and THEN calls this — so re-reading the package here
     * returns the new value and every comparison is the new value against
     * itself. That is exactly what happened: a trainer changed the number of
     * sessions, saved, and the class kept the sessions it already had, with no
     * error. Omit only when the package has not been written yet.
     */
    prev?: { sessionCount?: number | null; weeksBetween?: number | null }
    /**
     * Drop exactly these sessions and leave every other one alone.
     *
     * Shrinking a class used to go through the cadence rebuild below, which
     * deletes the whole series and regenerates it — so the trainer got no say
     * in WHICH sessions went (always the last ones), every surviving session
     * got a new id, and anything hanging off those rows went with them. When
     * the caller names the sessions, remove just those: the rest keep their
     * ids, their bookings and their attendance.
     */
    removeSessionIds?: string[]
    durationMins?: number
    bufferMins?: number
    sessionType?: 'IN_PERSON' | 'VIRTUAL'
  },
): Promise<{ id: string; createdSessionIds: string[]; deletedEventIds: string[] } | null> {
  const runs = await tx.classRun.findMany({
    where: { packageId, trainerId },
    select: {
      id: true, name: true, location: true, startDate: true, bufferMins: true,
      package: { select: { sessionCount: true, weeksBetween: true, durationMins: true, bufferMins: true, sessionType: true } },
      sessions: { select: { id: true, sessionIndex: true, googleCalendarEventId: true, packageSessionSlotId: true } },
    },
  })
  if (runs.length !== 1) return null
  const run = runs[0]

  const nameChanged = fields.name !== undefined && fields.name !== run.name
  const venueChanged = fields.location !== undefined && (fields.location?.trim() || null) !== run.location

  // A drop-in class's series comes from its slots, not from this cadence — its
  // rebuild belongs to the slot editor, so leave those runs' sessions alone.
  const isSlotScheduled = run.sessions.some(s => s.packageSessionSlotId)
  // Compare against what the package held BEFORE the save when the caller
  // tells us (see `prev`), falling back to the stored row otherwise. The run's
  // own startDate is safe to read either way — nothing writes it before us.
  const prevSessionCount = fields.prev ? fields.prev.sessionCount : run.package.sessionCount
  const prevWeeksBetween = fields.prev ? fields.prev.weeksBetween : run.package.weeksBetween
  // NB deliberately NOT "does the count disagree with the actual sessions?".
  // Classes exist whose package says 11 while the run holds 6 (saves made while
  // the read-after-write bug was live), and healing those on any save is
  // tempting — but a session can be deleted on purpose from the schedule
  // (api/schedule/[sessionId]), so a disagreement is legitimate state, and
  // rebuilding on it would resurrect a session the trainer had removed the next
  // time they renamed the class. Repairing the drifted ones is a one-off job,
  // not a rule.
  // Naming the sessions to drop replaces the rebuild — the two cannot both run,
  // or the rebuild would regenerate a tidy series and undo the choice.
  const removing = (fields.removeSessionIds?.length ?? 0) > 0
  const scheduleChanged =
    !isSlotScheduled && !removing &&
    ((fields.startDate !== undefined && fields.startDate.getTime() !== run.startDate.getTime()) ||
      (fields.sessionCount !== undefined && fields.sessionCount !== prevSessionCount) ||
      (fields.weeksBetween !== undefined && fields.weeksBetween !== prevWeeksBetween))

  if (scheduleChanged) {
    // Never move sessions people have already been marked present at — the
    // rebuild deletes the old series, and that would take the register with it.
    const attended = await tx.sessionAttendance.count({ where: { session: { classRunId: run.id } } })
    if (attended > 0) {
      throw new ClassError(
        'HAS_ATTENDANCE',
        "Can't change the dates of a class that already has attendance recorded. Change the other details, or cancel this class and create a new one.",
      )
    }
  }

  await tx.classRun.update({
    where: { id: run.id },
    data: {
      ...(nameChanged && { name: fields.name }),
      ...(fields.scheduleNote !== undefined && { scheduleNote: fields.scheduleNote?.trim() || null }),
      ...(fields.location !== undefined && { location: fields.location?.trim() || null }),
      ...(fields.imageUrl !== undefined && { imageUrl: fields.imageUrl }),
      ...(fields.status !== undefined && { status: fields.status }),
      ...(fields.capacity !== undefined && { capacity: fields.capacity }),
      ...(scheduleChanged && fields.startDate && { startDate: fields.startDate }),
    },
  })

  let createdSessionIds: string[] = []
  let deletedEventIds: string[] = []

  // Drop the named sessions, keep the rest exactly as they are. Scoped to this
  // run so a stale or hostile id from another class can never delete anything
  // here, and to sessions that actually exist so the renumber below is honest.
  if (removing) {
    const doomed = run.sessions.filter(s => fields.removeSessionIds!.includes(s.id))
    if (doomed.length > 0) {
      // Same rule the rebuild follows, applied per session rather than per run:
      // deleting a session takes its register with it. Removing OTHER sessions
      // from a class that has attendance somewhere is fine — that's the point of
      // naming them — but never the ones people were marked present at.
      const attended = await tx.sessionAttendance.count({
        where: { sessionId: { in: doomed.map(s => s.id) } },
      })
      if (attended > 0) {
        throw new ClassError(
          'HAS_ATTENDANCE',
          "One of the sessions you're removing has attendance recorded against it. Removing it would delete that register — pick a different session, or cancel this class and start a new one.",
        )
      }

      deletedEventIds = doomed.map(s => s.googleCalendarEventId).filter((id): id is string => !!id)
      await tx.trainingSession.deleteMany({
        where: { id: { in: doomed.map(s => s.id) }, classRunId: run.id },
      })

      // Renumber what's left. sessionIndex drives "session 3 of 6" on the
      // roster and in every session title, so leaving gaps would show a class
      // running sessions 1, 2, 5 of 6.
      const kept = run.sessions
        .filter(s => !fields.removeSessionIds!.includes(s.id))
        .sort((a, b) => (a.sessionIndex ?? 0) - (b.sessionIndex ?? 0))
      const name = fields.name ?? run.name
      for (let i = 0; i < kept.length; i++) {
        await tx.trainingSession.update({
          where: { id: kept[i].id },
          data: {
            sessionIndex: i + 1,
            title: kept.length > 1 ? `${name} — session ${i + 1}/${kept.length}` : name,
          },
        })
      }
    }
  }

  if (scheduleChanged) {
    // Capture the mirrored Google events before the rows go, so the caller can
    // remove them from the calendar after the transaction commits.
    deletedEventIds = run.sessions.map(s => s.googleCalendarEventId).filter((id): id is string => !!id)

    const name = fields.name ?? run.name
    const count = fields.sessionCount ?? run.package.sessionCount
    const weeks = fields.weeksBetween ?? run.package.weeksBetween
    const duration = fields.durationMins ?? run.package.durationMins
    const buffer = effectiveBufferMins(fields.bufferMins, run.package.bufferMins)
    const venue = fields.location !== undefined ? (fields.location?.trim() || null) : run.location

    await tx.trainingSession.deleteMany({ where: { classRunId: run.id } })
    const dates = generateSessionDates(fields.startDate ?? run.startDate, count, weeks)
    await tx.trainingSession.createMany({
      data: dates.map((d, i) => ({
        trainerId,
        classRunId: run.id,
        sessionIndex: i + 1,
        title: dates.length > 1 ? `${name} — session ${i + 1}/${dates.length}` : name,
        scheduledAt: d,
        durationMins: duration,
        bufferMins: buffer,
        sessionType: fields.sessionType ?? run.package.sessionType,
        location: venue,
      })),
    })
    const created = await tx.trainingSession.findMany({
      where: { classRunId: run.id },
      select: { id: true },
    })
    createdSessionIds = created.map(s => s.id)
  }

  // A rebuild already wrote the venue and the titles onto the fresh sessions.
  if (venueChanged && !scheduleChanged) {
    // Sessions carry their own venue. Move the ones still to come; sessions
    // that have already happened keep the address they were actually held at,
    // and a drop-in slot's sessions keep the venue their slot named.
    await tx.trainingSession.updateMany({
      where: {
        classRunId: run.id,
        packageSessionSlotId: null,
        scheduledAt: { gte: new Date() },
      },
      data: { location: fields.location?.trim() || null },
    })
  }

  if (nameChanged && !scheduleChanged) {
    // Session titles are built from the class name ("Puppy — session 2/6").
    const sessions = await tx.trainingSession.findMany({
      where: { classRunId: run.id },
      select: { id: true, sessionIndex: true },
      orderBy: { scheduledAt: 'asc' },
    })
    for (const s of sessions) {
      await tx.trainingSession.update({
        where: { id: s.id },
        data: {
          title: sessions.length > 1
            ? `${fields.name} — session ${s.sessionIndex ?? 1}/${sessions.length}`
            : fields.name!,
        },
      })
    }
  }

  await setRunTrainers(run.id, trainerId, fields.assignedMembershipIds, tx)
  return { id: run.id, createdSessionIds, deletedEventIds }
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
  location?: string | null
  description?: string | null
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
        ...(args.description !== undefined && { description: args.description?.trim() || null }),
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
        ...(args.location !== undefined && { location: args.location?.trim() || null }),
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
 * enrols can't both take the last seat.
 *
 * FULL takes a course seat and attends every session, so it's checked against
 * the busiest session's headcount. DROP_IN is for ONE session (dropInSessionId,
 * required): it's checked against just that session's headcount, so a term
 * that's "full" can still take a drop-in where a week has room.
 */
export async function enrollInRun(args: {
  classRunId: string
  clientId: string
  dogId?: string | null
  type?: 'FULL' | 'DROP_IN'
  /** Required when type is DROP_IN: the one session they're dropping into. */
  sessionId?: string | null
  /**
   * Which ticket type they're buying, for an event that sells several. Must be
   * one of the run's own offering's tiers — validated here, never trusted from
   * the caller. Null/omitted keeps the old behaviour: price off the package.
   */
  ticketTierId?: string | null
  /** How many of that ticket. Clamped to 1…MAX_TICKET_QUANTITY. */
  quantity?: number | null
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

    // A drop-in is one specific, still-to-come session of this run.
    let dropInSessionId: string | null = null
    let joinedAtIndex: number | null = null
    // The chosen session's slot, when it came from a drop-in schedule — it caps
    // that session on its own (Saturdays 6, Tuesdays 12).
    let slotCapacity: { capacity: number | null } | null = null
    if (type === 'DROP_IN') {
      // A daycare's product IS the single day: booking one Wednesday is the
      // normal thing, not an exception a trainer has to opt into. The setup form
      // sets allowDropIn on new ones, but every daycare created before that
      // would otherwise refuse the only kind of booking it takes.
      if (!run.package.allowDropIn && !run.package.isPuppySchool) {
        throw new ClassError('NO_DROP_IN', 'This class does not allow drop-ins')
      }
      if (!args.sessionId) {
        throw new ClassError('NO_SESSION', 'Pick which session to drop into')
      }
      const sess = await tx.trainingSession.findFirst({
        where: { id: args.sessionId, classRunId: args.classRunId },
        select: {
          id: true, sessionIndex: true, scheduledAt: true, status: true,
          packageSessionSlot: { select: { capacity: true } },
        },
      })
      if (!sess) throw new ClassError('SESSION_NOT_FOUND', 'That session isn’t part of this class')
      if (sess.status !== 'UPCOMING' || sess.scheduledAt.getTime() <= Date.now()) {
        throw new ClassError('SESSION_PAST', 'That session has already happened')
      }
      dropInSessionId = sess.id
      joinedAtIndex = sess.sessionIndex
      slotCapacity = sess.packageSessionSlot
    }

    // Re-enrolling after withdrawal reuses the row; a live enrolment is a
    // conflict. What counts as "the same enrolment" differs by type: a FULL
    // enrolment is one per client+dog for the whole run, while a drop-in is
    // per session — the same client can drop into several sessions of the run,
    // so only a live row for THAT session clashes.
    //
    // findFirst, not findUnique: the @@unique includes nullable columns, and
    // SQL NULLs aren't equal — Prisma's compound-unique selector can't express
    // "dogId IS NULL". A plain equality where handles both cases.
    const mine = {
      classRunId: args.classRunId,
      clientId: args.clientId,
      dogId: args.dogId ?? null,
    }
    const existing = await tx.classEnrollment.findFirst({
      where: { ...mine, dropInSessionId },
    })
    if (existing && existing.status !== 'WITHDRAWN') {
      throw new ClassError(
        'ALREADY_ENROLLED',
        type === 'DROP_IN' ? 'Already booked into that session' : 'Already enrolled in this class',
      )
    }
    // A FULL enrolment already puts them in every session, so a drop-in on top
    // of it would double-book and double-bill them.
    if (type === 'DROP_IN') {
      const full = await tx.classEnrollment.findFirst({
        where: { ...mine, dropInSessionId: null, status: { not: 'WITHDRAWN' } },
      })
      if (full) {
        throw new ClassError('ALREADY_ENROLLED', 'They’re already enrolled in the whole class')
      }
    }
    // …and the same the other way round: taking the whole run while they hold
    // drop-in bookings would bill those sessions twice.
    if (type === 'FULL') {
      const drops = await tx.classEnrollment.count({
        where: { ...mine, dropInSessionId: { not: null }, status: { not: 'WITHDRAWN' } },
      })
      if (drops > 0) {
        throw new ClassError(
          'ALREADY_ENROLLED',
          'They already have drop-in sessions booked — withdraw those first.',
        )
      }
    }

    // Which ticket type, and how many. An event sells several ("Early bird",
    // "General"), and the chosen one — not the package's flat price — is what
    // gets invoiced. Scoped to THIS run's offering: a tier id alone must never
    // let anyone bill against another package's (or another trainer's) ticket.
    const quantity = normalizeTicketQuantity(args.quantity ?? 1)
    let ticketTierId: string | null = null
    if (args.ticketTierId) {
      const tier = await tx.packageTicketTier.findFirst({
        where: { id: args.ticketTierId, packageId: run.packageId },
        select: { id: true, name: true, capacity: true },
      })
      if (!tier) throw new ClassError('TICKET_NOT_FOUND', 'That ticket type isn’t part of this event')
      ticketTierId = tier.id
      // A ticket type can cap itself ("Early bird ×20") independently of the
      // event's overall capacity, so it's checked on its own.
      if (tier.capacity != null) {
        const sold = await tx.classEnrollment.aggregate({
          where: {
            classRunId: args.classRunId,
            ticketTierId: tier.id,
            status: 'ENROLLED',
            ...(existing ? { id: { not: existing.id } } : {}),
          },
          _sum: { quantity: true },
        })
        const left = Math.max(0, tier.capacity - (sold._sum?.quantity ?? 0))
        if (quantity > left) {
          throw new ClassError(
            'TICKET_FULL',
            left === 0
              ? `${tier.name} tickets are sold out`
              : `Only ${left} ${tier.name} ticket${left === 1 ? '' : 's'} left`,
          )
        }
      }
    }

    // Capacity is per-session. FULL must fit the busiest session (it's in every
    // one); a drop-in only has to fit its single chosen session.
    const headcount =
      type === 'DROP_IN'
        ? await sessionAttendeeCount(args.classRunId, dropInSessionId!, tx)
        : await busiestSessionHeadcount(args.classRunId, tx)
    const capacity =
      type === 'DROP_IN'
        ? sessionCapacity(slotCapacity, run.capacity, run.package.capacity)
        : effectiveCapacity(run.capacity, run.package.capacity)
    const decision = decideEnrollment({
      capacity,
      enrolledCount: headcount,
      allowWaitlist: run.package.allowWaitlist,
      seats: quantity,
    })
    if (decision === 'REJECTED_FULL') {
      throw new ClassError('FULL', type === 'DROP_IN' ? 'That session is full' : 'This class is full')
    }

    let waitlistPosition: number | null = null
    if (decision === 'WAITLISTED') {
      const last = await tx.classEnrollment.aggregate({
        where: { classRunId: args.classRunId, status: 'WAITLISTED' },
        _max: { waitlistPosition: true },
      })
      waitlistPosition = (last._max.waitlistPosition ?? 0) + 1
    }

    const data = {
      classRunId: args.classRunId,
      clientId: args.clientId,
      dogId: args.dogId ?? null,
      type,
      status: decision,
      waitlistPosition,
      dropInSessionId,
      joinedAtIndex,
      ticketTierId,
      quantity,
      source: args.source ?? 'TRAINER',
      withdrawnAt: null,
    } as const

    const enrollment = existing
      ? await tx.classEnrollment.update({ where: { id: existing.id }, data })
      : await tx.classEnrollment.create({ data })

    return { enrollmentId: enrollment.id, status: decision as 'ENROLLED' | 'WAITLISTED' }
  })
}

export type TicketEnrolmentLine = {
  enrollmentId: string
  ticketTierId: string
  ticketName: string
  quantity: number
  unitPriceCents: number | null
}

/**
 * Enrol one client into a TICKETED event holding SEVERAL ticket types at once —
 * "3 General and 3 VIP" in a single action.
 *
 * The shape is one ClassEnrollment row per ticket type, tied together by a
 * shared `ticketGroupId`. That is the honest shape, not a convenience:
 *   - each row prices off its OWN tier (a ticketed event is never priced by the
 *     package — that mismatch is the bug fixed in d736544),
 *   - each row is counted against its OWN tier's capacity, and
 *   - the invoice reads a line per ticket type, which is what a customer
 *     expects to see, with the group id keeping it to ONE invoice.
 *
 * ALL OR NOTHING. Every tier is validated and every capacity checked before a
 * single row is written, and the whole thing runs in one transaction — a basket
 * that half-books while the client has been charged is the worst outcome
 * available here, so a tier without room refuses the lot.
 *
 * Deliberately a SEPARATE function from enrollInRun rather than a rewrite of
 * it: the single-ticket path (including the client's own self-booking route)
 * still goes through enrollInRun, unchanged.
 */
export async function enrollInRunTickets(args: {
  classRunId: string
  clientId: string
  dogId?: string | null
  /** What they're buying. Zero-quantity lines are ignored; an empty basket is
   *  refused rather than silently enrolling them into nothing. */
  tickets: TicketSelection[]
  source?: 'TRAINER' | 'SELF_SERVE'
}): Promise<{
  groupId: string
  status: 'ENROLLED' | 'WAITLISTED'
  lines: TicketEnrolmentLine[]
  totalCents: number
}> {
  const basket = normalizeTicketBasket(args.tickets)
  if (basket.length === 0) {
    throw new ClassError('NO_TICKETS', 'Choose at least one ticket.')
  }

  return prisma.$transaction(async (tx) => {
    const run = await tx.classRun.findUnique({
      where: { id: args.classRunId },
      include: { package: true },
    })
    if (!run) throw new ClassError('RUN_NOT_FOUND', 'Event not found')
    if (run.status === 'CANCELLED' || run.status === 'COMPLETED') {
      throw new ClassError('RUN_CLOSED', 'This event is no longer taking bookings')
    }

    const mine = {
      classRunId: args.classRunId,
      clientId: args.clientId,
      dogId: args.dogId ?? null,
    }

    // Taking tickets while they hold drop-in bookings on the same run would bill
    // those sessions twice — same rule the FULL path has always had.
    const drops = await tx.classEnrollment.count({
      where: { ...mine, dropInSessionId: { not: null }, status: { not: 'WITHDRAWN' } },
    })
    if (drops > 0) {
      throw new ClassError(
        'ALREADY_ENROLLED',
        'They already have drop-in sessions booked — withdraw those first.',
      )
    }

    // Every tier must belong to THIS run's offering. A tier id alone must never
    // be enough to bill against another event's — or another trainer's —
    // ticket, so they're looked up scoped to run.packageId and an id that
    // doesn't come back is rejected outright (not skipped).
    const tiers = await tx.packageTicketTier.findMany({
      where: { id: { in: basket.map(l => l.ticketTierId) }, packageId: run.packageId },
      select: { id: true, name: true, capacity: true, priceCents: true },
    })
    const tierById = new Map(tiers.map(t => [t.id, t]))
    const stranger = basket.find(l => !tierById.has(l.ticketTierId))
    if (stranger) {
      throw new ClassError('TICKET_NOT_FOUND', 'That ticket type isn’t part of this event')
    }

    // What this client already holds on this run, per ticket type. A row for a
    // type in the basket is either reused (it was withdrawn) or a conflict (it's
    // live) — topping up a live holding isn't what this action means. Types NOT
    // in the basket are left completely alone: they're a separate purchase.
    const held = await tx.classEnrollment.findMany({
      where: { ...mine, dropInSessionId: null },
      select: { id: true, ticketTierId: true, status: true, quantity: true },
    })
    const reusable = new Map<string, string>() // tierId -> withdrawn row id
    for (const line of basket) {
      const rows = held.filter(h => h.ticketTierId === line.ticketTierId)
      const live = rows.find(h => h.status !== 'WITHDRAWN')
      if (live) {
        const name = tierById.get(line.ticketTierId)!.name
        throw new ClassError(
          'ALREADY_ENROLLED',
          `They already hold ${name} tickets for this event — withdraw those first to change the number.`,
        )
      }
      const withdrawn = rows.find(h => h.status === 'WITHDRAWN')
      if (withdrawn) reusable.set(line.ticketTierId, withdrawn.id)
    }
    // A pre-ticket holding (no tier at all, priced off the package) is the same
    // person already being in the event — adding tickets on top would double-bill.
    if (held.some(h => h.ticketTierId == null && h.status !== 'WITHDRAWN')) {
      throw new ClassError('ALREADY_ENROLLED', 'They’re already enrolled in this event')
    }

    // Each ticket type caps itself ("Early bird ×20") INDEPENDENTLY of the
    // event's overall capacity, so every line is checked on its own first.
    const reusedIds = [...reusable.values()]
    for (const line of basket) {
      const tier = tierById.get(line.ticketTierId)!
      if (tier.capacity == null) continue
      const sold = await tx.classEnrollment.aggregate({
        where: {
          classRunId: args.classRunId,
          ticketTierId: tier.id,
          status: 'ENROLLED',
          // Belt and braces: the rows we're about to reuse are WITHDRAWN and so
          // already outside this count, but never let a row be weighed against
          // itself — that's how a re-enrolment reports its own seats as taken.
          ...(reusedIds.length > 0 ? { id: { notIn: reusedIds } } : {}),
        },
        _sum: { quantity: true },
      })
      const left = Math.max(0, tier.capacity - (sold._sum?.quantity ?? 0))
      if (line.quantity > left) {
        throw new ClassError(
          'TICKET_FULL',
          left === 0
            ? `${tier.name} tickets are sold out`
            : `Only ${left} ${tier.name} ticket${left === 1 ? '' : 's'} left`,
        )
      }
    }

    // …and the basket as a whole still has to fit the room. Seats already held
    // by the withdrawn rows we're about to reuse aren't in the headcount (it
    // counts ENROLLED only), so this is a clean before-and-after comparison.
    const seats = ticketBasketSeats(basket)
    const headcount = await busiestSessionHeadcount(args.classRunId, tx)
    const capacity = effectiveCapacity(run.capacity, run.package.capacity)
    const decision = decideEnrollment({
      capacity,
      enrolledCount: headcount,
      allowWaitlist: run.package.allowWaitlist,
      seats,
    })
    if (decision === 'REJECTED_FULL') {
      const left = seatsRemaining(capacity, headcount)
      throw new ClassError(
        'FULL',
        left === 0
          ? 'This event is full'
          : `Only ${left} place${left === 1 ? '' : 's'} left in this event — that’s ${seats}.`,
      )
    }

    // One waitlist position for the whole basket: they are one party waiting,
    // not three people at three places in the queue.
    let waitlistPosition: number | null = null
    if (decision === 'WAITLISTED') {
      const last = await tx.classEnrollment.aggregate({
        where: { classRunId: args.classRunId, status: 'WAITLISTED' },
        _max: { waitlistPosition: true },
      })
      waitlistPosition = (last._max.waitlistPosition ?? 0) + 1
    }

    // Everything has passed. Write the rows — one per ticket type, all carrying
    // the same group id so the invoice can bill them as one basket.
    const groupId = randomUUID()
    const lines: TicketEnrolmentLine[] = []
    for (const line of basket) {
      const tier = tierById.get(line.ticketTierId)!
      const data = {
        ...mine,
        type: 'FULL' as const,
        status: decision,
        waitlistPosition,
        dropInSessionId: null,
        joinedAtIndex: null,
        ticketTierId: tier.id,
        quantity: line.quantity,
        ticketGroupId: groupId,
        source: args.source ?? 'TRAINER',
        withdrawnAt: null,
      }
      const reuseId = reusable.get(line.ticketTierId)
      const row = reuseId
        ? await tx.classEnrollment.update({ where: { id: reuseId }, data })
        : await tx.classEnrollment.create({ data })
      lines.push({
        enrollmentId: row.id,
        ticketTierId: tier.id,
        ticketName: tier.name,
        quantity: line.quantity,
        unitPriceCents: tier.priceCents,
      })
    }

    return {
      groupId,
      status: decision as 'ENROLLED' | 'WAITLISTED',
      lines,
      totalCents: ticketBasketTotalCents(basket, tiers),
    }
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
