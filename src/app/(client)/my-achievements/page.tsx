import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { computeAchievementProgress } from '@/lib/achievements'
import { PageHeader } from '@/components/shared/page-header'
import { cn } from '@/lib/utils'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Achievements' }

export default async function AchievementsPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const profile = await prisma.clientProfile.findUnique({ where: { id: active.clientId }, select: { id: true, trainerId: true } })
  if (!profile) redirect('/login')

  const [all, earnedRows, progress] = await Promise.all([
    prisma.achievement.findMany({
      where: { trainerId: profile.trainerId, published: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, icon: true },
    }),
    prisma.clientAchievement.findMany({ where: { clientId: profile.id }, select: { achievementId: true } }),
    computeAchievementProgress(profile.id),
  ])

  const earnedSet = new Set(earnedRows.map(e => e.achievementId))
  const badges = all.map(a => ({ ...a, earned: earnedSet.has(a.id), progress: progress[a.id] ?? null }))
  const earnedCount = badges.filter(b => b.earned).length
  const next = badges
    .filter(b => !b.earned && b.progress && b.progress.target > 0)
    .sort((a, b) => (b.progress!.current / b.progress!.target) - (a.progress!.current / a.progress!.target))[0]

  return (
    <>
      <PageHeader title="Achievements" />
      <div className="px-4 pt-5 pb-10 max-w-3xl mx-auto w-full space-y-5">
        <div className="rounded-3xl p-5 text-white" style={{ backgroundImage: 'linear-gradient(135deg,var(--accent),var(--accent-strong))' }}>
          <p className="font-display text-2xl font-extrabold">{earnedCount} badge{earnedCount === 1 ? '' : 's'} earned</p>
          <p className="text-sm text-white/85">Keep training to unlock more 🐾</p>
        </div>

        {next && (
          <div className="rounded-3xl bg-accent-soft p-4 flex items-center gap-3">
            <span className="text-3xl">{next.icon || '🏅'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">Almost there: {next.name}</p>
              <div className="mt-1.5 h-2 rounded-full bg-white/70 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (next.progress!.current / next.progress!.target) * 100)}%` }} /></div>
            </div>
            <span className="text-xs font-bold text-slate-500 shrink-0">{next.progress!.current}/{next.progress!.target}</span>
          </div>
        )}

        {badges.length === 0 ? (
          <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-8 text-center">
            <p className="text-4xl">🏆</p>
            <p className="mt-2 text-sm font-semibold text-slate-700">No badges yet</p>
            <p className="mt-1 text-xs text-slate-400">Your trainer hasn’t set up achievements yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {badges.map(b => (
              <div key={b.id} className={cn('aspect-square rounded-2xl flex flex-col items-center justify-center p-2 text-center', b.earned ? 'bg-white shadow-[0_2px_14px_rgba(15,31,36,0.06)]' : 'bg-slate-100')}>
                <span className={cn('text-3xl', !b.earned && 'opacity-30 grayscale')}>{b.icon || '🏆'}</span>
                <span className={cn('text-[10px] font-medium mt-1 leading-tight line-clamp-2', b.earned ? 'text-slate-700' : 'text-slate-400')}>{b.name}</span>
                {!b.earned && b.progress && b.progress.target > 1 && <span className="text-[9px] text-accent font-bold mt-0.5">{b.progress.current}/{b.progress.target}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
