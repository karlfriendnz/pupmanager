import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { Database } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin Dashboard' }

export default async function AdminDashboardPage() {
  const [totalTrainers, totalClients, totalDogs, recentTrainers, plans] = await Promise.all([
    prisma.user.count({ where: { role: 'TRAINER' } }),
    prisma.user.count({ where: { role: 'CLIENT' } }),
    prisma.dog.count(),
    prisma.user.findMany({
      where: { role: 'TRAINER' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        trainerProfile: {
          select: {
            businessName: true,
            subscriptionStatus: true,
            subscriptionPlan: { select: { name: true } },
            _count: { select: { clients: true } },
          },
        },
      },
    }),
    prisma.subscriptionPlan.findMany({ orderBy: { priceMonthly: 'asc' } }),
  ])

  const activeTrainers = recentTrainers.filter(t =>
    t.trainerProfile?.subscriptionStatus === 'ACTIVE' || t.trainerProfile?.subscriptionStatus === 'TRIALING'
  ).length

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Platform Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">Overview of PupManager platform metrics</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {[
          { label: 'Total trainers', value: totalTrainers },
          { label: 'Active / trialling', value: activeTrainers },
          { label: 'Total clients', value: totalClients },
          { label: 'Total dogs', value: totalDogs },
        ].map(s => (
          <div key={s.label} className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
            <p className="text-3xl font-bold text-white">{s.value}</p>
            <p className="text-sm text-slate-400 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Plans summary */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-200">Subscription plans</h2>
          <Link href="/admin/plans" className="text-sm text-blue-400 hover:underline">Manage plans →</Link>
        </div>
        <div className="flex gap-3 flex-wrap">
          {plans.map(p => (
            <div key={p.id} className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-3">
              <div>
                <p className="font-medium text-white">{p.name}</p>
                <p className="text-xs text-slate-400">
                  ${p.priceMonthly}/mo · {p.maxClients == null ? 'Unlimited' : `${p.maxClients} clients`}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${p.isActive ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-400'}`}>
                {p.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tools */}
      <div className="mb-10">
        <h2 className="font-semibold text-slate-200 mb-4">Tools</h2>
        <Link
          href="/admin/demo"
          className="inline-flex items-center gap-3 bg-slate-800 border border-slate-700 hover:border-blue-500/60 hover:bg-slate-700/40 rounded-xl px-4 py-3 transition-colors group"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/15 text-blue-400">
            <Database className="h-4 w-4" />
          </span>
          <span>
            <p className="font-medium text-white text-sm">Demo data</p>
            <p className="text-xs text-slate-400">Seed or reset the demo trainer&apos;s data before a live demo.</p>
          </span>
          <span className="ml-2 text-slate-500 group-hover:text-blue-400">→</span>
        </Link>
      </div>

      {/* Recent trainers */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-200">Recent trainer accounts</h2>
          <Link href="/admin/trainers" className="text-sm text-blue-400 hover:underline">View all →</Link>
        </div>
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase">
                <th className="text-left px-4 py-3">Trainer</th>
                <th className="text-left px-4 py-3">Business</th>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3">Clients</th>
                <th className="text-left px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {recentTrainers.map(t => (
                <tr key={t.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-3 text-white">{t.name ?? t.email}</td>
                  <td className="px-4 py-3 text-slate-300">{t.trainerProfile?.businessName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      t.trainerProfile?.subscriptionStatus === 'ACTIVE' ? 'bg-green-900 text-green-300' :
                      t.trainerProfile?.subscriptionStatus === 'TRIALING' ? 'bg-blue-900 text-blue-300' :
                      'bg-slate-700 text-slate-400'
                    }`}>
                      {t.trainerProfile?.subscriptionPlan?.name ?? 'No plan'} · {t.trainerProfile?.subscriptionStatus ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{t.trainerProfile?._count?.clients ?? 0}</td>
                  <td className="px-4 py-3 text-slate-400">{formatDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
