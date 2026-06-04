import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import type { SubscriptionStatus } from '@/generated/prisma'
import { TrainersTable } from './trainers-table'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Trainers' }

// Lifecycle tabs over the trainers table. `statuses` undefined = no filter (All).
const TABS: { key: string; label: string; statuses?: SubscriptionStatus[] }[] = [
  { key: 'all',     label: 'All',              statuses: undefined },
  { key: 'trial',   label: 'In Trial',         statuses: ['TRIALING'] },
  { key: 'paying',  label: 'Paying customer',  statuses: ['ACTIVE', 'PAST_DUE'] },
  { key: 'churned', label: 'Churned',          statuses: ['CANCELLED'] },
]

export default async function AdminTrainersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string }>
}) {
  const { q = '', tab = 'all' } = await searchParams
  const current = TABS.find(t => t.key === tab) ?? TABS[0]

  const [all, trial, paying, churned] = await Promise.all([
    prisma.user.count({ where: { role: 'TRAINER' } }),
    prisma.user.count({ where: { role: 'TRAINER', trainerProfile: { subscriptionStatus: 'TRIALING' } } }),
    prisma.user.count({ where: { role: 'TRAINER', trainerProfile: { subscriptionStatus: { in: ['ACTIVE', 'PAST_DUE'] } } } }),
    prisma.user.count({ where: { role: 'TRAINER', trainerProfile: { subscriptionStatus: 'CANCELLED' } } }),
  ])
  const counts: Record<string, number> = { all, trial, paying, churned }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Trainer Accounts</h1>
        <p className="text-slate-400 text-sm mt-1">{all} trainer{all !== 1 ? 's' : ''} registered</p>
      </div>

      {/* Lifecycle tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-700">
        {TABS.map(t => {
          const active = t.key === current.key
          const href = `/admin/trainers?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ''}`
          return (
            <Link
              key={t.key}
              href={href}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full tabular-nums ${
                active ? 'bg-blue-600/20 text-blue-300' : 'bg-slate-700/60 text-slate-400'
              }`}>
                {counts[t.key] ?? 0}
              </span>
              {active && <span className="absolute -bottom-px left-3 right-3 h-0.5 bg-blue-500 rounded-full" />}
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

      <TrainersTable q={q} statuses={current.statuses} />
    </div>
  )
}
