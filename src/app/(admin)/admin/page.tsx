import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Prisma } from '@/generated/prisma'
import { lifecycleProfileFilter, type TrainerLifecycle } from '@/lib/trainer-lifecycle'
import { CountrySummary, type CountryCount } from './country-summary'
import { getEnabledAddonsBatch } from '@/lib/billing'
import { planValueFor, summarisePlanValues, type CurrencyTotal } from '@/lib/plan-value'
import { sumToNzd, toNzd, NZD_RATES_UPDATED } from '@/lib/fx'
import { formatMoney } from '@/lib/money'
// The table (and its row) still live next to the trainer detail route they link
// into; only the LIST SCREEN moved here. /admin/trainers now redirects to /admin.
import { TrainersTable } from './trainers/trainers-table'
// Column sorting + which columns each tab hides — one declaration, shared by the
// table, its rows, the mobile cards and the links below.
import { isColumnHidden, resolveSort } from './trainers/trainer-sort'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Businesses' }

// MRR/ARR across every paying customer, grouped by currency. "Paying" is the
// lifecycle definition from lib/trainer-lifecycle — a live subscription — NOT
// `subscriptionStatus === 'ACTIVE'`. Checkout carries the remainder of a
// trainer's free trial into Stripe, so a customer with a card on file can sit at
// TRIALING for weeks; an ACTIVE-only test silently dropped their seats out of
// MRR (the same bug the per-row Value column had). Sharing
// lifecycleProfileFilter('paying') also guarantees this block and the "Paying
// customer" tab count can never disagree.
// Excludes our own internal accounts and deactivated ones. Values are priced
// from the catalog (Core + seats + active add-ons) in each customer's own
// currency, then grouped so we never sum unlike currencies together.
// Which businesses a tab is showing, expressed on TrainerProfile so it can be
// grouped. The tab COUNTS are asked from the User side (one owner per account);
// this is the same set said the other way round, which is why the two must be
// kept in step — a mismatch would put a country total next to a row count it
// doesn't explain.
function profileFilterForTab(tab: string): Prisma.TrainerProfileWhereInput {
  // Trade-show sandboxes carry isInternal but are not "ours" in the sense this
  // tab means — see the count below.
  if (tab === 'ours') return { isInternal: true, demoSessionId: null, user: { deactivatedAt: null } }
  if (tab === 'inactive') return { user: { deactivatedAt: { not: null } } }
  const bucket: TrainerLifecycle = tab === 'paying' ? 'paying' : tab === 'churned' ? 'churned' : 'trial'
  return { ...lifecycleProfileFilter(bucket), isInternal: false, user: { deactivatedAt: null } }
}

// Where the businesses in this tab signed up, biggest group first. Grouped in the
// database rather than counted in JS: the list screen already pages, so counting
// the rows on screen would have answered a smaller question than the one asked.
async function loadCountrySummary(tab: string): Promise<CountryCount[]> {
  const groups = await prisma.trainerProfile.groupBy({
    by: ['signupCountry'],
    where: profileFilterForTab(tab),
    _count: { _all: true },
  })
  return groups.map(g => ({ code: g.signupCountry, count: g._count._all }))
}

async function loadPayingValueSummary(): Promise<CurrencyTotal[]> {
  const profiles = await prisma.trainerProfile.findMany({
    where: {
      ...lifecycleProfileFilter('paying'),
      isInternal: false,
      user: { deactivatedAt: null },
    },
    select: { id: true, payoutCurrency: true, seatCount: true },
  })
  if (profiles.length === 0) return []
  const addonsByTrainer = await getEnabledAddonsBatch(profiles.map(p => p.id))
  const values = profiles.map(p => planValueFor({
    payoutCurrency: p.payoutCurrency,
    seatCount: p.seatCount,
    enabledAddonIds: [...(addonsByTrainer.get(p.id) ?? [])],
  }))
  return summarisePlanValues(values)
}

// Lifecycle tabs over the trainers table. `statuses` undefined = no filter (All).
// `ours` shows only PupManager-owned (internal) accounts; `inactive` shows only
// soft-deleted accounts. All the lifecycle tabs exclude both.
// `bucket` is a lifecycle bucket from lib/trainer-lifecycle (which knows that a
// subscribed trainer inside their carried-over trial window is a PAYING
// customer, not a trialist). undefined = no filter (All).
// The ARR target the bar measures against. One place to move the goalposts.
const ARR_GOAL = 200_000

