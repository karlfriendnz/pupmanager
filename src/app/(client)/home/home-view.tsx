'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Flame, Trophy, MapPin, Clock, ChevronRight, Check, Play,
  Sparkles, Lock, ShoppingBag, Download, Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Dog {
  id: string
  name: string
  breed: string | null
  photoUrl: string | null
}

interface UpcomingSession {
  id: string
  title: string
  scheduledAt: string
  durationMins: number
  location: string | null
  sessionType: 'IN_PERSON' | 'VIRTUAL'
}

interface RecentSession {
  id: string
  title: string
  scheduledAt: string
}

interface HomeworkTask {
  id: string
  title: string
  repetitions: number | null
  done: boolean
}

interface LatestMessage {
  from: string
  preview: string
  createdAt: string
  unread: boolean
}

interface PackageProgress {
  label: string
  completed: number
  total: number
}

interface FeaturedProduct {
  id: string
  name: string
  kind: 'PHYSICAL' | 'DIGITAL'
  priceCents: number | null
  imageUrl: string | null
}

interface LibraryItem {
  id: string
  name: string
  description: string | null
  downloadUrl: string | null
}

interface PendingRequest {
  id: string
  productId: string
  productName: string
}

interface AchievementBadge {
  id: string
  name: string
  icon: string | null
  color: string | null
  earned: boolean
}

interface Props {
  clientName: string
  businessName: string
  dashboardBgUrl: string | null
  trainerLogoUrl: string | null
  primaryDog: Dog | null
  upcomingSession: UpcomingSession | null
  recentSessions: RecentSession[]
  homework: HomeworkTask[]
  latestMessage: LatestMessage | null
  packageProgress: PackageProgress | null
  featuredProducts: FeaturedProduct[]
  libraryItems: LibraryItem[]
  pendingRequests: PendingRequest[]
  achievements?: AchievementBadge[]
}

// ─── Gamification mocks (rules TBD) ──────────────────────────────────────────

const MOCK_STREAK = 14
const MOCK_XP = 1240
const MOCK_LEVEL = 3
const MOCK_NEXT_LEVEL_XP = 1500

const MOCK_BADGES = [
  { id: 'b1', label: '7-day streak', icon: '🔥', earned: true },
  { id: 'b2', label: 'First recall', icon: '🎯', earned: true },
  { id: 'b3', label: 'Mat master', icon: '🛏️', earned: true },
  { id: 'b4', label: '14-day streak', icon: '🔥', earned: true },
  { id: 'b5', label: 'Loose-leash', icon: '🦮', earned: false },
  { id: 'b6', label: '30-day streak', icon: '🏅', earned: false },
]

