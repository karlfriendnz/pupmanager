import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { notifyClient } from '@/lib/client-notify'
import { syncSessionToGoogle, deleteGoogleEvents } from '@/lib/google-calendar-sync'
import { MAX_BUFFER_MINS } from '@/lib/buffer'

// ONE occurrence of a run — called off, or moved, without touching the rest.
//
// The whole point of the feature: a weekly casual class hits Labour Day, or one
// week has to start an hour later because the hall is double-booked. Everything
// here is scoped to a single session id that must belong to this run, which must
// belong to the caller's company.
//
// The row is never deleted. See lib/run-occurrences.ts for why — briefly: the
// register and every drop-in booking cascade off it, and a deleted date leaves
// nothing behind for the nightly top-up to know it was deliberate.

const patchSchema = z
  .object({
    /** true = call this one off, false = put it back on. */
    cancelled: z.boolean().optional(),
    /** What the client is told. Only meaningful alongside cancelled: true. */
    reason: z.string().max(200).nullable().optional(),
    /** Move it: a new start instant. */
    scheduledAt: z.string().datetime().optional(),
    durationMins: z.number().int().min(5).max(480).optional(),
    bufferMins: z.number().int().min(0).max(MAX_BUFFER_MINS).optional(),
    /** This occurrence's own venue — free text, like every other session venue. */
    location: z.string().max(300).nullable().optional(),
  })
  .refine(
    d =>
      d.cancelled !== undefined ||
      d.scheduledAt !== undefined ||
      d.durationMins !== undefined ||
      d.bufferMins !== undefined ||
      d.location !== undefined,
    { message: 'Nothing to change.' },
  )

/** Short human date for the notification detail, in the trainer's locale. */
function when(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz,
  }).format(d)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ runId: string; sessionId: string }> },
) {
  // classes.manage, not merely "is a trainer" — moving a class everybody turns
  // up to is exactly the thing a read-only team member must not do.
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, sessionId } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Both ids are checked, and the run's ownership is what authorises: a session
  // id from another class — or another company — resolves to nothing.
  const existing = await prisma.trainingSession.findFirst({
    where: { id: sessionId, classRunId: runId, classRun: { trainerId: ctx.companyId } },
    select: {
      id: true, scheduledAt: true, durationMins: true, location: true, title: true,
      cancelledAt: true, scheduleOverriddenAt: true, originalScheduledAt: true,
      googleCalendarEventId: true, assignedMembershipId: true,
      classRun: {
        select: {
          id: true, name: true,
          trainer: { select: { user: { select: { timezone: true } } } },
        },
      },
    },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const d = parsed.data
  const tz = existing.classRun?.trainer.user?.timezone || 'Pacific/Auckland'
  const moving =
    d.scheduledAt !== undefined || d.durationMins !== undefined ||
    d.bufferMins !== undefined || d.location !== undefined

  const nextAt = d.scheduledAt ? new Date(d.scheduledAt) : existing.scheduledAt
  if (Number.isNaN(nextAt.getTime())) {
    return NextResponse.json({ error: 'That is not a real date.' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}

  if (d.cancelled === true) {
    data.cancelledAt = existing.cancelledAt ?? new Date()
    data.cancelReason = d.reason?.trim() || null
  } else if (d.cancelled === false) {
    data.cancelledAt = null
    data.cancelReason = null
  }

  if (moving) {
    if (d.scheduledAt !== undefined) data.scheduledAt = nextAt
    if (d.durationMins !== undefined) data.durationMins = d.durationMins
    if (d.bufferMins !== undefined) data.bufferMins = d.bufferMins
    if (d.location !== undefined) data.location = d.location?.trim() || null
    // Mark it hand-set, so no class-wide rebuild or venue propagation can put
    // it back. Written once — a second move must not lose where the generator
    // originally had it, because that is the instant the slot planner checks
    // before creating the week again.
    data.scheduleOverriddenAt = existing.scheduleOverriddenAt ?? new Date()
    if (existing.originalScheduledAt === null) data.originalScheduledAt = existing.scheduledAt
    // The client is told, through the same batched banner a drag on the
    // schedule uses — one message for a run of changes, not one per tap.
    if (d.scheduledAt !== undefined && nextAt.getTime() !== existing.scheduledAt.getTime()) {
      data.rescheduleNotifyPendingAt = new Date()
    }
  }

  const updated = await prisma.trainingSession.update({
    where: { id: existing.id },
    data,
    select: {
      id: true, scheduledAt: true, durationMins: true, bufferMins: true, location: true,
      cancelledAt: true, cancelReason: true, scheduleOverriddenAt: true, originalScheduledAt: true,
    },
  })

  // ── The calendar ───────────────────────────────────────────────────────────
  // A cancelled occurrence comes OFF the trainer's calendar and the mirrored id
  // is cleared, or the next sync would try to patch an event that no longer
  // exists. Putting it back on creates a fresh event.
  const justCancelled = d.cancelled === true && existing.cancelledAt === null
  if (justCancelled && existing.googleCalendarEventId) {
    await deleteGoogleEvents(ctx.companyId, [existing.googleCalendarEventId], existing.assignedMembershipId)
    await prisma.trainingSession.update({
      where: { id: existing.id },
      data: { googleCalendarEventId: null },
    })
  } else if (!updated.cancelledAt) {
    await syncSessionToGoogle(existing.id)
  }

  // ── The people who turn up ─────────────────────────────────────────────────
  // Enrolments are NOT touched. A drop-in who paid for this week keeps their
  // booking and their place — deleting the session would have deleted them
  // outright (ClassEnrollment.dropInSession cascades), which is the opposite of
  // telling someone their class is off. Refunds stay the trainer's call; the
  // confirmation on the way in says how many bookings are affected.
  if (justCancelled) {
    await notifyOccurrenceClients({
      runId,
      sessionId: existing.id,
      companyId: ctx.companyId,
      planName: existing.classRun?.name ?? existing.title,
      detail: d.reason?.trim()
        ? `${when(existing.scheduledAt, tz)} is cancelled — ${d.reason.trim()}`
        : `${when(existing.scheduledAt, tz)} is cancelled.`,
    })
  } else if (d.cancelled === false && existing.cancelledAt !== null) {
    await notifyOccurrenceClients({
      runId,
      sessionId: existing.id,
      companyId: ctx.companyId,
      planName: existing.classRun?.name ?? existing.title,
      detail: `${when(updated.scheduledAt, tz)} is back on.`,
    })
  }

  return NextResponse.json(updated)
}

/**
 * Tell the people this occurrence actually affects: everyone on the course, and
 * anyone who dropped in on this one session specifically.
 *
 * Deliberately not the same as the whole-run notifier — cancelling week 4 is no
 * business of someone who only booked week 9.
 */
async function notifyOccurrenceClients(opts: {
  runId: string
  sessionId: string
  companyId: string
  planName: string
  detail: string
}) {
  const enrollments = await prisma.classEnrollment.findMany({
    where: {
      classRunId: opts.runId,
      status: 'ENROLLED',
      OR: [{ type: 'FULL' }, { type: 'DROP_IN', dropInSessionId: opts.sessionId }],
    },
    select: { client: { select: { userId: true } }, dog: { select: { name: true } } },
  })
  for (const e of enrollments) {
    if (!e.client?.userId) continue
    await notifyClient({
      userId: e.client.userId,
      trainerId: opts.companyId,
      type: 'CLIENT_SESSION_CHANGED',
      vars: { dogName: e.dog?.name ?? 'your dog', planName: opts.planName, detail: opts.detail },
      link: '/my-sessions',
      ctaLabel: 'View class',
    })
  }
}
