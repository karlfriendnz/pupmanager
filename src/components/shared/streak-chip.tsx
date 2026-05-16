import Link from 'next/link'
import { Flame } from 'lucide-react'
import {
  isoWeekKey,
  activeWeekKeys,
  currentStreak,
  streakAtRisk,
} from '@/lib/trainer-streak'

// Compact streak chip for the mobile dashboard header — mobile has no
// sidebar, so the always-visible sidebar pill never shows there. md:hidden
// so desktop keeps using the sidebar pill instead. Links to /awards.
export async function StreakChip({ trainerId }: { trainerId: string }) {
  const week = isoWeekKey(new Date())
  const keys = await activeWeekKeys(trainerId)
  const weeks = currentStreak(keys, week)
  const atRisk = streakAtRisk(keys, week)

  return (
    <Link
      href="/awards"
      title={
        weeks > 0
          ? `${weeks}-week streak${atRisk ? ' — act this week to keep it' : ''}`
          : 'Start a streak this week'
      }
      className={`animate-pm-pop md:hidden inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-white ${
        weeks > 0 ? (atRisk ? 'bg-amber-500' : 'bg-orange-500') : 'bg-slate-600'
      }`}
    >
      <Flame className="h-3.5 w-3.5" />
      {weeks > 0 ? `${weeks}w` : 'Start'}
    </Link>
  )
}