function formatPrice(cents: number | null) {
  if (cents == null) return 'Contact'
  return `$${(cents / 100).toFixed(2)}`
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSessionWhen(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatShortDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function countdownLabel(iso: string) {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0) return 'Now'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `In ${mins} min`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `In ${hrs} hr${hrs === 1 ? '' : 's'}`
  const days = Math.round(hrs / 24)
  return `In ${days} day${days === 1 ? '' : 's'}`
}

function relativeTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

// ─── View ────────────────────────────────────────────────────────────────────

export function ClientHomeView({
  clientName,
  businessName,
  dashboardBgUrl,
  primaryDog,
  upcomingSession,
  recentSessions,
  homework,
  latestMessage,
  packageProgress,
  featuredProducts,
  libraryItems,
  pendingRequests,
  achievements = [],
}: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // Optimistic homework state — we mirror the props locally so the tick
  // animates immediately while the API call settles, then router.refresh()
  // re-syncs from the server.
  const [optimisticDone, setOptimisticDone] = useState<Record<string, boolean>>({})
  const [confettiKey, setConfettiKey] = useState(0)
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)

  const homeworkResolved = homework.map(h => ({
    ...h,
    done: optimisticDone[h.id] ?? h.done,
  }))
  const doneCount = homeworkResolved.filter(h => h.done).length
  const totalCount = homeworkResolved.length
  const allDone = totalCount > 0 && doneCount === totalCount

  const xpPct = Math.min(100, Math.round((MOCK_XP / MOCK_NEXT_LEVEL_XP) * 100))
  const packagePct = packageProgress
    ? Math.round((packageProgress.completed / Math.max(1, packageProgress.total)) * 100)
    : 0

  async function toggleHomework(task: HomeworkTask) {
    if (busyTaskId) return
    setBusyTaskId(task.id)
    const next = !task.done && !optimisticDone[task.id]
    setOptimisticDone(prev => ({ ...prev, [task.id]: next }))
    if (next) setConfettiKey(k => k + 1)

    try {
      const res = await fetch(`/api/tasks/${task.id}/complete`, {
        method: next ? 'POST' : 'DELETE',
        headers: next ? { 'Content-Type': 'application/json' } : undefined,
        body: next ? JSON.stringify({}) : undefined,
      })
      if (!res.ok) {
        // Roll back on failure
        setOptimisticDone(prev => ({ ...prev, [task.id]: !next }))
      } else {
        startTransition(() => router.refresh())
      }
    } catch {
      setOptimisticDone(prev => ({ ...prev, [task.id]: !next }))
    } finally {
      setBusyTaskId(null)
    }
  }

  const dogName = primaryDog?.name ?? 'your pup'
  const firstName = clientName.split(' ')[0] || 'there'

  return (
    <div className="relative">
      {/* ─── Hero: trainer brand banner + dog card ─── */}
      <section className="relative">
        <div
          className="h-44 md:h-52 lg:h-64 w-full relative overflow-hidden"
          style={
            dashboardBgUrl
              ? { backgroundImage: `url(${dashboardBgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : undefined
          }
        >
          {!dashboardBgUrl && (
            <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-black/40" />

          {/* Greeting sits in upper portion so the dog card can overlap the
              bottom of the banner without covering text. */}
          <div className="relative h-full flex flex-col justify-end px-5 lg:px-8 pb-20 lg:pb-24 w-full">
            <p className="text-xs font-medium text-white/80 tracking-wide">{businessName}</p>
            <h1 className="text-2xl lg:text-3xl font-bold text-white leading-tight">Hi {firstName} 👋</h1>
            <p className="text-sm lg:text-base text-white/90">Let&apos;s keep {dogName}&apos;s streak going.</p>
          </div>
        </div>

        {/* Dog hero card — left-aligned within shell, constrained width on larger screens */}
        <div className="px-5 lg:px-8 -mt-14 relative z-10">
          <div className="md:max-w-md rounded-3xl bg-white shadow-xl shadow-slate-900/5 border border-slate-100 overflow-hidden">
            <div className="flex items-stretch">
              <div className="w-28 lg:w-36 h-32 lg:h-40 bg-gradient-to-br from-amber-100 to-orange-200 flex-shrink-0 relative overflow-hidden">
                {primaryDog?.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={primaryDog.photoUrl} alt={dogName} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-5xl lg:text-6xl">🐕</div>
                )}
              </div>

              <div className="flex-1 p-4 lg:p-5 flex flex-col gap-2 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-slate-400 font-medium">Your dog</p>
                    <h2 className="text-lg lg:text-xl font-bold text-slate-900 truncate">{dogName}</h2>
                    {primaryDog?.breed && (
                      <p className="text-xs lg:text-sm text-slate-500 truncate">{primaryDog.breed}</p>
                    )}
                  </div>
                  <StreakChip days={MOCK_STREAK} />
                </div>

                {packageProgress ? (
                  <div className="mt-1">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-medium text-slate-600 truncate">{packageProgress.label}</span>
                      <span className="text-slate-400 flex-shrink-0">{packageProgress.completed}/{packageProgress.total}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all"
                        style={{ width: `${packagePct}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mt-1">No active package</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Body — flex column on phone/iPad, 3-col grid on desktop ─── */}
      <div className="mt-6 lg:mt-8 lg:px-8 lg:max-w-6xl lg:mx-auto flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:auto-rows-min lg:gap-6">

      {/* ─── Up next ─── */}
      <section className="px-5 lg:px-0 lg:col-span-2">
        <SectionHeader title="Up next" />
        {upcomingSession ? (
          <Link
            href={`/my-sessions/${upcomingSession.id}`}
            className="block mt-3 rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 p-5 text-white shadow-lg shadow-blue-600/20 active:scale-[0.99] transition-transform"
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-blue-100 tracking-wide">{countdownLabel(upcomingSession.scheduledAt)}</p>
                <h3 className="text-lg font-bold mt-0.5 leading-tight">{upcomingSession.title}</h3>
                <div className="mt-3 space-y-1.5 text-sm text-blue-50">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 opacity-80" />
                    <span>{formatSessionWhen(upcomingSession.scheduledAt)} · {upcomingSession.durationMins} min</span>
                  </div>
                  {upcomingSession.sessionType === 'IN_PERSON' && upcomingSession.location && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 opacity-80" />
                      <span className="truncate">{upcomingSession.location}</span>
                    </div>
                  )}
                  {upcomingSession.sessionType === 'VIRTUAL' && (
                    <div className="flex items-center gap-2">
                      <Video className="h-3.5 w-3.5 opacity-80" />
                      <span>Virtual session</span>
                    </div>
                  )}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-blue-200 flex-shrink-0" />
            </div>

            {pendingRequests.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/20">
                <p className="text-[11px] uppercase tracking-wide text-blue-200/80 font-medium mb-1.5">
                  Coming next session
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {pendingRequests.map(r => (
                    <span key={r.id} className="text-xs bg-white/15 backdrop-blur px-2 py-1 rounded-lg">
                      {r.productName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Link>
        ) : (
          <div className="mt-3 rounded-3xl bg-white border border-dashed border-slate-200 p-6 text-center">
            <Clock className="h-6 w-6 text-slate-300 mx-auto" />
            <p className="text-sm font-medium text-slate-600 mt-2">No sessions booked yet</p>
            <p className="text-xs text-slate-400 mt-0.5">Your next session will show up here.</p>
          </div>
        )}
      </section>

      {/* ─── Level / XP strip (mock) ─── */}
      <section className="px-5 lg:px-0 lg:col-span-1">
        <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 p-4 h-full">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold text-sm shadow-sm">
              {MOCK_LEVEL}
            </div>
            <div className="flex-1">
              <p className="text-xs text-amber-900/70 font-medium">Level {MOCK_LEVEL} · Apprentice</p>
              <div className="mt-1 h-2 bg-amber-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all"
                  style={{ width: `${xpPct}%` }}
                />
              </div>
              <p className="text-[10px] text-amber-900/60 mt-1">
                {MOCK_XP} / {MOCK_NEXT_LEVEL_XP} XP — {MOCK_NEXT_LEVEL_XP - MOCK_XP} to Level {MOCK_LEVEL + 1}
              </p>
            </div>
            <Trophy className="h-5 w-5 text-amber-500" />
          </div>
        </div>
      </section>

      {/* ─── Homework ─── */}
      <section className="px-5 lg:px-0 lg:col-span-2">
        <div className="flex items-end justify-between">
          <SectionHeader title="This week's homework" />
          {totalCount > 0 && <span className="text-xs text-slate-400">{doneCount}/{totalCount}</span>}
        </div>

        {totalCount > 0 ? (
          <div className="mt-3 rounded-3xl bg-white border border-slate-100 overflow-hidden">
            {homeworkResolved.map((task, i) => (
              <button
                key={task.id}
                type="button"
                onClick={() => toggleHomework(task)}
                disabled={busyTaskId === task.id}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors',
                  i > 0 && 'border-t border-slate-100',
                  task.done ? 'bg-emerald-50/50' : 'hover:bg-slate-50',
                  busyTaskId === task.id && 'opacity-60'
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all flex-shrink-0',
                    task.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300'
                  )}
                >
                  {task.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
                <span
                  className={cn(
                    'flex-1 text-sm transition-all',
                    task.done ? 'text-slate-500 line-through' : 'text-slate-900 font-medium'
                  )}
                >
                  {task.title}
                  {task.repetitions != null && task.repetitions > 0 && (
                    <span className="ml-1 text-[11px] font-normal text-slate-400">· {task.repetitions} reps</span>
                  )}
                </span>
                {task.done && <span className="text-[10px] font-bold text-emerald-600">+50 XP</span>}
              </button>
            ))}

            {allDone && (
              <div className="px-4 py-3 bg-gradient-to-r from-emerald-50 to-blue-50 border-t border-emerald-100">
                <p className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" /> All done this week — nice work!
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 rounded-3xl bg-white border border-dashed border-slate-200 p-6 text-center">
            <Sparkles className="h-6 w-6 text-slate-300 mx-auto" />
            <p className="text-sm font-medium text-slate-600 mt-2">No homework this week</p>
            <p className="text-xs text-slate-400 mt-0.5">Your trainer will assign tasks after each session.</p>
          </div>
        )}

        <ConfettiBurst key={confettiKey} />
      </section>

      {/* ─── Achievements ─── */}
      {achievements.length > 0 && (
        <section className="px-5 lg:px-0 lg:col-span-1">
          <SectionHeader title="Achievements" subtitle="Earn badges as you train" />
          <div className="mt-3 grid grid-cols-3 gap-3">
            {achievements.map(badge => (
              <div
                key={badge.id}
                className={cn(
                  'aspect-square rounded-2xl flex flex-col items-center justify-center gap-1 p-2 border transition-all',
                  badge.earned
                    ? 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200'
                    : 'bg-slate-50 border-slate-100 opacity-60',
                )}
              >
                <span className="text-2xl relative">
                  {badge.earned ? (badge.icon || '🏆') : <Lock className="h-5 w-5 text-slate-400" />}
                </span>
                <p
                  className={cn(
                    'text-[10px] font-medium text-center leading-tight',
                    badge.earned ? 'text-amber-900' : 'text-slate-400',
                  )}
                >
                  {badge.name}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Recent sessions ─── */}
      {recentSessions.length > 0 && (
        <section className="lg:col-span-2 lg:px-0">
          <div className="px-5 lg:px-0">
            <SectionHeader title="Recent sessions" linkHref="/my-sessions" linkLabel="See all" />
          </div>
          <div className="mt-3 flex gap-3 overflow-x-auto px-5 lg:px-0 pb-2 snap-x snap-mandatory no-scrollbar">
            {recentSessions.map(s => (
              <Link
                key={s.id}
                href={`/my-sessions/${s.id}`}
                className="snap-start flex-shrink-0 w-56 rounded-2xl bg-white border border-slate-100 overflow-hidden active:scale-[0.98] transition-transform"
              >
                <div className="h-28 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center relative">
                  <Play className="h-7 w-7 text-slate-400" fill="currentColor" />
                  <span className="absolute top-2 right-2 text-[10px] font-medium text-slate-700 bg-white/80 backdrop-blur px-2 py-0.5 rounded-full">
                    {formatShortDate(s.scheduledAt)}
                  </span>
                </div>
                <div className="p-3">
                  <p className="text-sm font-semibold text-slate-900 truncate">{s.title}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ─── Latest message ─── */}
      {latestMessage && (
        <section className="px-5 lg:px-0 lg:col-span-1">
          <SectionHeader title="From your trainer" />
          <Link
            href="/my-messages"
            className="mt-3 flex items-start gap-3 rounded-2xl bg-white border border-slate-100 p-4 active:scale-[0.99] transition-transform"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-semibold text-sm flex-shrink-0">
              {latestMessage.from[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900 truncate">{latestMessage.from}</p>
                <span className="text-[11px] text-slate-400 flex-shrink-0">{relativeTime(latestMessage.createdAt)}</span>
              </div>
              <p className="text-sm text-slate-500 line-clamp-2 mt-0.5">{latestMessage.preview}</p>
            </div>
            {latestMessage.unread && <span className="h-2 w-2 rounded-full bg-blue-600 mt-2 flex-shrink-0" />}
          </Link>
        </section>
      )}

      {/* ─── Featured products ─── */}
      {featuredProducts.length > 0 && (
        <section className="lg:col-span-2 lg:px-0">
          <div className="px-5 lg:px-0">
            <SectionHeader
              title="Recommended for you"
              subtitle="Hand-picked by your trainer"
              linkHref="/my-shop"
              linkLabel="Shop"
              icon={<ShoppingBag className="h-4 w-4" />}
            />
          </div>
          <div className="mt-3 flex gap-3 overflow-x-auto px-5 lg:px-0 pb-2 snap-x snap-mandatory no-scrollbar">
            {featuredProducts.map(p => (
              <Link
                key={p.id}
                href="/my-shop"
                className="snap-start flex-shrink-0 w-40 rounded-2xl bg-white border border-slate-100 overflow-hidden active:scale-[0.98] transition-transform"
              >
                <div className="aspect-square bg-gradient-to-br from-amber-50 to-rose-50 flex items-center justify-center relative">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt={p.name} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <span className="text-4xl">{p.kind === 'DIGITAL' ? '📁' : '🛍️'}</span>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-semibold text-slate-900 line-clamp-1">{p.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{formatPrice(p.priceCents)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ─── Library — digital products ─── */}
      {libraryItems.length > 0 && (
        <section className="px-5 lg:px-0 mb-8 lg:mb-0 lg:col-span-1">
          <SectionHeader
            title="Your library"
            subtitle="Guides and resources from your trainer"
            icon={<Download className="h-4 w-4" />}
          />
          <div className="mt-3 rounded-3xl bg-white border border-slate-100 overflow-hidden">
            {libraryItems.map((item, i) => {
              const inner = (
                <>
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center flex-shrink-0">
                    <Download className="h-4 w-4 text-violet-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{item.name}</p>
                    {item.description && (
                      <p className="text-xs text-slate-500 truncate">{item.description}</p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                </>
              )
              const className = cn(
                'w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors',
                i > 0 && 'border-t border-slate-100'
              )
              return item.downloadUrl ? (
                <a key={item.id} href={item.downloadUrl} target="_blank" rel="noopener noreferrer" className={className}>
                  {inner}
                </a>
              ) : (
                <Link key={item.id} href="/my-shop" className={className}>
                  {inner}
                </Link>
              )
            })}
          </div>
        </section>
      )}

      </div>
    </div>
  )
}

// ─── Small components ────────────────────────────────────────────────────────

function StreakChip({ days }: { days: number }) {
  return (
    <div className="flex items-center gap-1 bg-gradient-to-br from-orange-100 to-red-100 border border-orange-200 px-2 py-1 rounded-full flex-shrink-0">
      <Flame className="h-3.5 w-3.5 text-orange-600" fill="currentColor" />
      <span className="text-[11px] font-bold text-orange-900 tabular-nums">{days}</span>
    </div>
  )
}

function SectionHeader({
  title,
  subtitle,
  linkHref,
  linkLabel,
  icon,
}: {
  title: string
  subtitle?: string
  linkHref?: string
  linkLabel?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          {icon && <span className="text-slate-500">{icon}</span>}
          {title}
        </h2>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {linkHref && (
        <Link href={linkHref} className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-0.5 flex-shrink-0">
          {linkLabel} <ChevronRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  )
}

function ConfettiBurst() {
  const colors = ['#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981']
  const pieces = Array.from({ length: 12 })
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-1/2 flex justify-center z-50">
      <div className="relative">
        {pieces.map((_, i) => {
          const angle = (i / pieces.length) * Math.PI * 2
          const dx = Math.cos(angle) * 80
          const dy = Math.sin(angle) * 80
          return (
            <span
              key={i}
              className="absolute h-2 w-2 rounded-full confetti-piece"
              style={{
                background: colors[i % colors.length],
                ['--dx' as string]: `${dx}px`,
                ['--dy' as string]: `${dy}px`,
              } as React.CSSProperties}
            />
          )
        })}
      </div>
      <style jsx>{`
        .confetti-piece {
          animation: confetti-fly 700ms ease-out forwards;
          opacity: 0;
        }
        @keyframes confetti-fly {
          0% { transform: translate(0, 0) scale(0.3); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(1); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
