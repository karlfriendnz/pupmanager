import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { resolveCancellationFeeCents } from '@/lib/cancellation'
import { createCancellationFeeInvoice } from '@/lib/invoicing'
import { notifyTrainer } from '@/lib/trainer-notify'

// POST /api/my/sessions/[sessionId]/cancel
// The signed-in client cancels ONE upcoming self-booked 1:1 session. Class
// sessions (clientId null, classRunId set) are NOT cancellable here — the client
// leaves the whole run via /api/my/classes/[runId]/cancel instead.

// Short human date for the notification detail, e.g. "Thu 17 Jul". Rendered in
// the trainer's timezone (the session happens in their locale) so it never
// shifts a day under the server's UTC clock.
function shortDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(d)
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export async function POST(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // A trainer previewing the client app must not cancel real bookings.
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — cancelling disabled' }, { status: 403 })

  const { sessionId } = await params

  // Scope hard to the active client's OWN session — never trust the URL id alone.
  // A foreign or class session returns null → 404, and nothing is deleted.
  const session = await prisma.trainingSession.findFirst({
    where: { id: sessionId, clientId: active.clientId, status: 'UPCOMING' },
    select: { id: true, title: true, scheduledAt: true, clientPackageId: true, trainerId: true },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Can't cancel a session that has already started.
  if (session.scheduledAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'That session has already started' }, { status: 400 })
  }

  // Trainer routing + names for the "client cancelled" notification, plus the
  // cancellation-fee config (assigned member first, else the owner — same shape
  // as the self-book route).
  const [profile, trainer] = await Promise.all([
    prisma.clientProfile.findUnique({
      where: { id: active.clientId },
      select: {
        user: { select: { name: true } },
        dog: { select: { name: true } },
        trainer: { select: { user: { select: { id: true } } } },
        assignedTrainer: { select: { user: { select: { id: true } } } },
      },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: session.trainerId },
      select: { cancellationFeeCents: true, cancellationFeeWindowHours: true, user: { select: { timezone: true } } },
    }),
  ])
  const tz = trainer?.user?.timezone ?? 'Pacific/Auckland'

  const feeCents = trainer
    ? resolveCancellationFeeCents(
        { cancellationFeeCents: trainer.cancellationFeeCents, cancellationFeeWindowHours: trainer.cancellationFeeWindowHours },
        session.scheduledAt,
      )
    : 0

  // Delete the session (matches the trainer cancel path — there's no CANCELLED
  // status). Re-scoped by clientId so we can never delete someone else's row.
  await prisma.trainingSession.deleteMany({ where: { id: sessionId, clientId: active.clientId } })

  // Regeneration guard: a self-booked package has a fixed sessionCount and is NOT
  // extendIndefinitely, so a plain delete sticks. But if this session's package
  // WAS made forever-ongoing, extendOngoingPackages() (runs on schedule loads)
  // would top the series back up and could resurrect the cancelled slot — so stop
  // it regenerating, exactly like the trainer's "delete this + following" path.
  if (session.clientPackageId) {
    await prisma.clientPackage.updateMany({
      where: { id: session.clientPackageId, extendIndefinitely: true },
      data: { extendIndefinitely: false },
    })
  }

  // Raise the cancellation fee as a normal receivable, payable via /pay/<token>.
  let feeCharged = 0
  if (feeCents > 0) {
    await createCancellationFeeInvoice({
      trainerId: session.trainerId,
      clientId: active.clientId,
      amountCents: feeCents,
      sourceId: session.id,
      description: `Cancellation fee — ${session.title} (${shortDate(session.scheduledAt, tz)})`,
    })
    feeCharged = feeCents
  }

  const trainerUserId = profile?.assignedTrainer?.user?.id ?? profile?.trainer?.user?.id ?? null
  if (trainerUserId) {
    const feeNote = feeCharged > 0 ? ` (${money(feeCharged)} fee charged)` : ''
    await notifyTrainer(
      trainerUserId,
      'CLIENT_CANCELLED_SESSION',
      {
        clientName: profile?.user?.name ?? 'A client',
        dogName: profile?.dog?.name ?? '',
        detail: `${session.title} on ${shortDate(session.scheduledAt, tz)}${feeNote}`,
      },
      '/schedule',
      session.trainerId,
    )
  }

  return NextResponse.json({ ok: true, feeCharged })
}
