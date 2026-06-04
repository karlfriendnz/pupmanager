import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { TrainersTable } from './trainers/trainers-table'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin Dashboard' }

export default async function AdminDashboardPage() {
  const [totalTrainers, activeTrainers, totalClients, totalDogs] = await Promise.all([
    prisma.user.count({ where: { role: 'TRAINER' } }),
    prisma.trainerProfile.count({ where: { subscriptionStatus: { in: ['ACTIVE', 'TRIALING'] } } }),
    prisma.user.count({ where: { role: 'CLIENT' } }),
    prisma.dog.count(),
  ])

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

      {/* Trainers without a paying plan — newest first, capped at 10 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-200">Recent trainers without a paying plan</h2>
          <Link href="/admin/trainers" className="text-sm text-blue-400 hover:underline">View all trainers →</Link>
        </div>
        <TrainersTable limit={10} onlyNonPaying />
      </div>
    </div>
  )
}
