import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import type { SubscriptionStatus } from '@/generated/prisma'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from 'lucide-react'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import { TrainerRow } from './trainer-row'
import { isPayingCustomer, lifecycleProfileFilter, type TrainerLifecycle } from '@/lib/trainer-lifecycle'
import { getEnabledAddonsBatch } from '@/lib/billing'
import { planValueFor, type PlanValue } from '@/lib/plan-value'
import { formatMoney } from '@/lib/money'
import {
  SORT_COLUMNS,
  isColumnHidden,
  nextDir,
  resolveSort,
  sortTrainers,
  visibleSortColumns,
  type SortKey,
} from './trainer-sort'

// The canonical trainers table — the body of the merged admin screen
// ((admin)/admin/page.tsx). Desktop (md+) renders the full at-a-glance table
// (name/business/country/plan/clients/onboarding/emails/joined/last seen/trial
// ends + inline actions); phones get the same rows as stacked cards that tap
// through to the trainer's full view (/admin/trainers/[id]).
//
// `q` filters by name/email (empty = no filter); `bucket` keeps only one
// lifecycle bucket (undefined = all) — see lib/trainer-lifecycle, which treats a
// subscribed trainer inside their carried-over trial window as PAYING, not a
// trialist. `deactivated` filters soft-delete state: 'exclude' (default) hides
// deactivated accounts, 'only' shows just them, 'all' ignores the flag.
// `internal` does the same for PupManager-owned ("Ours") accounts.
//
// `sort`/`dir` come straight off the URL and re-order the fetched rows in JS
// (trainer-sort.ts says why not Prisma). `tab` is here so the header links can
// carry the tab you're on — and so the table knows which columns that tab hides.
export async function TrainersTable({
  q = '',
  bucket,
  deactivated = 'exclude',
  internal = 'exclude',
  tab,
  sort,
  dir,
}: {
  q?: string
  bucket?: TrainerLifecycle
  deactivated?: 'exclude' | 'only' | 'all'
  internal?: 'exclude' | 'only' | 'all'
  tab?: string
  sort?: string
  dir?: string
}) {
  const and: Array<Record<string, unknown>> = []
  // Business name included deliberately: this screen is titled "Businesses" and
  // was matching only the OWNER's name and email, so searching for the business
  // you were looking at found nothing. That was survivable while an "All" tab
  // let you browse; with search now the way to reach any account it is the
  // difference between findable and not.
  if (q) and.push({ OR: [
    { name: { contains: q, mode: 'insensitive' } },
    { email: { contains: q, mode: 'insensitive' } },
    { trainerProfile: { businessName: { contains: q, mode: 'insensitive' } } },
  ] })
  // Searching deliberately ESCAPES the tab. "Find this business" is not a
  // lifecycle question, and scoping it to the current tab meant looking someone
  // up required guessing their state first. It is also what makes dropping the
  // "All" tab safe: an account in no bucket (a comped business is neither
  // trialing nor paying) is still reachable by name or email.
  if (bucket && !q) and.push({ trainerProfile: lifecycleProfileFilter(bucket) })
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
    // In Trial leads with whoever runs out first — that tab is the conversion
    // call list, and newest-first buried someone with two days left under
    // yesterday's signup. Nulls last so a trialist with no end date doesn't
    // squat the top. Every other tab keeps newest-first.
    orderBy: bucket === 'trial' && !q
      ? [{ trainerProfile: { trialEndsAt: { sort: 'asc', nulls: 'last' } } }, { createdAt: 'desc' }]
      : { createdAt: 'desc' },
    include: {
      trainerProfile: {
        select: {
          id: true,
          businessName: true,
          subscriptionStatus: true,
          conversionLikelihood: true,
          // Set only once checkout completes — the paying-customer signal.
          stripeSubscriptionId: true,
          trialEndsAt: true,
          isInternal: true,
          signupCountry: true,
          gracePeriodUntil: true,
          seatCount: true,
          payoutCurrency: true,
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

  // Plan value per customer — only meaningful for a live paid subscription
  // (subscriptionStatus ACTIVE) and never for our own internal accounts. One
  // batched add-on read for the whole page (no N+1); the value is priced from
  // the catalog in each customer's own currency via planValueFor.
  const addonsByTrainer = await getEnabledAddonsBatch(profileIds)
  const planValueByUser = new Map<string, PlanValue>()
  for (const t of trainers) {
    const p = t.trainerProfile
    // isPayingCustomer, not status === 'ACTIVE': a trainer who subscribed
    // while still inside their carried-over trial sits at TRIALING with a real
    // stripeSubscriptionId. They are billed, and their seats are revenue — but
    // an ACTIVE-only test showed them as "—" and left them out of MRR entirely.
    // (Journey Dog Training, 3 seats, was missing for exactly this reason.)
    // The helper already encodes the rule the lifecycle tabs use.
    if (!p || p.isInternal || !isPayingCustomer(p)) continue
    planValueByUser.set(t.id, planValueFor({
      payoutCurrency: p.payoutCurrency,
      seatCount: p.seatCount,
      enabledAddonIds: [...(addonsByTrainer.get(p.id) ?? [])],
    }))
  }

  // ONE row object per business, carrying everything both layouts need, so the
  // desktop table and the mobile cards render from the SAME sorted array — a
  // phone can never end up in a different order from the URL it is showing.
  const rows = trainers.map((t, i) => {
    const p = t.trainerProfile!
    return {
      id: t.id,
      name: t.name,
      email: t.email,
      businessName: p.businessName ?? null,
      subscriptionPlanName: p.subscriptionPlan?.name ?? null,
      subscriptionStatus: p.subscriptionStatus ?? null,
      stripeSubscriptionId: p.stripeSubscriptionId ?? null,
      conversionLikelihood: (p.conversionLikelihood as string | null) ?? null,
      trialEndsAt: p.trialEndsAt ?? null,
      isInternal: p.isInternal ?? false,
      signupCountry: p.signupCountry ?? null,
      clientCount: p._count?.clients ?? 0,
      sampleClientCount: sampleByTrainer.get(p.id) ?? 0,
      onboardingCompleted: onboarding[i].completed,
      onboardingTotal: onboarding[i].total,
      onboardingEmails: p.onboardingProgress?._count?.emails ?? 0,
      gracePeriodUntil: p.gracePeriodUntil ?? null,
      seatCount: p.seatCount ?? 1,
      seatsUsed: p._count?.members ?? 0,
      deactivatedAt: t.deactivatedAt ?? null,
      createdAt: t.createdAt,
      lastLoginAt: t.lastLoginAt ?? null,
      planValue: planValueByUser.get(t.id) ?? null,
    }
  })

  // No `sort` param (or one naming a column this tab hides) = keep the order the
  // query already chose — In Trial still leads with whoever runs out first.
  const active = resolveSort(sort, dir, tab)
  const sorted = sortTrainers(rows, active)
  const columns = visibleSortColumns(tab)
  const hiddenColumns = SORT_COLUMNS.filter(c => isColumnHidden(c.key, tab)).map(c => c.key)
  const showValue = !isColumnHidden('value', tab)

  // Sort links keep `tab` and `q`: losing the tab or the search you were looking
  // at because you clicked a column heading is the obvious way to get this
  // wrong. `key === null` clears the sort back to the tab's default.
  const hrefFor = (key: SortKey | null) => {
    const params = new URLSearchParams()
    if (tab) params.set('tab', tab)
    if (q) params.set('q', q)
    if (key) {
      params.set('sort', key)
      params.set('dir', nextDir(key, active))
    }
    const qs = params.toString()
    return qs ? `/admin?${qs}` : '/admin'
  }

  // Phones get the same sort, spelled as a swipe strip of chips rather than
  // clickable headings (a card list has no header row to click). Same shape as
  // the lifecycle tabs directly above it, so it reads as part of the same
  // control — and it lists every sortable column, so an order chosen on desktop
  // is always visible and changeable here rather than silently applied.
  const sortStrip = (
    <nav
      aria-label="Sort businesses"
      data-testid="mobile-sort"
      className="md:hidden mb-3 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      <span className="shrink-0 pr-0.5 text-xs uppercase tracking-wide text-slate-500">Sort</span>
      <Link
        href={hrefFor(null)}
        className={`shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${
          active ? 'border-slate-700 bg-slate-800 text-slate-400' : 'border-blue-500/40 bg-blue-600/20 text-blue-200'
        }`}
      >
        Default
      </Link>
      {columns.map(col => {
        const on = active?.key === col.key
        return (
          <Link
            key={col.key}
            href={hrefFor(col.key)}
            aria-current={on ? 'true' : undefined}
            className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${
              on ? 'border-blue-500/40 bg-blue-600/20 text-blue-200' : 'border-slate-700 bg-slate-800 text-slate-400'
            }`}
          >
            {col.label}
            {/* aria-hidden — aria-current already says which chip is active,
                and a labelled icon would rename the link on every click. */}
            {on && (active!.dir === 'asc'
              ? <ArrowUp className="h-3 w-3" aria-hidden />
              : <ArrowDown className="h-3 w-3" aria-hidden />)}
          </Link>
        )
      })}
    </nav>
  )

  const cards = (
    <ul className="rounded-2xl border border-slate-700 bg-slate-800 divide-y divide-slate-700/60">
      {sorted.map(t => {
        const isActive = !t.deactivatedAt
        const graceActive = !!t.gracePeriodUntil && new Date(t.gracePeriodUntil).getTime() > Date.now()
        const flag = flagEmoji(t.signupCountry)
        const clients = t.clientCount
        const value = t.planValue
        return (
          <li key={t.id}>
            <Link
              href={`/admin/trainers/${t.id}`}
              className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-700/30 transition-colors ${isActive ? '' : 'opacity-60'}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">
                    {t.businessName?.trim() || t.name?.trim() || '—'}
                  </p>
                  {t.isInternal && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-900 text-purple-300 shrink-0">Ours</span>
                  )}
                  {!isActive && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-500/40 shrink-0">Inactive</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 truncate">
                  {t.name?.trim() || t.email} · <span className="tabular-nums">{clients}</span> client{clients === 1 ? '' : 's'} · <span className="tabular-nums">{joinedLabel(t.createdAt)}</span>
                </p>
                {/* Same per-tab rule as the desktop Value column — a tab where
                    the value is always empty doesn't get a value line. */}
                {showValue && value && (
                  <p className="text-xs text-green-300 mt-0.5 tabular-nums">
                    {formatMoney(value.monthly * 100, value.currency)}/mo · {formatMoney(value.annual * 100, value.currency)}/yr
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {flag && <span aria-hidden className="text-sm leading-none" title={`Signed up in ${t.signupCountry}`}>{flag}</span>}
                {graceActive && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-900 text-amber-300 shrink-0">Grace</span>}
                {statusChip(t.subscriptionStatus, t.stripeSubscriptionId, t.subscriptionPlanName)}
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
      <div className="md:hidden">{sortStrip}{cards}</div>
      <div className="hidden md:block bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
        {/* overflow-x-auto + min-w keeps the 10 columns readable on a narrow
            desktop window instead of squashing into an unreadable mess. */}
        <div className="overflow-x-auto">
          {/* [&_td]:align-middle — table cells default to baseline alignment,
              which left the action icons sitting on the text baseline; middle
              keeps every column (and the icon row) vertically centered. */}
          <table className="w-full min-w-[900px] text-sm [&_td]:align-middle">
            <thead>
              {/* Headers are LINKS, not buttons: this is a server component, so
                  the sort lives in the URL (?sort=&dir=) alongside tab and q —
                  shareable, bookmarkable, and it survives a refresh. Both the
                  header row and the body below derive from `columns`, so the
                  per-tab hidden columns can never knock them out of alignment. */}
              <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase">
                {columns.map(col => {
                  const on = active?.key === col.key
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      className="text-left px-4 py-3 font-normal"
                      aria-sort={on ? (active!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <Link
                        href={hrefFor(col.key)}
                        scroll={false}
                        title={`Sort by ${col.label}`}
                        className={`group inline-flex items-center gap-1 transition-colors ${
                          on ? 'text-white' : 'hover:text-slate-200'
                        }`}
                      >
                        {col.label}
                        {/* aria-hidden on every arrow: the direction is already
                            announced by aria-sort on the columnheader, and a
                            labelled icon would fold into the link's accessible
                            name ("Business sorted ascending"), which changes the
                            control's name every time you click it. */}
                        {on ? (
                          active!.dir === 'asc'
                            ? <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
                            : <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
                        ) : (
                          // Only on hover: eleven permanent arrows would be
                          // decoration on a screen that's already dense.
                          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden />
                        )}
                      </Link>
                    </th>
                  )
                })}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(t => (
                <TrainerRow key={t.id} trainer={t} hiddenColumns={hiddenColumns} />
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
