import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { Flame, Award, Lock } from 'lucide-react'
import { getStreak, TRAINER_BADGES } from '@/lib/trainer-streak'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Your awards' }

export default async function AwardsPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const tp = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { user: { select: { timezone: true } } },
  })
  const [{ current: streak, longest }, awards] = await Promise.all([
    getStreak(trainerId, tp?.user.timezone ?? 'Pacific/Auckland'),
    prisma.trainerBadgeAward.findMany({
      where: { trainerId },
      select: { badgeKey: true, awardedAt: true },
    }),
  ])

  const awardedAt = new Map(awards.map(a => [a.badgeKey, a.awardedAt]))
  const earnedCount = TRAINER_BADGES.filter(b => awardedAt.has(b.key)).length

  return (
    <>
      <PageHeader
        title="Your awards"
        subtitle={`${earnedCount} of ${TRAINER_BADGES.length} badges earned`}
        back={{ href: '/dashboard', label: 'Dashboard' }}
      />
      <div className="p-4 md:p-8 w-full max-w-3xl mx-auto">
        {/* Streak banner */}
        <div
          className={`mb-6 flex items-center gap-4 rounded-2xl border p-5 ${
            streak > 0 ? 'border-orange-200 bg-orange-50' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-2xl flex-shrink-0 ${
              streak > 0 ? 'bg-orange-100 text-orange-600' : 'bg-slate-200 text-slate-400'
            }`}
          >
            <Flame className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-900">
              {streak > 0 ? `${streak}-training-day streak` : 'No streak yet'}
            </p>
            <p className="text-sm text-slate-600 mt-0.5">
              {streak > 0
                ? `Consecutive training days with your notes done. Longest ever: ${longest} day${longest === 1 ? '' : 's'}.`
                : 'Finish your session notes on a training day to start a streak. Days with no sessions don’t count against you.'}
            </p>
          </div>
        </div>

        {/* Badge catalogue — earned + locked */}
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Badges
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TRAINER_BADGES.map(b => {
            const earned = awardedAt.get(b.key)
            return (
              <div
                key={b.key}
                className={`flex items-start gap-3 rounded-xl border p-4 ${
                  earned ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200 bg-white'
                }`}
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 ${
                    earned ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-300'
                  }`}
                >
                  {earned ? <Award className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${earned ? 'text-slate-900' : 'text-slate-500'}`}>
                    {b.name}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{b.description}</p>
                  {earned && (
                    <p className="text-[11px] text-indigo-600 mt-1.5 font-medium">
                      Earned {earned.toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
