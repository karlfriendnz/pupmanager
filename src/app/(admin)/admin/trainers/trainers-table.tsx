import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import type { SubscriptionStatus } from '@/generated/prisma'
import { ChevronRight } from 'lucide-react'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import { TrainerRow } from './trainer-row'
import { isPayingCustomer, lifecycleProfileFilter, type TrainerLifecycle } from '@/lib/trainer-lifecycle'

// The canonical trainers table — used on the dedicated Trainers page and on the
// admin dashboard so the two never drift apart. Desktop (md+) renders the full
// at-a-glance table (name/business/country/plan/clients/onboarding/emails/
// joined/last seen/trial ends + inline actions); phones get the same rows as
// stacked cards that tap through to the trainer's full view
// (/admin/trainers/[id]).
//
// `q` filters by name/email (empty = no filter); `bucket` keeps only one
// lifecycle bucket (undefined = all) — see lib/trainer-lifecycle, which treats a
// subscribed trainer inside their carried-over trial window as PAYING, not a
// trialist; `limit` caps the rows; `onlyNonPaying` keeps just trainers who
// haven't started a plan. `deactivated`
// filters soft-delete state: 'exclude' (default) hides deactivated accounts,
// 'only' shows just them, 'all' ignores the flag. `internal` does the same for
// PupManager-owned ("Ours") accounts.
export async function TrainersTable({
  q = '',
  bucket,
  limit,
  onlyNonPaying = false,
  deactivated = 'exclude',
  internal = 'exclude',
}: {
  q?: string
  bucket?: TrainerLifecycle
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
  if (bucket) and.push({ trainerProfile: lifecycleProfileFilter(bucket) })
  // "Not yet paying" = hasn't completed checkout, so a carried-over-trial
  // subscriber is correctly excluded here too.
  if (onlyNonPaying) and.push({ trainerProfile: { stripeSubscriptionId: null } })
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
          id: true,
          businessName: true,
          subscriptionStatus: true,
          // Set only once checkout completes — the paying-customer signal.
          stripeSubscriptionId: true,
          trialEndsAt: true,
          isInternal: true,
          signupCountry: true,
          gracePeriodUntil: true,
          seatCount: true,
          subscriptionPlan: { select: { name: true } },
          _count: { select: { clients: true, members: true } },
          // Count of onboarding emails actually sent to this trainer.
          onboardingProgress: { select: { _count: { select: { emails: true } } } },
        },
      },
    },
  })

  if (trainers.length === 0) {
    return (
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 text-center text-sm text-slate-500">
        No trainers found
      </div>
    )
  }

  // "Sample data" flag per trainer — same signal the trainer app uses to know a
  // brand-new account is still on the first-run preview records: any remaining
  // ClientProfile with isSample=true (see (trainer)/layout.tsx + dashboard).
  // One groupBy keeps it to a single extra query for the whole page.
  const profileIds = trainers
    .map(t => t.trainerProfile?.id)
    .filter((id): id is string => Boolean(id))
  const sampleGroups = profileIds.length
    ? await prisma.clientProfile.groupBy({
        by: ['trainerId'],
        where: { trainerId: { in: profileIds }, isSample: true },
        _count: { _all: true },
      })
    : []
  const sampleByTrainer = new Map(sampleGroups.map(g => [g.trainerId, g._count._all]))

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

  const cards = (
    <ul className="rounded-2xl border border-slate-700 bg-slate-800 divide-y divide-slate-700/60">
      {trainers.map(t => {
        const p = t.trainerProfile!
        const isActive = !t.deactivatedAt
        const graceActive = !!p.gracePeriodUntil && new Date(p.gracePeriodUntil).getTime() > Date.now()
        const flag = flagEmoji(p.signupCountry)
        const clients = p._count.clients
        return (
          <li key={t.id}>
            <Link
              href={`/admin/trainers/${t.id}`}
              className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-700/30 transition-colors ${isActive ? '' : 'opacity-60'}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">
                    {p.businessName?.trim() || t.name?.trim() || '—'}
                  </p>
                  {p.isInternal && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-900 text-purple-300 shrink-0">Ours</span>
                  )}
                  {!isActive && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-500/40 shrink-0">Inactive</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 truncate">
                  {t.name?.trim() || t.email} · <span className="tabular-nums">{clients}</span> client{clients === 1 ? '' : 's'} · <span className="tabular-nums">{joinedLabel(t.createdAt)}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {flag && <span aria-hidden className="text-sm leading-none" title={`Signed up in ${p.signupCountry}`}>{flag}</span>}
                {graceActive && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-900 text-amber-300 shrink-0">Grace</span>}
                {statusChip(p.subscriptionStatus, p.stripeSubscriptionId, p.subscriptionPlan?.name ?? null)}
                <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )

  return (
    <>
      <div className="md:hidden">{cards}</div>
      <div className="hidden md:block bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
        {/* overflow-x-auto + min-w keeps the 10 columns readable on a narrow
            desktop window instead of squashing into an unreadable mess. */}
        <div className="overflow-x-auto">
          {/* [&_td]:align-middle — table cells default to baseline alignment,
              which left the action icons sitting on the text baseline; middle
              keeps every column (and the icon row) vertically centered. */}
          <table className="w-full min-w-[900px] text-sm [&_td]:align-middle">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Business</th>
                <th className="text-left px-4 py-3">Country</th>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3">Clients</th>
                <th className="text-left px-4 py-3">Onboarding</th>
                <th className="text-left px-4 py-3">Emails</th>
                <th className="text-left px-4 py-3">Joined</th>
                <th className="text-left px-4 py-3">Last seen</th>
                <th className="text-left px-4 py-3">Trial ends</th>
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
                  signupCountry: t.trainerProfile?.signupCountry ?? null,
                  clientCount: t.trainerProfile?._count?.clients ?? 0,
                  sampleClientCount: t.trainerProfile?.id ? (sampleByTrainer.get(t.trainerProfile.id) ?? 0) : 0,
                  onboardingCompleted: onboarding[i].completed,
                  onboardingTotal: onboarding[i].total,
                  onboardingEmails: t.trainerProfile?.onboardingProgress?._count?.emails ?? 0,
                  gracePeriodUntil: t.trainerProfile?.gracePeriodUntil ?? null,
                  seatCount: t.trainerProfile?.seatCount ?? 1,
                  seatsUsed: t.trainerProfile?._count?.members ?? 0,
                  deactivatedAt: t.deactivatedAt ?? null,
                  createdAt: t.createdAt,
                  lastLoginAt: t.lastLoginAt ?? null,
                }} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ISO 3166-1 alpha-2 → flag emoji, or null for anything that isn't a clean code.
function flagEmoji(iso: string | null): string | null {
  if (!iso || iso.length !== 2 || !/^[A-Za-z]{2}$/.test(iso)) return null
  const cc = iso.toUpperCase()
  return String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
}

// "DD MMM, H:MM AM/PM" in NZT, e.g. "14 Jun, 4:37 PM" — matches the dashboard list.
function joinedLabel(d: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(d))
  const get = (t: string) => parts.find(part => part.type === t)?.value ?? ''
  const ap = get('dayPeriod').replace(/\./g, '').toUpperCase()
  return `${get('day')} ${get('month')}, ${get('hour')}:${get('minute')} ${ap}`
}

function statusChip(status: string | null, stripeSubscriptionId: string | null, planName: string | null) {
  // A trainer who has started a plan reads as a paying customer even while
  // Stripe still reports `trialing` — we carry their remaining free-trial days
  // into the subscription, so that window is part of a real, card-on-file plan.
  const paying = isPayingCustomer({
    subscriptionStatus: status as SubscriptionStatus | null,
    stripeSubscriptionId,
  })
  const cls =
    paying ? 'bg-green-900 text-green-300' :
    status === 'TRIALING' ? 'bg-blue-900 text-blue-300' :
    'bg-slate-700 text-slate-400'
  const label =
    paying ? (planName ?? 'Active') :
    status === 'TRIALING' ? 'Trial' :
    (status ?? 'No plan')
  return <span className={`text-[11px] px-1.5 py-0.5 rounded-full shrink-0 ${cls}`}>{label}</span>
}
