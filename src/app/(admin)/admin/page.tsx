import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { TrainersTable } from './trainers/trainers-table'
import { LatestSignups } from './latest-signups'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin Dashboard' }

export default async function AdminDashboardPage() {
  // Real trainers only — never count internal ("Ours") or deactivated accounts.
  const real = { role: 'TRAINER' as const, deactivatedAt: null, NOT: { trainerProfile: { isInternal: true } } }
  const [totalTrainers, totalTrialists, totalCustomers, latest] = await Promise.all([
    // Total trainers = paying customers + trialists (excludes churned/cancelled).
    prisma.user.count({ where: { ...real, trainerProfile: { subscriptionStatus: { in: ['ACTIVE', 'PAST_DUE', 'TRIALING'] } } } }),
    prisma.user.count({ where: { ...real, trainerProfile: { subscriptionStatus: 'TRIALING' } } }),
    prisma.user.count({ where: { ...real, trainerProfile: { subscriptionStatus: { in: ['ACTIVE', 'PAST_DUE'] } } } }),
    // The three most recent real signups (any plan state) for the dashboard widget.
    prisma.user.findMany({
      where: real,
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        trainerProfile: { select: { businessName: true, subscriptionStatus: true, signupCountry: true } },
      },
    }),
  ])

  return (
    <div>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold">Platform Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">Overview of PupManager platform metrics</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 sm:mb-10">
        {[
          { label: 'Total trainers', value: totalTrainers },
          { label: 'Trialists', value: totalTrialists },
          { label: 'Customers (paying)', value: totalCustomers },
        ].map(s => (
          <div key={s.label} className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
            <p className="text-3xl font-bold text-white">{s.value}</p>
            <p className="text-sm text-slate-400 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Last 3 signups — newest trainers regardless of plan state. Mobile only:
          on desktop the trainers table below already surfaces recent signups. */}
      <div className="mb-8 md:hidden">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-200">Latest signups</h2>
          <Link href="/admin/trainers" className="text-sm text-blue-400 hover:underline">View all →</Link>
        </div>
        <LatestSignups trainers={latest.map(t => ({
          id: t.id,
          name: t.name,
          email: t.email,
          businessName: t.trainerProfile?.businessName ?? null,
          subscriptionStatus: t.trainerProfile?.subscriptionStatus ?? null,
          signupCountry: t.trainerProfile?.signupCountry ?? null,
          createdAt: t.createdAt.toISOString(),
        }))} />
      </div>

      {/* Trainers without a paying plan — newest first, capped at 10. Desktop
          only: on mobile the compact "Latest signups" list above stands in for
          this wide table. */}
      <div className="hidden md:block">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-200">Recent trainers without a paying plan</h2>
          <Link href="/admin/trainers" className="text-sm text-blue-400 hover:underline">View all trainers →</Link>
        </div>
        <TrainersTable limit={10} onlyNonPaying />
      </div>
    </div>
  )
}
