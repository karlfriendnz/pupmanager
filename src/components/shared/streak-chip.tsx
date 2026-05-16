import Link from 'next/link'
import { Flame } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getStreak } from '@/lib/trainer-streak'

// Compact training-day streak chip for the mobile dashboard header —
// mobile has no sidebar, so the always-visible pill never shows there.
// md:hidden so desktop keeps the sidebar pill. Links to /awards.
export async function StreakChip({ trainerId }: { trainerId: string }) {
  const tp = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { user: { select: { timezone: true } } },
  })
  const { current } = await getStreak(trainerId, tp?.user.timezone ?? 'Pacific/Auckland')

  return (
    <Link
      href="/awards"
      title={
        current > 0
          ? `${current}-training-day streak`
          : 'Start a streak — finish your notes on a training day'
      }
      className={`animate-pm-pop md:hidden inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-white ${
        current > 0 ? 'bg-orange-500' : 'bg-slate-600'
      }`}
    >
      <Flame className="h-3.5 w-3.5" />
      {current > 0 ? `${current}d` : 'Start'}
    </Link>
  )
}
