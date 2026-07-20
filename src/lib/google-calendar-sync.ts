import type {
  GoogleCalendarConnection,
  TrainingSession,
  AvailabilitySlot,
  BlackoutPeriod,
} from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import {
  upsertCalendarEvent,
  deleteCalendarEvent,
  fetchCalendarEvents,
  type CalendarEventInput,
} from '@/lib/google-calendar'

// One-way sync engine (PupManager → each staff member's own Google Calendar) plus
// the busy-import half (Google → PupManager) that powers soft double-booking
// warnings. Every export here is BEST-EFFORT and NON-BLOCKING — a Google failure
// (or the member not being connected) must never break saving a session,
// availability slot or blackout.
//
// Connections are PER STAFF MEMBER (keyed by TrainerMembership), not per company:
//   • A TrainingSession routes to the connection of its assignedMembershipId (the
//     member running it). When unassigned (sole-trainer / owner-run), it falls
//     back to the company OWNER's connection.
//   • Availability slots + blackout periods are company-level (no assigned
//     member), so they route to the company owner's connection.
//   • The add-on itself is billed at the company level, so gating uses companyId.

const BUSY_WINDOW_DAYS = 60

// ─── connection routing ───────────────────────────────────────────────────────

async function ownerMembershipId(companyId: string): Promise<string | null> {
  const owner = await prisma.trainerMembership.findFirst({
    where: { companyId, role: 'OWNER' },
    select: { id: true },
  })
  return owner?.id ?? null
}

/**
 * Resolve which member's Google connection an entity should sync to: the
 * preferred member (the one it's assigned to) if they've connected, else the
 * company owner's connection. Returns null (→ silent no-op) when the add-on is
 * off for the company or nobody relevant has connected.
 */
async function resolveConnection(
  companyId: string,
  preferMembershipId: string | null,
): Promise<GoogleCalendarConnection | null> {
  if (!(await hasAddon(companyId, 'googlecalendar'))) return null

  if (preferMembershipId) {
    const own = await prisma.googleCalendarConnection.findUnique({ where: { membershipId: preferMembershipId } })
    // Defence-in-depth: never write into a connection from another company, even
    // if some caller passed a cross-tenant membership id. Assignment is already
    // validated to the company at the write path; this is the belt-and-braces.
    if (own && own.companyId === companyId) return own
  }

  const ownerId = await ownerMembershipId(companyId)
  if (!ownerId || ownerId === preferMembershipId) return null
  const ownerConn = await prisma.googleCalendarConnection.findUnique({ where: { membershipId: ownerId } })
  return ownerConn && ownerConn.companyId === companyId ? ownerConn : null
}

async function membershipTimeZone(membershipId: string): Promise<string> {
  const membership = await prisma.trainerMembership.findUnique({
    where: { id: membershipId },
    select: { user: { select: { timezone: true } } },
  })
  return membership?.user?.timezone || 'UTC'
}

// ─── date helpers ─────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// "YYYY-MM-DD" from a Date's UTC parts (our @db.Date columns store midnight UTC).
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

// A local (offset-less) "YYYY-MM-DDTHH:MM:00" wall-clock string. Paired with an
// IANA timeZone so Google resolves it in the member's zone.
function localDateTime(d: Date, hh: number, mm: number): string {
  return `${ymd(d)}T${pad2(hh)}:${pad2(mm)}:00`
}

function parseHM(hm: string): [number, number] {
  const [h, m] = hm.split(':').map(Number)
  return [h || 0, m || 0]
}

// dayOfWeek is 1=Mon..7=Sun; JS getUTCDay is 0=Sun..6=Sat.
const BYDAY: Record<number, string> = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA', 7: 'SU' }

function firstOccurrenceOnOrAfter(from: Date, dayOfWeek1to7: number): Date {
  const target = dayOfWeek1to7 % 7 // Sun=7 → 0
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const diff = (target - d.getUTCDay() + 7) % 7
  d.setUTCDate(d.getUTCDate() + diff)
  return d
}

// ─── overlap detection (pure — used by busy warnings) ─────────────────────────

/** Half-open interval overlap: [aStart,aEnd) intersects [bStart,bEnd). */
export function busyOverlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

