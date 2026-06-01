import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import {
  Flame, Lock, PawPrint, DoorOpen, Users, Sparkles, Dumbbell, Medal, Trophy, Zap, Crown, Check,
  type LucideIcon,
} from 'lucide-react'
import { getStreak, TRAINER_BADGES } from '@/lib/trainer-streak'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Your awards' }

// Per-badge presentation — an icon + a colour so the trophy case feels alive.
const BADGE_PRES: Record<string, { Icon: LucideIcon; gradient: string; accent: string }> = {
  first_client: { Icon: DoorOpen, gradient: 'linear-gradient(135deg,#34d399,#059669)', accent: '#059669' },
  clients_10:   { Icon: Users,    gradient: 'linear-gradient(135deg,#38bdf8,#0284c7)', accent: '#0284c7' },
  clients_25:   { Icon: Sparkles, gradient: 'linear-gradient(135deg,#a78bfa,#7c3aed)', accent: '#7c3aed' },
  sessions_10:  { Icon: Dumbbell, gradient: 'linear-gradient(135deg,#60a5fa,#2563eb)', accent: '#2563eb' },
  sessions_50:  { Icon: Medal,    gradient: 'linear-gradient(135deg,#fbbf24,#d97706)', accent: '#d97706' },
  sessions_200: { Icon: Trophy,   gradient: 'linear-gradient(135deg,#fb7185,#e11d48)', accent: '#e11d48' },
  streak_4w:    { Icon: Flame,    gradient: 'linear-gradient(135deg,#fdba74,#f97316)', accent: '#ea580c' },
  streak_12w:   { Icon: Zap,      gradient: 'linear-gradient(135deg,#e879f9,#c026d3)', accent: '#c026d3' },
  streak_26w:   { Icon: Crown,    gradient: 'linear-gradient(135deg,#818cf8,#4f46e5)', accent: '#4f46e5' },
}
const FALLBACK_PRES = { Icon: Trophy, gradient: 'linear-gradient(135deg,#94a3b8,#64748b)', accent: '#475569' }

const STREAK_MILESTONES = [4, 12, 26] as const
const STREAK_BADGE_NAME: Record<number, string> = { 4: 'On a roll', 12: 'Dialled in', 26: 'Unstoppable' }

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
    prisma.trainerBadgeAward.findMany({ where: { trainerId }, select: { badgeKey: true, awardedAt: true } }),
  ])

  const awardedAt = new Map(awards.map(a => [a.badgeKey, a.awardedAt]))
  const earnedCount = TRAINER_BADGES.filter(b => awardedAt.has(b.key)).length
  const total = TRAINER_BADGES.length

  const nextMs = STREAK_MILESTONES.find(m => longest < m) ?? null
  const hot = streak > 0

  return (
    <>
      <PageHeader
        title="Your awards"
        subtitle={`${earnedCount} of ${total} badges earned`}
        back={{ href: '/dashboard', label: 'Dashboard' }}
      />
      <div className="p-4 md:p-8 w-full max-w-3xl mx-auto">

        {/* ─── Streak hero ─── */}
        <div
          className="relative overflow-hidden rounded-3xl p-6 text-white shadow-[0_12px_40px_-12px_rgba(234,88,12,0.45)]"
          style={{ backgroundImage: hot ? 'linear-gradient(135deg,#fb923c 0%,#f97316 45%,#f43f5e 100%)' : 'linear-gradient(135deg,#94a3b8,#64748b)' }}
        >
          <PawPrint aria-hidden className="absolute -right-5 -top-5 h-32 w-32 text-white/10 rotate-12" />
          <PawPrint aria-hidden className="absolute right-28 -bottom-6 h-20 w-20 text-white/10 -rotate-12" />

          <div className="relative flex items-center gap-4">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm ring-1 ring-white/30">
              <Flame className="h-9 w-9" />
            </div>
            <div className="min-w-0">
              <p className="text-5xl font-black leading-none tabular-nums">{streak}</p>
              <p className="text-sm font-semibold text-white/90 mt-1.5">
                {hot ? 'day training streak' : 'no streak yet'}
              </p>
            </div>
            <div className="ml-auto text-right flex-shrink-0">
              <p className="text-2xl font-bold tabular-nums leading-none">{longest}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/75 mt-1">longest</p>
            </div>
          </div>

          {hot && nextMs ? (
            <div className="relative mt-5">
              <div className="flex items-center justify-between text-xs font-medium text-white/90 mb-1.5">
                <span>Next: “{STREAK_BADGE_NAME[nextMs]}”</span>
                <span className="tabular-nums">{longest}/{nextMs} days</span>
              </div>
              <div className="h-2.5 rounded-full bg-black/15 overflow-hidden">
                <div className="h-full rounded-full bg-white/95" style={{ width: `${Math.min(100, Math.round((longest / nextMs) * 100))}%` }} />
              </div>
            </div>
          ) : (
            <p className="relative text-sm text-white/90 mt-4 leading-relaxed">
              {hot
                ? 'You’ve maxed the streak badges — legendary. Keep it rolling! 🔥'
                : 'Finish your session notes on a training day to spark your first streak. Days off don’t count against you.'}
            </p>
          )}
        </div>

        {/* ─── Badge progress ─── */}
        <div className="mt-8 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <PawPrint className="h-4 w-4 text-slate-400" /> Your badges
          </h2>
          <span className="text-xs font-semibold text-slate-500 tabular-nums">{earnedCount}/{total} earned</span>
        </div>
        <div className="mt-2.5 h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.round((earnedCount / total) * 100)}%`, backgroundImage: 'linear-gradient(90deg,#6366f1,#a855f7)' }} />
        </div>

        {/* ─── Trophy case ─── */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {TRAINER_BADGES.map(b => {
            const earned = awardedAt.get(b.key)
            const pres = BADGE_PRES[b.key] ?? FALLBACK_PRES
            return (
              <div
                key={b.key}
                className={`relative rounded-2xl p-4 text-center transition ${
                  earned ? 'bg-white shadow-[0_6px_24px_-8px_rgba(15,23,42,0.18)] ring-1 ring-slate-100' : 'bg-slate-50 ring-1 ring-slate-100'
                }`}
              >
                {earned && (
                  <span className="absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full text-white shadow-sm" style={{ background: pres.accent }}>
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
                <div
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl"
                  style={earned ? { backgroundImage: pres.gradient, color: '#fff', boxShadow: `0 8px 20px -6px ${pres.accent}66` } : { background: '#e2e8f0', color: '#94a3b8' }}
                >
                  {earned ? <pres.Icon className="h-7 w-7" /> : <Lock className="h-5 w-5" />}
                </div>
                <p className={`text-sm font-bold mt-3 leading-tight ${earned ? 'text-slate-900' : 'text-slate-400'}`}>{b.name}</p>
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">{b.description}</p>
                {earned && (
                  <p className="text-[10px] font-semibold mt-2" style={{ color: pres.accent }}>
                    Earned {earned.toLocaleDateString()}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
