import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { resolveCancellationFeeCents } from '@/lib/cancellation'
import { createCancellationFeeInvoice } from '@/lib/invoicing'
import { withdrawEnrollmentAndNotify, ClassError } from '@/lib/class-runs'
import { notifyTrainer } from '@/lib/trainer-notify'

// POST /api/my/classes/[runId]/cancel
// The signed-in client withdraws themselves from a class run: their enrolment is
// set WITHDRAWN and the next waitlisted enrolment is promoted (shared logic with
// the trainer withdraw route). A cancellation fee may apply, measured against the
// run's next upcoming session start.

// Rendered in the trainer's timezone (the class happens in their locale) so the
// date never shifts a day under the server's UTC clock.
function shortDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(d)
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — cancelling disabled' }, { status: 403 })

  const { runId } = await params
  const now = new Date()

  // Scope hard to the caller's OWN live enrolment in this run — never trust the
  // URL alone. A foreign enrolment or a run they aren't in returns null → 404.
  const enrollment = await prisma.classEnrollment.findFirst({
    where: { classRunId: runId, clientId: active.clientId, status: { in: ['ENROLLED', 'WAITLISTED'] } },
    select: {
      id: true,
      classRun: {
        select: {
          name: true,
          trainerId: true,
          trainer: { select: { cancellationFeeCents: true, cancellationFeeWindowHours: true, user: { select: { timezone: true } } } },
          sessions: {
            where: { scheduledAt: { gte: now } },
            orderBy: { scheduledAt: 'asc' },
            take: 1,
            select: { scheduledAt: true },
          },
        },
      },
    },
  })
  if (!enrollment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const run = enrollment.classRun
  const nextStart = run.sessions[0]?.scheduledAt ?? null
  // Fee measured against the next upcoming session. No upcoming session → nothing
  // to be late for → no fee.
  const feeCents = nextStart
    ? resolveCancellationFeeCents(
        { cancellationFeeCents: run.trainer.cancellationFeeCents, cancellationFeeWindowHours: run.trainer.cancellationFeeWindowHours },
        nextStart,
      )
    : 0

  // Trainer routing + names for the notification.
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      user: { select: { name: true } },
      dog: { select: { name: true } },
      trainer: { select: { user: { select: { id: true } } } },
      assignedTrainer: { select: { user: { select: { id: true } } } },
    },
  })

  let promotedEnrollmentId: string | null = null
  try {
    ;({ promotedEnrollmentId } = await withdrawEnrollmentAndNotify(enrollment.id, run.trainerId))
  } catch (err) {
    if (err instanceof ClassError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
    }
    throw err
  }

  let feeCharged = 0
  if (feeCents > 0) {
    await createCancellationFeeInvoice({
      trainerId: run.trainerId,
      clientId: active.clientId,
      amountCents: feeCents,
      sourceId: enrollment.id,
      description: `Cancellation fee — ${run.name}`,
    })
    feeCharged = feeCents
  }

  const trainerUserId = profile?.assignedTrainer?.user?.id ?? profile?.trainer?.user?.id ?? null
  if (trainerUserId) {
    const feeNote = feeCharged > 0 ? ` (${money(feeCharged)} fee charged)` : ''
    const tz = run.trainer.user?.timezone ?? 'Pacific/Auckland'
    const when = nextStart ? ` (from ${shortDate(nextStart, tz)})` : ''
    await notifyTrainer(
      trainerUserId,
      'CLIENT_CANCELLED_SESSION',
      {
        clientName: profile?.user?.name ?? 'A client',
        dogName: profile?.dog?.name ?? '',
        detail: `${run.name}${when}${feeNote}`,
      },
      '/schedule',
      run.trainerId,
    )
  }

  return NextResponse.json({ ok: true, feeCharged, promotedEnrollmentId })
}