/** True when [start,end) overlaps ANY of the given busy blocks. */
export function overlapsAnyBusy(
  blocks: { startsAt: Date; endsAt: Date }[],
  start: Date,
  end: Date,
): boolean {
  return blocks.some((b) => busyOverlaps(start, end, b.startsAt, b.endsAt))
}

// ─── event builders ───────────────────────────────────────────────────────────

export function buildSessionEvent(session: TrainingSession): CalendarEventInput {
  const end = new Date(session.scheduledAt)
  end.setMinutes(end.getMinutes() + session.durationMins)
  return {
    summary: session.title,
    description: session.description ?? undefined,
    location: session.location ?? undefined,
    // scheduledAt is an absolute instant → an offset-carrying ISO string is
    // unambiguous; no separate timeZone needed.
    start: { dateTime: session.scheduledAt.toISOString() },
    end: { dateTime: end.toISOString() },
  }
}

// Returns null for a malformed slot (neither recurring weekday nor one-off date).
export function buildAvailabilitySlotEvent(slot: AvailabilitySlot, timeZone: string): CalendarEventInput | null {
  const [sh, sm] = parseHM(slot.startTime)
  const [eh, em] = parseHM(slot.endTime)
  const summary = slot.title?.trim() || 'Available'

  if (slot.dayOfWeek) {
    const anchor = firstOccurrenceOnOrAfter(slot.firstDate ?? new Date(), slot.dayOfWeek)
    const cadence = Math.max(1, slot.cadenceWeeks)
    return {
      summary,
      start: { dateTime: localDateTime(anchor, sh, sm), timeZone },
      end: { dateTime: localDateTime(anchor, eh, em), timeZone },
      recurrence: [`RRULE:FREQ=WEEKLY;INTERVAL=${cadence};BYDAY=${BYDAY[slot.dayOfWeek]}`],
    }
  }

  if (slot.date) {
    return {
      summary,
      start: { dateTime: localDateTime(slot.date, sh, sm), timeZone },
      end: { dateTime: localDateTime(slot.date, eh, em), timeZone },
    }
  }

  return null
}

export function buildBlackoutEvent(blackout: BlackoutPeriod): CalendarEventInput {
  // All-day events use exclusive end dates, so the last blacked-out day + 1.
  const endExclusive = new Date(blackout.endDate)
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
  return {
    summary: blackout.reason?.trim() || 'Unavailable',
    start: { date: ymd(blackout.startDate) },
    end: { date: ymd(endExclusive) },
  }
}

// ─── sessions (1:1 + group classes) ──────────────────────────────────────────

/**
 * Mirror one session to the calendar of the member running it (assignedMembershipId,
 * else the company owner). No-ops when the add-on is off or that member hasn't
 * connected. Never throws.
 */
export async function syncSessionToGoogle(sessionId: string): Promise<void> {
  try {
    const session = await prisma.trainingSession.findUnique({ where: { id: sessionId } })
    if (!session) return
    const connection = await resolveConnection(session.trainerId, session.assignedMembershipId)
    if (!connection) return

    const eventId = await upsertCalendarEvent(connection, session.googleCalendarEventId, buildSessionEvent(session))
    if (eventId && eventId !== session.googleCalendarEventId) {
      await prisma.trainingSession.update({
        where: { id: session.id },
        data: { googleCalendarEventId: eventId },
      })
    }
  } catch (err) {
    console.error('[google-calendar] syncSessionToGoogle failed', sessionId, err)
  }
}

/**
 * Batch variant. Sessions in a batch usually share an assignee, so connections
 * are memoised per membership to avoid repeat lookups; each still routes to its
 * own assignedMembershipId (with owner fallback). Best-effort — never throws.
 */
export async function syncSessionsToGoogle(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return
  try {
    const sessions = await prisma.trainingSession.findMany({ where: { id: { in: sessionIds } } })
    if (sessions.length === 0) return

    const cache = new Map<string, GoogleCalendarConnection | null>()
    const connFor = async (s: TrainingSession) => {
      const key = s.assignedMembershipId ?? `__owner__:${s.trainerId}`
      if (!cache.has(key)) cache.set(key, await resolveConnection(s.trainerId, s.assignedMembershipId))
      return cache.get(key) ?? null
    }

    await Promise.all(
      sessions.map(async (session) => {
        try {
          const connection = await connFor(session)
          if (!connection) return
          const eventId = await upsertCalendarEvent(connection, session.googleCalendarEventId, buildSessionEvent(session))
          if (eventId && eventId !== session.googleCalendarEventId) {
            await prisma.trainingSession.update({
              where: { id: session.id },
              data: { googleCalendarEventId: eventId },
            })
          }
        } catch (err) {
          console.error('[google-calendar] syncSessionsToGoogle item failed', session.id, err)
        }
      }),
    )
  } catch (err) {
    console.error('[google-calendar] syncSessionsToGoogle failed', err)
  }
}

