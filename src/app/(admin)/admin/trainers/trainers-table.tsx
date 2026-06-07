import { prisma } from '@/lib/prisma'
import type { SubscriptionStatus } from '@/generated/prisma'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import { TrainerRow } from './trainer-actions'

// The canonical trainers table — used on the dedicated Trainers page and on the
// admin dashboard so the two never drift apart. `q` filters by name/email
// (empty = no filter); `statuses` keeps only those subscription statuses
// (undefined = all); `limit` caps the rows; `onlyNonPaying` keeps just trainers
// without an ACTIVE (paying) subscription — trials, lapsed, free, or no profile.
// `deactivated` filters by soft-delete state: 'exclude' (default) hides
// deactivated accounts so they only live on the Inactive tab; 'only' shows just
// them; 'all' ignores the flag. `internal` does the same for PupManager-owned
// ("Ours") accounts: 'exclude' (default) keeps them off the normal tabs, 'only'
// shows just them, 'all' ignores the flag.
export async function TrainersTable({
  q = '',
  statuses,
  limit,
  onlyNonPaying = false,
  deactivated = 'exclude',
  internal = 'exclude',
}: {
  q?: string
  statuses?: SubscriptionStatus[]
  limit?: number
  onlyNonPaying?: boolean
  deactivated?: 'exclude' | 'only' | 'all'
  internal?: 'exclude' | 'only' | 'all'
}) {
  // Built as an AND array so multiple trainerProfile conditions (status +
  // internal flag) compose instead of overwriting each other.
  const and: Array<Record<string, unknown>> = []
  if (q) and.push({ OR: [
    { name: { contains: q, mode: 'insensitive' } },
    { email: { contains: q, mode: 'insensitive' } },
  ] })
  if (statuses && statuses.length) and.push({ trainerProfile: { subscriptionStatus: { in: statuses } } })
  // "Not on a paying plan" = no ACTIVE subscription. NOT on the relation also
  // catches trainers with no profile or a null status.
  if (onlyNonPaying) and.push({ NOT: { trainerProfile: { subscriptionStatus: 'ACTIVE' } } })
  if (deactivated === 'exclude') and.push({ deactivatedAt: null })
  if (deactivated === 'only') and.push({ deactivatedAt: { not: null } })
  // NOT-on-relation form so non-internal also keeps trainers with no profile.
  if (internal === 'exclude') and.push({ NOT: { trainerProfile: { isInternal: true } } })
  if (internal === 'only') and.push({ trainerProfile: { isInternal: true } })

  const trainers = await prisma.user.findMany({
    where: {
      role: 'TRAINER',
      ...(and.length ? { AND: and } : {}),
    },
    orderBy: { createdAt: 'desc' },
    ...(limit ? { take: limit } : {}),
    include: {
      trainerProfile: {
        select: {
          id: true,
          businessName: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          isInternal: true,
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
    <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase">
            <th className="text-left px-4 py-3">Name</th>
            <th className="text-left px-4 py-3">Business</th>
            <th className="text-left px-4 py-3">Plan</th>
            <th className="text-left px-4 py-3">Trial ends</th>
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
              trialEndsAt: t.trainerProfile?.trialEndsAt ?? null,
              isInternal: t.trainerProfile?.isInternal ?? false,
              clientCount: t.trainerProfile?._count?.clients ?? 0,
              onboardingCompleted: onboarding[i].completed,
              onboardingTotal: onboarding[i].total,
              onboardingEmails: t.trainerProfile?.onboardingProgress?._count?.emails ?? 0,
              gracePeriodUntil: t.trainerProfile?.gracePeriodUntil ?? null,
              deactivatedAt: t.deactivatedAt ?? null,
              createdAt: t.createdAt,
            }} />
          ))}
        </tbody>
      </table>
      {trainers.length === 0 && (
        <p className="text-center py-8 text-slate-500">No trainers found</p>
      )}
    </div>
  )
}
