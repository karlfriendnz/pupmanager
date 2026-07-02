import { prisma } from '@/lib/prisma'
import type { SubscriptionStatus } from '@/generated/prisma'
import { TrainerRow } from './trainer-actions'

// The canonical trainers table — used on the dedicated Trainers page and on the
// admin dashboard so the two never drift apart. Deliberately slim: a handful of
// at-a-glance columns; the full detail + all actions live on each trainer's
// full view (/admin/trainers/[id]), which every row opens.
//
// `q` filters by name/email (empty = no filter); `statuses` keeps only those
// subscription statuses (undefined = all); `limit` caps the rows; `onlyNonPaying`
// keeps just trainers without an ACTIVE (paying) subscription. `deactivated`
// filters soft-delete state: 'exclude' (default) hides deactivated accounts,
// 'only' shows just them, 'all' ignores the flag. `internal` does the same for
// PupManager-owned ("Ours") accounts.
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
  const and: Array<Record<string, unknown>> = []
  if (q) and.push({ OR: [
    { name: { contains: q, mode: 'insensitive' } },
    { email: { contains: q, mode: 'insensitive' } },
  ] })
  if (statuses && statuses.length) and.push({ trainerProfile: { subscriptionStatus: { in: statuses } } })
  if (onlyNonPaying) and.push({ NOT: { trainerProfile: { subscriptionStatus: 'ACTIVE' } } })
  if (deactivated === 'exclude') and.push({ deactivatedAt: null })
  if (deactivated === 'only') and.push({ deactivatedAt: { not: null } })
  if (internal === 'exclude') and.push({ NOT: { trainerProfile: { isInternal: true } } })
  if (internal === 'only') and.push({ trainerProfile: { isInternal: true } })

  const trainers = await prisma.user.findMany({
    where: {
      role: 'TRAINER',
      // One row per company: only account owners (a User who owns a
      // TrainerProfile). Invited team members have no profile of their own.
      trainerProfile: { isNot: null },
      ...(and.length ? { AND: and } : {}),
    },
    orderBy: { createdAt: 'desc' },
    ...(limit ? { take: limit } : {}),
    include: {
      trainerProfile: {
        select: {
          businessName: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          isInternal: true,
          gracePeriodUntil: true,
          subscriptionPlan: { select: { name: true } },
          _count: { select: { clients: true } },
        },
      },
    },
  })

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
      {/* overflow-x-auto + min-w keeps the columns readable on a phone; each row
          taps through to the trainer's full view. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm [&_td]:align-middle">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase">
              <th className="text-left px-4 py-3">Business</th>
              <th className="text-left px-4 py-3">Plan</th>
              <th className="text-left px-4 py-3">Clients</th>
              <th className="text-left px-4 py-3">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {trainers.map(t => (
              <TrainerRow key={t.id} trainer={{
                id: t.id,
                name: t.name,
                email: t.email,
                businessName: t.trainerProfile?.businessName ?? null,
                subscriptionPlanName: t.trainerProfile?.subscriptionPlan?.name ?? null,
                subscriptionStatus: t.trainerProfile?.subscriptionStatus ?? null,
                trialEndsAt: t.trainerProfile?.trialEndsAt ?? null,
                gracePeriodUntil: t.trainerProfile?.gracePeriodUntil ?? null,
                isInternal: t.trainerProfile?.isInternal ?? false,
                clientCount: t.trainerProfile?._count?.clients ?? 0,
                deactivatedAt: t.deactivatedAt ?? null,
                createdAt: t.createdAt,
              }} />
            ))}
          </tbody>
        </table>
      </div>
      {trainers.length === 0 && (
        <p className="text-center py-8 text-slate-500">No trainers found</p>
      )}
    </div>
  )
}