// Which COLUMNS each of these tabs hides lives next door in
// trainers/trainer-sort.ts (HIDDEN_COLUMNS_BY_TAB), keyed by the same `key` —
// it has to be importable by the table, the row and the mobile cards, and one
// declaration is what keeps the header row aligned with the body.
const TABS: { key: string; label: string; bucket?: TrainerLifecycle; ours?: boolean; inactive?: boolean }[] = [
  // No "All" tab (Karl, 2026-07-27): In Trial is the screen that matters, and
  // browsing every business isn't a job anyone does — looking one up is.
  //
  // All previously covered a real gap: the lifecycle buckets don't span every
  // account (a comped or manually-ACTIVE business has no stripeSubscriptionId,
  // so it is neither trialing nor paying) and those sat in no tab at all. That
  // gap is now covered by SEARCH, which deliberately ignores the tab — see
  // trainers-table.tsx. Measured when this changed: 0 such accounts existed,
  // but the shape can recur the moment a business is comped.
  { key: 'trial',    label: 'In Trial',         bucket: 'trial' },
  { key: 'paying',   label: 'Paying customer',  bucket: 'paying' },
  { key: 'churned',  label: 'Churned',          bucket: 'churned' },
  { key: 'ours',     label: 'Ours',             ours: true },
  { key: 'inactive', label: 'Inactive',         inactive: true },
]

