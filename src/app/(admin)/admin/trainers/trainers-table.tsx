import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import type { SubscriptionStatus } from '@/generated/prisma'
import { ChevronRight } from 'lucide-react'

// The canonical trainers list — used on the dedicated Trainers page and on the
// admin dashboard so the two never drift apart. Rendered as app-style stacked
// cards (matching the dashboard's "Latest signups" list) rather than a wide
// table; each card taps through to that trainer's full view. Detail + all
// actions live on the full view (/admin/trainers/[id]).
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
          isInternal: true,
          signupCountry: true,
          gracePeriodUntil: true,
          subscriptionPlan: { select: { name: true } },
          _count: { select: { clients: true } },
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

  return (
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
                {statusChip(p.subscriptionStatus, p.subscriptionPlan?.name ?? null)}
                <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
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

function statusChip(status: string | null, planName: string | null) {
  const cls =
    status === 'ACTIVE' ? 'bg-green-900 text-green-300' :
    status === 'TRIALING' ? 'bg-blue-900 text-blue-300' :
    'bg-slate-700 text-slate-400'
  const label =
    status === 'TRIALING' ? 'Trial' :
    status === 'ACTIVE' ? (planName ?? 'Active') :
    (status ?? 'No plan')
  return <span className={`text-[11px] px-1.5 py-0.5 rounded-full shrink-0 ${cls}`}>{label}</span>
}
