import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isConnectConfigured } from '@/lib/connect'
import { hasAddon } from '@/lib/billing'
import { ClassesView } from './classes-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Classes' }

export default async function ClassesPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  // Gated by the Group classes add-on (default-on; hidden + blocked when off).
  if (!(await hasAddon(trainerId, 'classes'))) redirect('/settings?tab=addons')

  const [runs, teamMembers, trainer] = await Promise.all([
    prisma.classRun.findMany({
      where: { trainerId },
      orderBy: { startDate: 'desc' },
      include: {
        package: { select: { name: true, capacity: true } },
        _count: { select: { sessions: true } },
        enrollments: { where: { status: 'ENROLLED' }, select: { id: true } },
        assignedTrainers: {
          include: { membership: { select: { user: { select: { name: true } } } } },
        },
      },
    }),
    prisma.trainerMembership.findMany({
      where: { companyId: trainerId },
      select: { id: true, title: true, role: true, user: { select: { name: true } } },
      orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
    }),
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { connectChargesEnabled: true, sandboxBilling: true, payoutCurrency: true },
    }),
  ])
  const currency = (trainer?.payoutCurrency ?? 'NZD').toUpperCase()

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
        name: r.name,
        scheduleNote: r.scheduleNote,
        startDate: r.startDate.toISOString(),
        status: r.status,
        sessionCount: r._count.sessions,
        enrolledCount: r.enrollments.length,
        capacity: r.capacity ?? r.package.capacity ?? null,
        imageUrl: r.imageUrl,
        trainerNames: r.assignedTrainers.map(a => a.membership.user.name ?? 'Team member'),
      }))}
      teamMembers={teamMembers.map(m => ({
        id: m.id,
        name: m.user.name ?? 'Team member',
        title: m.title,
        isOwner: m.role === 'OWNER',
      }))}
      promptConnect={promptConnect}
      currency={currency}
    />
  )
}
