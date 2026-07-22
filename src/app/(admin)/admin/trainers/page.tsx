import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { lifecycleProfileFilter, type TrainerLifecycle } from '@/lib/trainer-lifecycle'
import { TrainersTable } from './trainers-table'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Trainers' }

// Lifecycle tabs over the trainers table. `statuses` undefined = no filter (All).
// `ours` shows only PupManager-owned (internal) accounts; `inactive` shows only
// soft-deleted accounts. All the lifecycle tabs exclude both.
// `bucket` is a lifecycle bucket from lib/trainer-lifecycle (which knows that a
// subscribed trainer inside their carried-over trial window is a PAYING
// customer, not a trialist). undefined = no filter (All).
const TABS: { key: string; label: string; bucket?: TrainerLifecycle; ours?: boolean; inactive?: boolean }[] = [
  { key: 'all',      label: 'All',              bucket: undefined },
  { key: 'trial',    label: 'In Trial',         bucket: 'trial' },
  { key: 'paying',   label: 'Paying customer',  bucket: 'paying' },
  { key: 'churned',  label: 'Churned',          bucket: 'churned' },
  { key: 'ours',     label: 'Ours',             ours: true },
  { key: 'inactive', label: 'Inactive',         inactive: true },
]

export default async function AdminTrainersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string }>
}) {
  const { q = '', tab = 'all' } = await searchParams
  const current = TABS.find(t => t.key === tab) ?? TABS[0]

  // Lifecycle counts cover real, active accounts: not deactivated and not
  // internal ("Ours"). Those two get their own tabs/counts.
  // Counts are per-company (one account owner each) — a User with a
  // TrainerProfile. Invited team members (TRAINER users with no profile) are
  // not separate accounts and must not be counted.
  const real = { deactivatedAt: null, NOT: { trainerProfile: { isInternal: true } } }
  const [all, trial, paying, churned, ours, inactive] = await Promise.all([
    prisma.user.count({ where: { role: 'TRAINER', ...real, trainerProfile: { isNot: null } } }),
    prisma.user.count({ where: { role: 'TRAINER', ...real, trainerProfile: lifecycleProfileFilter('trial') } }),
    prisma.user.count({ where: { role: 'TRAINER', ...real, trainerProfile: lifecycleProfileFilter('paying') } }),
    prisma.user.count({ where: { role: 'TRAINER', ...real, trainerProfile: lifecycleProfileFilter('churned') } }),
    prisma.user.count({ where: { role: 'TRAINER', deactivatedAt: null, trainerProfile: { isInternal: true } } }),
    prisma.user.count({ where: { role: 'TRAINER', deactivatedAt: { not: null }, trainerProfile: { isNot: null } } }),
  ])
  const counts: Record<string, number> = { all, trial, paying, churned, ours, inactive }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Businesses</h1>
        <p className="text-slate-400 text-sm mt-1">{all} business{all !== 1 ? 'es' : ''} registered</p>
      </div>

      {/* Lifecycle tabs — horizontally scrollable on mobile (six tabs don't fit
          a phone width); scrollbar hidden so it reads as a clean swipe strip. */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-700 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(t => {
          const active = t.key === current.key
          const href = `/admin/trainers?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ''}`
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
