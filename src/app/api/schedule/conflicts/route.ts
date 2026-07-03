import { NextResponse } from 'next/server'
import { getTrainerContext } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { fetchCalendarEvents } from '@/lib/google-calendar'
import { busyOverlaps } from '@/lib/google-calendar-sync'

// Shared booking-conflict check used by every create/reschedule surface. Returns
// what the ASSIGNED member (the person who'll run the session) already has over
// the proposed [start, end):
//   • sessionConflicts — the member's own overlapping PupManager sessions
//   • busyConflicts    — the member's overlapping Google Calendar busy blocks
// Tenant-scoped to the caller's company. Best-effort: any failure returns empty
// arrays (200) so a booking is never blocked by a conflict-lookup error.
//
// Query: ?start=ISO&end=ISO&membershipId=<assignee|omit for unassigned/owner>
//        &excludeSessionId=<the session being rescheduled, so it doesn't self-clash>
export async function GET(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ sessionConflicts: [], busyConflicts: [] }, { status: 401 })

  try {
    const { searchParams } = new URL(req.url)
    const start = new Date(searchParams.get('start') ?? '')
    const end = new Date(searchParams.get('end') ?? '')
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return NextResponse.json({ sessionConflicts: [], busyConflicts: [] })
    }
    const excludeSessionId = searchParams.get('excludeSessionId') || undefined
    const rawMembership = searchParams.get('membershipId')

    // The owner's membership backs the "unassigned / owner-run" case (mirrors the
    // per-member Google routing).
    const owner = await prisma.trainerMembership.findFirst({
      where: { companyId: ctx.companyId, role: 'OWNER' },
      select: { id: true },
    })
    const ownerId = owner?.id ?? null

    // A supplied membershipId must belong to THIS company (no cross-tenant probe).
    let proposedMembershipId: string | null = null
    if (rawMembership) {
      const m = await prisma.trainerMembership.findFirst({
        where: { id: rawMembership, companyId: ctx.companyId },
        select: { id: true },
      })
      proposedMembershipId = m?.id ?? null
    }

    // Same-person scoping: two DIFFERENT trainers at the same clock time is fine.
    // Owner-run (unassigned) sessions clash with each other AND with sessions
    // explicitly assigned to the owner; a member only clashes with their own.
    const runnerIsOwner = !proposedMembershipId || proposedMembershipId === ownerId
    const assignedFilter = runnerIsOwner
      ? { OR: [{ assignedMembershipId: null }, ...(ownerId ? [{ assignedMembershipId: ownerId }] : [])] }
      : { assignedMembershipId: proposedMembershipId }

    // Bounded candidate window (12h back covers any realistic session length),
    // then an exact half-open overlap filter in JS (Prisma can't add duration).
    const windowStart = new Date(start.getTime() - 12 * 60 * 60 * 1000)
    const candidates = await prisma.trainingSession.findMany({
      where: {
        trainerId: ctx.companyId,
        scheduledAt: { gte: windowStart, lt: end },
        ...assignedFilter,
        ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
      },
      select: {
        id: true, title: true, scheduledAt: true, durationMins: true,
        client: { select: { user: { select: { name: true } } } },
        dog: { select: { name: true } },
        classRun: { select: { name: true } },
        clientPackage: { select: { package: { select: { name: true } } } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 200,
    })

    const sessionConflicts = candidates
      .filter((s) => busyOverlaps(start, end, s.scheduledAt, new Date(s.scheduledAt.getTime() + s.durationMins * 60_000)))
      .slice(0, 20)
      .map((s) => ({
        id: s.id,
        title: s.title,
        scheduledAt: s.scheduledAt.toISOString(),
        durationMins: s.durationMins,
        label: s.client?.user?.name || s.dog?.name || s.classRun?.name || s.clientPackage?.package?.name || null,
      }))

    // Google conflicts for the runner's calendar (proposed member, else owner).
    // This is a booking-time gate, so do a LIVE Google events lookup for exactly
    // this window — authoritative right now (and it carries the event TITLE, so
    // the warning can name the clash). Falls back to the cached GoogleBusyBlocks
    // (also titled) if the live call fails or the member isn't connected.
    const busyMembershipId = proposedMembershipId ?? ownerId
    let busyConflicts: { startsAt: string; endsAt: string; title: string | null }[] = []
    if (busyMembershipId) {
      const connection = (await hasAddon(ctx.companyId, 'googlecalendar'))
        ? await prisma.googleCalendarConnection.findUnique({ where: { membershipId: busyMembershipId } })
        : null

      let live: { start: Date; end: Date; title: string | null }[] | null = null
      if (connection) {
        try {
          live = await fetchCalendarEvents(connection, start, end)
        } catch (err) {
          console.error('[schedule/conflicts] live events lookup failed, using cached', err)
          live = null
        }
      }

      if (live) {
        busyConflicts = live
          .filter((b) => busyOverlaps(start, end, b.start, b.end))
          .map((b) => ({ startsAt: b.start.toISOString(), endsAt: b.end.toISOString(), title: b.title }))
      } else {
        // Cached fallback (also covers the not-connected case → empty).
        const blocks = await prisma.googleBusyBlock.findMany({
          where: { membershipId: busyMembershipId, startsAt: { lt: end }, endsAt: { gt: start } },
          select: { startsAt: true, endsAt: true, title: true },
          orderBy: { startsAt: 'asc' },
          take: 20,
        })
        busyConflicts = blocks.map((b) => ({ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), title: b.title }))
      }
    }

    return NextResponse.json({ sessionConflicts, busyConflicts })
  } catch (err) {
    console.error('[schedule/conflicts] failed', err)
    return NextResponse.json({ sessionConflicts: [], busyConflicts: [] })
  }
}
