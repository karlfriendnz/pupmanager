// Trainer engagement streak — TRAINING-DAY based. A "training day" is a
// calendar day (in the trainer's timezone) with >=1 scheduled session.
// The streak is the run of consecutive *past* training days, most recent
// backward, where that day's notes are done (every past session that day
// is COMMENTED/INVOICED). Days with no sessions are skipped — they
// neither extend nor break the streak. Derived purely from sessions, so
// there's no activity-tracking table. Distinct from client achievements.
import { prisma } from './prisma'

// ─── Pure streak math (unit-tested) ──────────────────────────────────────────

export interface DaySummary {
  /** Local date 'YYYY-MM-DD'. */
  date: string
  /** Had >=1 session scheduled that day. */
  isTrainingDay: boolean
  /** Every past session that day has notes done (COMMENTED/INVOICED). */
  notesDone: boolean
}

/**
 * Streak over training days only. `days` must be PAST days ordered
 * most-recent-first. Non-training days are skipped. Counting stops at
 * the first training day whose notes aren't done.
 */
export function computeStreak(days: DaySummary[]): number {
  let streak = 0
  for (const d of days) {
    if (!d.isTrainingDay) continue // skip days off — neutral
    if (d.notesDone) streak += 1
    else break
  }
  return streak
}

/** Longest historical run of consecutive notes-done training days. */
export function longestStreak(days: DaySummary[]): number {
  let best = 0
  let run = 0
  // Oldest → newest so a run reads forward in time.
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]
    if (!d.isTrainingDay) continue
    if (d.notesDone) {
      run += 1
      best = Math.max(best, run)
    } else {
      run = 0
    }
  }
  return best
}

// ─── Badge catalogue (in code) ───────────────────────────────────────────────

export interface TrainerStats {
  clients: number
  sessionsDelivered: number
  currentStreak: number // training days
  longestStreak: number // training days
}

export interface BadgeDef {
  key: string
  name: string
  description: string
  earned: (s: TrainerStats) => boolean
}

export const TRAINER_BADGES: BadgeDef[] = [
  { key: 'first_client', name: 'Open for business', description: 'Added your first client.', earned: s => s.clients >= 1 },
  { key: 'clients_10', name: 'Building a roster', description: '10 clients on the books.', earned: s => s.clients >= 10 },
  { key: 'clients_25', name: 'In demand', description: '25 clients.', earned: s => s.clients >= 25 },
  { key: 'sessions_10', name: 'Getting going', description: '10 sessions delivered.', earned: s => s.sessionsDelivered >= 10 },
  { key: 'sessions_50', name: 'Seasoned', description: '50 sessions delivered.', earned: s => s.sessionsDelivered >= 50 },
  { key: 'sessions_200', name: 'Veteran', description: '200 sessions delivered.', earned: s => s.sessionsDelivered >= 200 },
  { key: 'streak_4w', name: 'On a roll', description: 'Notes done 4 training days running.', earned: s => s.longestStreak >= 4 },
  { key: 'streak_12w', name: 'Dialled in', description: 'Notes done 12 training days running.', earned: s => s.longestStreak >= 12 },
  { key: 'streak_26w', name: 'Unstoppable', description: 'Notes done 26 training days running.', earned: s => s.longestStreak >= 26 },
]

export function evaluateBadges(s: TrainerStats): string[] {
  return TRAINER_BADGES.filter(b => b.earned(s)).map(b => b.key)
}

// ─── Session-derived day summaries ───────────────────────────────────────────

const NOTES_DONE_STATUSES = ['COMMENTED', 'INVOICED'] as const

/** 'YYYY-MM-DD' for a date in the given IANA timezone. */
function localDate(d: Date, tz: string): string {
  return d.toLocaleDateString('en-CA', { timeZone: tz })
}

/**
 * Build past-day summaries from the trainer's recent sessions (newest
 * first), for streak math. Only days strictly before today (trainer tz)
 * are included — today is still in progress.
 */
export async function daySummaries(
  trainerId: string,
  tz: string,
  windowDays = 120,
): Promise<DaySummary[]> {
  const now = new Date()
  const from = new Date(now.getTime() - windowDays * 86400000)
  const sessions = await prisma.trainingSession.findMany({
    where: { trainerId, scheduledAt: { gte: from } },
    select: { scheduledAt: true, status: true },
    orderBy: { scheduledAt: 'desc' },
  })

  const today = localDate(now, tz)
  // date -> { any: bool, allPastDone: bool } accumulator
  const byDay = new Map<string, { isTrainingDay: boolean; notesDone: boolean }>()
  for (const s of sessions) {
    const day = localDate(s.scheduledAt, tz)
    if (day >= today) continue // skip today + future — not yet evaluable
    const past = s.scheduledAt.getTime() <= now.getTime()
    const cur = byDay.get(day) ?? { isTrainingDay: true, notesDone: true }
    cur.isTrainingDay = true
    if (past && !(NOTES_DONE_STATUSES as readonly string[]).includes(s.status)) {
      cur.notesDone = false
    }
    byDay.set(day, cur)
  }

  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // most-recent first
    .map(([date, v]) => ({ date, isTrainingDay: v.isTrainingDay, notesDone: v.notesDone }))
}

export async function getStreak(
  trainerId: string,
  tz: string,
): Promise<{ current: number; longest: number }> {
  const days = await daySummaries(trainerId, tz)
  return { current: computeStreak(days), longest: longestStreak(days) }
}

/** Today's state for the 8pm reminder. */
export async function todayStatus(
  trainerId: string,
  tz: string,
): Promise<{ isTrainingDay: boolean; notesDone: boolean }> {
  const now = new Date()
  const today = localDate(now, tz)
  const sessions = await prisma.trainingSession.findMany({
    where: {
      trainerId,
      scheduledAt: {
        gte: new Date(now.getTime() - 2 * 86400000),
        lte: new Date(now.getTime() + 2 * 86400000),
      },
    },
    select: { scheduledAt: true, status: true },
  })
  const todays = sessions.filter(s => localDate(s.scheduledAt, tz) === today)
  if (todays.length === 0) return { isTrainingDay: false, notesDone: true }
  const notesDone = todays.every(
    s => s.scheduledAt.getTime() > now.getTime() || (NOTES_DONE_STATUSES as readonly string[]).includes(s.status),
  )
  return { isTrainingDay: true, notesDone }
}

// ─── Badge persistence ───────────────────────────────────────────────────────

export async function syncBadges(trainerId: string, stats: TrainerStats): Promise<string[]> {
  const eligible = evaluateBadges(stats)
  if (eligible.length === 0) return []
  const existing = await prisma.trainerBadgeAward.findMany({
    where: { trainerId, badgeKey: { in: eligible } },
    select: { badgeKey: true },
  })
  const have = new Set(existing.map(e => e.badgeKey))
  const fresh = eligible.filter(k => !have.has(k))
  if (fresh.length > 0) {
    await prisma.trainerBadgeAward.createMany({
      data: fresh.map(badgeKey => ({ trainerId, badgeKey })),
      skipDuplicates: true,
    })
  }
  return fresh
}