// The Super Admin home: platform totals, recurring revenue, and the full
// trainers list behind its lifecycle tabs — one screen. It used to be two
// (a stat-card dashboard here, the real table at /admin/trainers), which meant
// every number was stated twice and neither screen was the whole picture.
// The old "Total trainers / Trialists / Customers" cards are gone on purpose:
// trialists and paying customers are the "In Trial" and "Paying customer" tab
// counts, and the headline totals now sit in the subtitle. Summary first
// (totals → revenue), then the detail (tabs → table).
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; sort?: string; dir?: string }>
}) {
  const { q = '', tab = 'trial', sort, dir } = await searchParams
  const current = TABS.find(t => t.key === tab) ?? TABS[0]
  // The chosen column sort (trainer-sort.ts) rides along on every tab and search
  // link, so switching tabs or searching never silently resets your ordering —
  // and `resolveSort` drops it if the new tab hides that column.
  const sortParams = resolveSort(sort, dir, current.key)

  // Lifecycle counts cover real, active accounts: not deactivated and not
  // internal ("Ours"). Those two get their own tabs/counts.
  // Counts are per-company (one account owner each) — a User with a
  // TrainerProfile. Invited team members (TRAINER users with no profile) are
  // not separate accounts and must not be counted.
  const real = { deactivatedAt: null, NOT: { trainerProfile: { isInternal: true } } }
  const [all, live, trial, paying, churned, ours, inactive] = await Promise.all([
    prisma.user.count({ where: { role: 'TRAINER', ...real, trainerProfile: { isNot: null } } }),
    // "Active" = paying customers + trialists, i.e. everyone still with us
    // (excludes churned and never-started accounts). The old "Total trainers"
    // stat card.
    prisma.user.count({ where: { role: 'TRAINER', ...real, trainerProfile: { subscriptionStatus: { in: ['ACTIVE', 'PAST_DUE', 'TRIALING'] } } } }),
    prisma.user.count({ where: { role: 'TRAINER', ...real, trainerProfile: lifecycleProfileFilter('trial') } }),
    prisma.user.count({ where: { role: 'TRAINER', ...real, trainerProfile: lifecycleProfileFilter('paying') } }),
    prisma.user.count({ where: { role: 'TRAINER', ...real, trainerProfile: lifecycleProfileFilter('churned') } }),
    // "Ours" excludes trade-show sandboxes. They carry isInternal (so they stay
    // out of every customer number) but they are not accounts we own and use —
    // they are strangers' throwaways, and thirty of them during a show would
    // make this count meaningless.
    prisma.user.count({ where: { role: 'TRAINER', deactivatedAt: null, trainerProfile: { isInternal: true, demoSessionId: null } } }),
    prisma.user.count({ where: { role: 'TRAINER', deactivatedAt: { not: null }, trainerProfile: { isNot: null } } }),
  ])
  const counts: Record<string, number> = { all, trial, paying, churned, ours, inactive }

  const [valueSummary, countrySummary] = await Promise.all([
    loadPayingValueSummary(),
    loadCountrySummary(current.key),
  ])

  return (
    <div>
      <div className="mb-5 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold">Businesses</h1>
        <p className="text-slate-400 text-sm mt-1 tabular-nums">
          {all} registered · {live} active
        </p>
      </div>

      {/* Where this tab's businesses are. Above the revenue panel because it
          describes the table you're about to read; revenue is platform-wide and
          doesn't change when you switch tabs. */}
      <CountrySummary rows={countrySummary} tabLabel={current.label} />

      {/* Recurring-revenue summary across all paying customers. Grouped by
          currency — customers bill in six different currencies, so a single
          blended total would be meaningless; each currency stands on its own. */}
      {valueSummary.length > 0 && (() => {
        // Progress to the ARR goal, everything converted to NZD. The rates are
        // hand-maintained approximations (src/lib/fx.ts) — right for "how big is
        // the book", never for anything a customer is charged.
        const arrTotal = sumToNzd(valueSummary.map(c => ({ currency: c.currency, amount: c.arr })))
        const mrrTotal = sumToNzd(valueSummary.map(c => ({ currency: c.currency, amount: c.mrr })))
        const pct = Math.min(100, (arrTotal / ARR_GOAL) * 100)
        const mixed = valueSummary.length > 1
        return (
        <div className="mb-6 rounded-2xl border border-slate-700 bg-slate-800 p-4">
          <div className="mb-5">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h2 className="text-sm font-semibold text-white">
                ARR goal
                <span className="ml-2 text-[11px] font-normal text-slate-400">
                  NZD{mixed ? ` · ${valueSummary.map(c => c.currency).join(' + ')} at ${NZD_RATES_UPDATED} rates` : ''}
                </span>
              </h2>
              <span className="text-xs tabular-nums text-slate-400">
                {pct.toFixed(1)}%
              </span>
            </div>
            <div
              className="h-3 w-full overflow-hidden rounded-full bg-slate-900"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={ARR_GOAL}
              aria-valuenow={Math.round(arrTotal)}
              aria-label={`Annual recurring revenue, ${Math.round(arrTotal).toLocaleString()} of ${ARR_GOAL.toLocaleString()}`}
            >
              <div
                className="h-full rounded-full bg-green-400 transition-[width] duration-500"
                style={{ width: `${Math.max(pct, arrTotal > 0 ? 1.5 : 0)}%` }}
              />
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3 text-xs tabular-nums">
              <span className="text-lg font-semibold text-green-300">
                ${Math.round(arrTotal).toLocaleString()}
                <span className="ml-2 text-xs font-normal text-slate-400">
                  ${Math.round(mrrTotal).toLocaleString()}/mo
                </span>
              </span>
              <span className="text-slate-500">
                of ${ARR_GOAL.toLocaleString()}
                <span className="ml-2 text-slate-400">
                  ${Math.max(0, Math.round(ARR_GOAL - arrTotal)).toLocaleString()} to go
                </span>
              </span>
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-white">Recurring revenue</h2>
            {valueSummary.length > 1 && (
              <span className="text-xs text-slate-400 tabular-nums">{valueSummary.length} currencies</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {valueSummary.map(c => (
              <div key={c.currency} className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-medium text-slate-300">{c.currency}</span>
                  <span className="tabular-nums">{c.count} cust{c.count === 1 ? '' : 's'}</span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">MRR</div>
                    <div className="text-lg font-semibold text-green-300 tabular-nums">{formatMoney(c.mrr * 100, c.currency)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">ARR</div>
                    <div className="text-lg font-semibold text-white tabular-nums">{formatMoney(c.arr * 100, c.currency)}</div>
                    {/* NZD equivalent, so cards in different currencies can be
                        compared at a glance. Omitted for NZD itself — repeating
                        the same figure would be noise. */}
                    {c.currency !== 'NZD' && (
                      <div className="text-[11px] tabular-nums text-slate-500">
                        ≈ ${Math.round(toNzd(c.arr, c.currency)).toLocaleString()} NZD
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        )
      })()}

      {/* Lifecycle tabs — horizontally scrollable on mobile (six tabs don't fit
          a phone width); scrollbar hidden so it reads as a clean swipe strip. */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-700 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(t => {
          const active = t.key === current.key
          // Carry the sort across tabs — unless the tab you're moving TO hides
          // that column, in which case it would be an invisible ordering.
          const keepSort = sortParams && !isColumnHidden(sortParams.key, t.key)
            ? `&sort=${sortParams.key}&dir=${sortParams.dir}`
            : ''
          const href = `/admin?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ''}${keepSort}`
          return (
            <Link
              key={t.key}
              href={href}
              className={`relative flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full tabular-nums ${
                active ? 'bg-blue-600/20 text-blue-300' : 'bg-slate-700/60 text-slate-400'
              }`}>
                {counts[t.key] ?? 0}
              </span>
              {/* bottom-0 (inside the box), not -bottom-px: overflow-x-auto forces
                  overflow-y to auto, which would clip a below-the-box indicator
                  and trigger a stray vertical scrollbar. */}
              {active && <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-blue-500 rounded-full" />}
            </Link>
          )
        })}
      </div>

      <form className="mb-6">
        {/* Keep the active tab AND the chosen column sort when searching — a
            GET form submits only its own fields, so anything not carried here
            is silently dropped from the URL. */}
        <input type="hidden" name="tab" value={current.key} />
        {sortParams && <input type="hidden" name="sort" value={sortParams.key} />}
        {sortParams && <input type="hidden" name="dir" value={sortParams.dir} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name or email..."
          className="w-full max-w-sm h-11 rounded-xl bg-slate-800 border border-slate-700 px-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </form>

      <TrainersTable
        q={q}
        bucket={current.bucket}
        deactivated={current.inactive ? 'only' : 'exclude'}
        internal={current.ours ? 'only' : current.inactive ? 'all' : 'exclude'}
        tab={current.key}
        sort={sortParams?.key}
        dir={sortParams?.dir}
      />
    </div>
  )
}