// ─── availability slots (company-level → owner connection) ────────────────────

export async function syncAvailabilitySlotToGoogle(slotId: string): Promise<void> {
  try {
    const slot = await prisma.availabilitySlot.findUnique({ where: { id: slotId } })
    if (!slot) return
    const connection = await resolveConnection(slot.trainerId, null)
    if (!connection) return

    const event = buildAvailabilitySlotEvent(slot, await membershipTimeZone(connection.membershipId))
    if (!event) return

    const eventId = await upsertCalendarEvent(connection, slot.googleEventId, event)
    if (eventId && eventId !== slot.googleEventId) {
      await prisma.availabilitySlot.update({ where: { id: slot.id }, data: { googleEventId: eventId } })
    }
  } catch (err) {
    console.error('[google-calendar] syncAvailabilitySlotToGoogle failed', slotId, err)
  }
}

// ─── blackout periods (company-level → owner connection) ──────────────────────

export async function syncBlackoutToGoogle(blackoutId: string): Promise<void> {
  try {
    const blackout = await prisma.blackoutPeriod.findUnique({ where: { id: blackoutId } })
    if (!blackout) return
    const connection = await resolveConnection(blackout.trainerId, null)
    if (!connection) return

    const eventId = await upsertCalendarEvent(connection, blackout.googleEventId, buildBlackoutEvent(blackout))
    if (eventId && eventId !== blackout.googleEventId) {
      await prisma.blackoutPeriod.update({ where: { id: blackout.id }, data: { googleEventId: eventId } })
    }
  } catch (err) {
    console.error('[google-calendar] syncBlackoutToGoogle failed', blackoutId, err)
  }
}

// ─── deletes ─────────────────────────────────────────────────────────────────

/**
 * Remove one or more mirrored events. `preferMembershipId` routes to the same
 * connection the event was written to (the session's assignee, else owner).
 * Best-effort — never throws.
 */
export async function deleteGoogleEvents(
  companyId: string,
  eventIds: (string | null | undefined)[],
  preferMembershipId: string | null = null,
): Promise<void> {
  const ids = eventIds.filter((id): id is string => !!id)
  if (ids.length === 0) return
  try {
    const connection = await resolveConnection(companyId, preferMembershipId)
    if (!connection) return
    await Promise.all(
      ids.map((id) =>
        deleteCalendarEvent(connection, id).catch((err) =>
          console.error('[google-calendar] delete event failed', id, err),
        ),
      ),
    )
  } catch (err) {
    console.error('[google-calendar] deleteGoogleEvents failed', err)
  }
}

// ─── busy import (Google → PupManager) ───────────────────────────────────────

/**
 * Pull the member's Google busy window (now → ~60 days) and replace their stored
 * GoogleBusyBlocks with it (delete + reinsert). Returns the block count. Any
 * Google error is swallowed (returns 0) — this is advisory data only.
 */
