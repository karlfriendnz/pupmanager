import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { lifecycleProfileFilter, type TrainerLifecycle } from '@/lib/trainer-lifecycle'
import { getEnabledAddonsBatch } from '@/lib/billing'
import { planValueFor, summarisePlanValues, type CurrencyTotal } from '@/lib/plan-value'
import { formatMoney } from '@/lib/money'
// The table (and its row) still live next to the trainer detail route they link
// into; only the LIST SCREEN moved here. /admin/trainers now redirects to /admin.
import { TrainersTable } from './trainers/trainers-table'
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
const TABS: { key: string; label: string; bucket?: TrainerLifecycle; ours?: boolean; inactive?: boolean }[] = [
  // "All" is not just a convenience: the lifecycle buckets don't cover every
  // account (a comped or manually-ACTIVE business has no stripeSubscriptionId,
  // so it's neither trialing nor paying) and those were reachable from no tab at
  // all — invisible despite being counted in "N businesses registered".
  { key: 'all',      label: 'All' },
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
  searchParams: Promise<{ q?: string; tab?: string }>
}) {
  const { q = '', tab = 'trial' } = await searchParams
  const current = TABS.find(t => t.key === tab) ?? TABS[0]

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
    prisma.user.count({ where: { role: 'TRAINER', deactivatedAt: null, trainerProfile: { isInternal: true } } }),
    prisma.user.count({ where: { role: 'TRAINER', deactivatedAt: { not: null }, trainerProfile: { isNot: null } } }),
  ])
  const counts: Record<string, number> = { all, trial, paying, churned, ours, inactive }

  const valueSummary = await loadPayingValueSummary()

  return (
    <div>
      <div className="mb-5 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold">Businesses</h1>
        <p className="text-slate-400 text-sm mt-1 tabular-nums">
          {all} registered · {live} active
        </p>
      </div>

      {/* Recurring-revenue summary across all paying customers. Grouped by
          currency — customers bill in six different currencies, so a single
          blended total would be meaningless; each currency stands on its own. */}
      {valueSummary.length > 0 && (
        <div className="mb-6 rounded-2xl border border-slate-700 bg-slate-800 p-4">
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
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lifecycle tabs — horizontally scrollable on mobile (six tabs don't fit
          a phone width); scrollbar hidden so it reads as a clean swipe strip. */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-700 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(t => {
          const active = t.key === current.key
          const href = `/admin?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ''}`
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
        {/* Keep the active tab when searching. */}
        <input type="hidden" name="tab" value={current.key} />
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
      />
    </div>
  )
}
