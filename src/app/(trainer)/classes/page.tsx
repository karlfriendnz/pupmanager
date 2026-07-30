import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isConnectConfigured } from '@/lib/connect'
import { hasAddon } from '@/lib/billing'
import { isClassRunPast, NON_EVENT_PACKAGE } from '@/lib/class-runs'
import { formatDate } from '@/lib/utils'
import { ClassesView } from './classes-view'
import type { Metadata } from 'next'
import { addonSettingsHref } from '@/lib/configurable-features'

export const metadata: Metadata = { title: 'Group Classes' }

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>
}) {
  const { connect } = await searchParams
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  // Gated by the Group classes add-on (default-on; hidden + blocked when off).
  if (!(await hasAddon(trainerId, 'classes'))) redirect(addonSettingsHref('classes'))

  const [runs, trainer] = await Promise.all([
    prisma.classRun.findMany({
      // Group classes only. Drop-in classes and one-off events are ClassRuns
      // too, but they have their own pages — without this they'd be listed here
      // as well, and every one of them three times over.
      //
      // Events are excluded by their DECLARED flag, not by their shape. The old
      // shape test ("a group offering with one session and no recurrence") also
      // matched an ordinary class that runs once, and silently hid it from this
      // list — see lib/run-kind.ts.
      where: {
        trainerId,
        package: { allowDropIn: false, ...NON_EVENT_PACKAGE },
      },
      // Trainer's arranged order first; date breaks ties (and is the whole
      // order until anything has been dragged).
      orderBy: [{ order: 'asc' }, { startDate: 'asc' }],
      include: {
        package: {
          select: {
            id: true, name: true, description: true, capacity: true, durationMins: true, priceCents: true, specialPriceCents: true,
            // How many curriculum steps this class runs, if any — a SERIES.
            // A count, not the steps themselves: the list only says "6 steps".
            _count: { select: { sessionPlans: true } },
          },
        },
        _count: { select: { sessions: true } },
        // Last session drives the current/past split — a run isn't "past" just
        // because it started a while ago, only once its final session has been.
        sessions: { orderBy: { scheduledAt: 'desc' }, take: 1, select: { scheduledAt: true } },
        enrollments: { where: { status: 'ENROLLED' }, select: { id: true } },
        assignedTrainers: {
          include: { membership: { select: { user: { select: { name: true } } } } },
        },
      },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { connectChargesEnabled: true, sandboxBilling: true, payoutCurrency: true },
    }),
  ])
  const currency = (trainer?.payoutCurrency ?? 'NZD').toUpperCase()

  // Split current vs past here (not in the client) so it matches the server
  // clock and doesn't shift on hydration.
  const now = new Date()

  // Nudge Stripe Connect after a priced class is created — only when payments
  // aren't already live AND the trainer can actually onboard now (Connect
  // configured + allowed for their account), so it's never a dead end.
  const sandbox = trainer?.sandboxBilling ?? false
  const promptConnect =
    !trainer?.connectChargesEnabled &&
    isConnectConfigured(sandbox)

  return (
    <ClassesView
      runs={runs.map(r => ({
        id: r.id,
        packageId: r.package.id,
        name: r.name,
        description: r.package.description,
        scheduleNote: r.scheduleNote,
        location: r.location,
        durationMins: r.package.durationMins,
        priceCents: r.package.specialPriceCents ?? r.package.priceCents,
        // Pre-format on the server so the card renders one stable string — a raw
        // toLocaleDateString() in the client component formats in the server's
        // timezone during SSR and the browser's on hydration, which mismatched.
        startLabel: formatDate(r.startDate),
        status: r.status,
        sessionCount: r._count.sessions,
        seriesSteps: r.package._count.sessionPlans,
        enrolledCount: r.enrollments.length,
        capacity: r.capacity ?? r.package.capacity ?? null,
        imageUrl: r.imageUrl,
        trainerNames: r.assignedTrainers.map(a => a.membership.user.name ?? 'Team member'),
        isPast: isClassRunPast(
          { status: r.status, startDate: r.startDate, lastSessionAt: r.sessions[0]?.scheduledAt },
          now,
        ),
      }))}
      connectName={promptConnect ? (connect ?? null) : null}
      currency={currency}
    />
  )
}
