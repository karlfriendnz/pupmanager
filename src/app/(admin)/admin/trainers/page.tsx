import { prisma } from '@/lib/prisma'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import { TrainerRow } from './trainer-actions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Trainers' }

export default async function AdminTrainersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q = '' } = await searchParams

  const trainers = await prisma.user.findMany({
    where: {
      role: 'TRAINER',
      ...(q ? { OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ]} : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      trainerProfile: {
        select: {
          id: true,
          businessName: true,
          subscriptionStatus: true,
          gracePeriodUntil: true,
          subscriptionPlan: { select: { name: true } },
          _count: { select: { clients: true } },
          // Count of onboarding emails actually sent to this trainer.
          onboardingProgress: { select: { _count: { select: { emails: true } } } },
        },
      },
    },
  })

  // Onboarding progress per trainer — use the same live-derived completion the
  // dashboard checklist uses (a step counts as done when the underlying action
  // is done OR it was explicitly marked), not just the raw step-progress rows.
  const onboarding = await Promise.all(
    trainers.map(async t => {
      if (!t.trainerProfile?.id) return { completed: 0, total: 0 }
      const fab = await getOnboardingFabState(t.trainerProfile.id)
      return { completed: fab.steps.filter(s => s.status === 'completed').length, total: fab.totalSteps }
    }),
  )

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Trainer Accounts</h1>
        <p className="text-slate-400 text-sm mt-1">{trainers.length} trainer{trainers.length !== 1 ? 's' : ''} registered</p>
      </div>

      <form className="mb-6">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name or email..."
          className="w-full max-w-sm h-11 rounded-xl bg-slate-800 border border-slate-700 px-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </form>

      <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase">
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Business</th>
              <th className="text-left px-4 py-3">Plan</th>
              <th className="text-left px-4 py-3">Clients</th>
              <th className="text-left px-4 py-3">Onboarding</th>
              <th className="text-left px-4 py-3">Emails</th>
              <th className="text-left px-4 py-3">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {trainers.map((t, i) => (
              <TrainerRow key={t.id} trainer={{
                id: t.id,
                name: t.name,
                email: t.email,
                businessName: t.trainerProfile?.businessName ?? null,
                subscriptionPlanName: t.trainerProfile?.subscriptionPlan?.name ?? null,
                subscriptionStatus: t.trainerProfile?.subscriptionStatus ?? null,
                clientCount: t.trainerProfile?._count?.clients ?? 0,
                onboardingCompleted: onboarding[i].completed,
                onboardingTotal: onboarding[i].total,
                onboardingEmails: t.trainerProfile?.onboardingProgress?._count?.emails ?? 0,
                gracePeriodUntil: t.trainerProfile?.gracePeriodUntil ?? null,
                createdAt: t.createdAt,
              }} />
            ))}
          </tbody>
        </table>
        {trainers.length === 0 && (
          <p className="text-center py-8 text-slate-500">No trainers found</p>
        )}
      </div>
    </div>
  )
}