export async function refreshBusyBlocksForConnection(connection: GoogleCalendarConnection): Promise<number> {
  const now = new Date()
  const until = new Date(now.getTime() + BUSY_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  // Use the events API (not FreeBusy) so we capture each event's TITLE for the
  // schedule hover popup. Skips "free"/cancelled events, expands recurring ones.
  let events
  try {
    events = await fetchCalendarEvents(connection, now, until)
  } catch (err) {
    console.error('[google-calendar] fetchCalendarEvents failed', connection.membershipId, err)
    return 0
  }

  await prisma.googleBusyBlock.deleteMany({ where: { membershipId: connection.membershipId } })
  if (events.length === 0) return 0
  await prisma.googleBusyBlock.createMany({
    data: events.map((e) => ({
      membershipId: connection.membershipId,
      companyId: connection.companyId,
      startsAt: e.start,
      endsAt: e.end,
      title: e.title,
    })),
  })
  return events.length
}

/**
 * Refresh one member's busy blocks by membership id. No-ops (returns 0) when the
 * member isn't connected or the add-on is off. Called on connect + by the cron.
 */
export async function refreshBusyForMembership(membershipId: string): Promise<number> {
  try {
    const connection = await prisma.googleCalendarConnection.findUnique({ where: { membershipId } })
    if (!connection) return 0
    if (!(await hasAddon(connection.companyId, 'googlecalendar'))) return 0
    return await refreshBusyBlocksForConnection(connection)
  } catch (err) {
    console.error('[google-calendar] refreshBusyForMembership failed', membershipId, err)
    return 0
  }
}

// ─── one-off backfill (pre-existing sessions → Google) ────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Push pre-existing, future-dated sessions that were never mirrored (their
 * `googleCalendarEventId` is still null) into Google — the gap left by the
 * class / self-book / booking-page / ongoing paths that only started syncing
 * on 2026-07-20. Reuses the live per-session routing + add-on gating.
 *
 * Idempotent (only null-event-id rows) → safe to re-run, and RESUMABLE: each
 * call processes at most `limit` upcoming sessions and reports how many remain,
 * so a caller loops until `remaining` hits 0 without risking a function timeout.
 * `execute: false` (default) only counts — it writes nothing.
 */
export async function backfillSessionsToGoogle(opts: {
  execute?: boolean
  limit?: number
} = {}): Promise<{ activeCompanies: number; candidates: number; synced: number; remaining: number }> {
  const execute = opts.execute ?? false
  const limit = Math.max(1, opts.limit ?? 1500)

  // Only companies with a live connection AND the add-on still on can receive a push.
  const connections = await prisma.googleCalendarConnection.findMany({ select: { companyId: true } })
  const connectedCompanyIds = [...new Set(connections.map((c) => c.companyId))]
  const activeCompanyIds: string[] = []
  for (const companyId of connectedCompanyIds) {
    if (await hasAddon(companyId, 'googlecalendar')) activeCompanyIds.push(companyId)
  }

  const baseWhere = {
    trainerId: { in: activeCompanyIds },
    scheduledAt: { gte: new Date() },
    googleCalendarEventId: null,
  }

  const candidates = activeCompanyIds.length
    ? await prisma.trainingSession.count({ where: baseWhere })
    : 0

  if (!execute || candidates === 0) {
    return { activeCompanies: activeCompanyIds.length, candidates, synced: 0, remaining: candidates }
  }

  // Take this call's slice (oldest-first), then sync in small throttled chunks so
  // we stay well under Google's per-project write quota.
  const slice = await prisma.trainingSession.findMany({
    where: baseWhere,
    select: { id: true },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
  })
  const ids = slice.map((s) => s.id)

  const CHUNK = 25
  const PAUSE_MS = 300
  for (let i = 0; i < ids.length; i += CHUNK) {
    await syncSessionsToGoogle(ids.slice(i, i + CHUNK))
    if (i + CHUNK < ids.length) await sleep(PAUSE_MS)
  }

  // What actually got mirrored (some may still no-op if the routed member/owner
  // isn't the connected one) and how many un-mirrored sessions remain overall.
  const stillNull = await prisma.trainingSession.count({
    where: { id: { in: ids }, googleCalendarEventId: null },
  })
  const synced = ids.length - stillNull
  const remaining = await prisma.trainingSession.count({ where: baseWhere })
  return { activeCompanies: activeCompanyIds.length, candidates, synced, remaining }
}

/**
 * Refresh busy blocks for EVERY connected member whose company still has the
 * add-on on. Used by the busy-refresh cron. Best-effort per connection.
 */
export async function refreshAllBusyBlocks(): Promise<{ connections: number; refreshed: number; blocks: number }> {
  const connections = await prisma.googleCalendarConnection.findMany()
  let refreshed = 0
  let blocks = 0
  for (const connection of connections) {
    if (!(await hasAddon(connection.companyId, 'googlecalendar'))) continue
    blocks += await refreshBusyBlocksForConnection(connection)
    refreshed += 1
  }
  return { connections: connections.length, refreshed, blocks }
}
