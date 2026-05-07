// Auto-award engine for trainer-defined achievements.
//
// One entry point: `evaluateAchievementsFor(clientId)` — loads the trainer's
// auto-rules and the client's existing awards, computes only the counters the
// remaining rules need, and inserts new ClientAchievement rows for any rule
// the client now qualifies for. Idempotent thanks to the (clientId, achievementId)
// unique constraint, so it's safe to call from many write-points.

import { prisma } from '@/lib/prisma'
import type { Achievement, AchievementTrigger } from '@/generated/prisma'

interface ClientCounters {
  sessionsCompleted: number
  sessionsCompletedInPerson: number
  sessionsCompletedVirtual: number
  consecutiveCompletedFromMostRecent: number
  hasAnyPackage: boolean
  packagesCompleted: number
  homeworkDone: number
  homeworkStreakDays: number
  perfectWeeks: number
  daysAsClient: number
  messagesSentByClient: number
  productsPurchased: number
  profileComplete: boolean
}

const TRIGGERS_NEEDING_SESSIONS: AchievementTrigger[] = [
  'FIRST_SESSION', 'SESSIONS_COMPLETED', 'IN_PERSON_SESSIONS', 'VIRTUAL_SESSIONS', 'CONSECUTIVE_SESSIONS_ATTENDED',
]
const TRIGGERS_NEEDING_PACKAGES: AchievementTrigger[] = ['FIRST_PACKAGE_ASSIGNED', 'PACKAGES_COMPLETED']
const TRIGGERS_NEEDING_HOMEWORK: AchievementTrigger[] = ['FIRST_HOMEWORK_DONE', 'HOMEWORK_TASKS_DONE', 'HOMEWORK_STREAK_DAYS', 'PERFECT_WEEK']

export interface AwardResult {
  achievementId: string
  earnedValue: number | null
}

/**
 * Run all auto-rules for the trainer of `clientId` against the client's
 * current state, awarding any not-yet-awarded rules. Returns the IDs of
 * achievements newly awarded so callers can fire notifications.
 */
export async function evaluateAchievementsFor(clientId: string): Promise<AwardResult[]> {
  const client = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: { id: true, trainerId: true, createdAt: true, userId: true },
  })
  if (!client) return []

  const [rules, alreadyAwarded] = await Promise.all([
    prisma.achievement.findMany({
      // Only published rules are eligible for auto-award. Drafts stay invisible
      // to clients and the awarder until the trainer publishes them.
      where: { trainerId: client.trainerId, triggerType: { not: 'MANUAL' }, published: true },
      select: { id: true, triggerType: true, triggerValue: true, name: true },
    }),
    prisma.clientAchievement.findMany({
      where: { clientId },
      select: { achievementId: true },
    }),
  ])
  if (rules.length === 0) return []

  const awardedSet = new Set(alreadyAwarded.map(a => a.achievementId))
  const pending = rules.filter(r => !awardedSet.has(r.id))
  if (pending.length === 0) return []

  // Only load the counters our pending rules actually need.
  const need = new Set(pending.map(r => r.triggerType))
  const counters = await loadCounters(client.id, client.userId, client.trainerId, client.createdAt, need)

  const wins: AwardResult[] = []
  for (const rule of pending) {
    const earned = evaluate(rule.triggerType, rule.triggerValue, counters)
    if (earned == null) continue
    try {
      await prisma.clientAchievement.create({
        data: {
          clientId,
          achievementId: rule.id,
          awardedBy: 'system',
          earnedValue: earned,
        },
      })
      wins.push({ achievementId: rule.id, earnedValue: earned })
      // Surface in the client's notifications inbox so they see the badge.
      await prisma.notification.create({
        data: {
          userId: client.userId,
          title: 'Achievement unlocked',
          body: `You earned "${rule.name}"`,
        },
      }).catch(() => {})
    } catch {
      // Unique violation = raced with another writer; safe to ignore.
    }
  }
  return wins
}

async function loadCounters(
  clientId: string,
  userId: string,
  trainerId: string,
  createdAt: Date,
  need: Set<AchievementTrigger>,
): Promise<ClientCounters> {
  const c: ClientCounters = {
    sessionsCompleted: 0,
    sessionsCompletedInPerson: 0,
    sessionsCompletedVirtual: 0,
    consecutiveCompletedFromMostRecent: 0,
    hasAnyPackage: false,
    packagesCompleted: 0,
    homeworkDone: 0,
    homeworkStreakDays: 0,
    perfectWeeks: 0,
    daysAsClient: Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000)),
    messagesSentByClient: 0,
    productsPurchased: 0,
    profileComplete: false,
  }

  const needSessions = TRIGGERS_NEEDING_SESSIONS.some(t => need.has(t))
  const needPackages = TRIGGERS_NEEDING_PACKAGES.some(t => need.has(t))
  const needHomework = TRIGGERS_NEEDING_HOMEWORK.some(t => need.has(t))

  await Promise.all([
    needSessions ? loadSessionCounters(clientId, c) : Promise.resolve(),
    needPackages ? loadPackageCounters(clientId, c) : Promise.resolve(),
    needHomework ? loadHomeworkCounters(clientId, c) : Promise.resolve(),
    need.has('MESSAGES_SENT')
      ? prisma.message.count({
          where: { clientId, channel: 'TRAINER_CLIENT', senderId: userId },
        }).then(n => { c.messagesSentByClient = n })
      : Promise.resolve(),
    need.has('PRODUCTS_PURCHASED')
      ? prisma.productRequest.count({ where: { clientId, status: 'FULFILLED' } })
          .then(n => { c.productsPurchased = n })
      : Promise.resolve(),
    need.has('PROFILE_COMPLETED')
      ? loadProfileComplete(clientId, trainerId, c)
      : Promise.resolve(),
  ])

  return c
}

async function loadSessionCounters(clientId: string, c: ClientCounters) {
  const sessions = await prisma.trainingSession.findMany({
    where: { clientId },
    select: { status: true, sessionType: true, scheduledAt: true },
    orderBy: { scheduledAt: 'desc' },
  })
  let consecutive = 0
  let consecutiveBroken = false
  for (const s of sessions) {
    const done = s.status === 'COMPLETED' || s.status === 'COMMENTED' || s.status === 'INVOICED'
    if (done) {
      c.sessionsCompleted++
      if (s.sessionType === 'IN_PERSON') c.sessionsCompletedInPerson++
      else if (s.sessionType === 'VIRTUAL') c.sessionsCompletedVirtual++
      if (!consecutiveBroken) consecutive++
    } else if (s.status === 'UPCOMING') {
      // Future-scheduled sessions don't break the streak; only past missed ones do.
      // For our purposes, treat any non-done past session as a break — but the
      // schema only tracks COMPLETED/COMMENTED/INVOICED/UPCOMING. UPCOMING in the
      // past = no-show, which we don't currently distinguish, so leave the streak
      // alone here.
      // (Refine if a CANCELLED status is added later.)
      consecutiveBroken = consecutive > 0 ? consecutiveBroken : consecutiveBroken
    }
  }
  c.consecutiveCompletedFromMostRecent = consecutive
}

async function loadPackageCounters(clientId: string, c: ClientCounters) {
  const packages = await prisma.clientPackage.findMany({
    where: { clientId },
    select: {
      sessions: { select: { status: true } },
    },
  })
  c.hasAnyPackage = packages.length > 0
  for (const p of packages) {
    if (p.sessions.length > 0 && p.sessions.every(s => s.status !== 'UPCOMING')) {
      c.packagesCompleted++
    }
  }
}

async function loadHomeworkCounters(clientId: string, c: ClientCounters) {
  const tasks = await prisma.trainingTask.findMany({
    where: { clientId },
    select: { date: true, completion: { select: { id: true } } },
    orderBy: { date: 'desc' },
  })
  c.homeworkDone = tasks.filter(t => t.completion).length

  // Build a map of YYYY-MM-DD → { total, done } for streak / perfect-week math.
  const byDate = new Map<string, { total: number; done: number }>()
  for (const t of tasks) {
    const d = t.date.toISOString().split('T')[0]
    const e = byDate.get(d) ?? { total: 0, done: 0 }
    e.total++
    if (t.completion) e.done++
    byDate.set(d, e)
  }

  // Streak from today (trainer-tz approximation: server-local date) backwards
  // counting days where every assigned task was completed. A day with no
  // tasks neither extends nor breaks the streak — it's just skipped.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let streak = 0
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().split('T')[0]
    const e = byDate.get(key)
    if (!e) continue
    if (e.done < e.total) break
    streak++
  }
  c.homeworkStreakDays = streak

  // Perfect weeks: count Mon-anchored weeks where every assigned task was done.
  const byWeek = new Map<string, { total: number; done: number }>()
  for (const [dateStr, agg] of byDate.entries()) {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    const dow = dt.getUTCDay() // 0=Sun..6=Sat
    const diff = dow === 0 ? -6 : 1 - dow
    dt.setUTCDate(dt.getUTCDate() + diff)
    const wk = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
    const e = byWeek.get(wk) ?? { total: 0, done: 0 }
    e.total += agg.total
    e.done += agg.done
    byWeek.set(wk, e)
  }
  let perfect = 0
  for (const e of byWeek.values()) {
    if (e.total > 0 && e.done === e.total) perfect++
  }
  c.perfectWeeks = perfect
}

async function loadProfileComplete(clientId: string, trainerId: string, c: ClientCounters) {
  const [requiredFields, values, client] = await Promise.all([
    prisma.customField.findMany({
      where: { trainerId, required: true },
      select: { id: true, appliesTo: true },
    }),
    prisma.customFieldValue.findMany({
      where: { clientId },
      select: { fieldId: true, dogId: true, value: true },
    }),
    prisma.clientProfile.findUnique({ where: { id: clientId }, select: { dogId: true } }),
  ])
  if (requiredFields.length === 0) { c.profileComplete = true; return }
  const primaryDog = client?.dogId ?? null
  const has = (fieldId: string, appliesTo: string) => values.some(v => {
    if (v.fieldId !== fieldId) return false
    if (!v.value || !v.value.trim()) return false
    if (appliesTo === 'DOG') return primaryDog ? v.dogId === primaryDog : true
    return v.dogId === null
  })
  c.profileComplete = requiredFields.every(f => has(f.id, f.appliesTo))
}

/**
 * Decide whether a single rule fires given the loaded counters.
 * Returns the snapshot value to persist alongside the award (eg the session
 * count that earned it), or null if the rule does not yet qualify.
 */
function evaluate(type: AchievementTrigger, threshold: number | null, c: ClientCounters): number | null {
  const v = threshold ?? 1
  switch (type) {
    case 'FIRST_SESSION':
      return c.sessionsCompleted >= 1 ? c.sessionsCompleted : null
    case 'SESSIONS_COMPLETED':
      return c.sessionsCompleted >= v ? c.sessionsCompleted : null
    case 'IN_PERSON_SESSIONS':
      return c.sessionsCompletedInPerson >= v ? c.sessionsCompletedInPerson : null
    case 'VIRTUAL_SESSIONS':
      return c.sessionsCompletedVirtual >= v ? c.sessionsCompletedVirtual : null
    case 'CONSECUTIVE_SESSIONS_ATTENDED':
      return c.consecutiveCompletedFromMostRecent >= v ? c.consecutiveCompletedFromMostRecent : null
    case 'FIRST_PACKAGE_ASSIGNED':
      return c.hasAnyPackage ? 1 : null
    case 'PACKAGES_COMPLETED':
      return c.packagesCompleted >= v ? c.packagesCompleted : null
    case 'FIRST_HOMEWORK_DONE':
      return c.homeworkDone >= 1 ? c.homeworkDone : null
    case 'HOMEWORK_TASKS_DONE':
      return c.homeworkDone >= v ? c.homeworkDone : null
    case 'HOMEWORK_STREAK_DAYS':
      return c.homeworkStreakDays >= v ? c.homeworkStreakDays : null
    case 'PERFECT_WEEK':
      return c.perfectWeeks >= v ? c.perfectWeeks : null
    case 'CLIENT_ANNIVERSARY_DAYS':
      return c.daysAsClient >= v ? c.daysAsClient : null
    case 'MESSAGES_SENT':
      return c.messagesSentByClient >= v ? c.messagesSentByClient : null
    case 'PRODUCTS_PURCHASED':
      return c.productsPurchased >= v ? c.productsPurchased : null
    case 'PROFILE_COMPLETED':
      return c.profileComplete ? 1 : null
    case 'MANUAL':
      return null
  }
}

export interface AchievementProgress {
  current: number
  target: number
}

/**
 * Per-rule progress snapshot — used by the client home view to render partial
 * progress bars on unearned achievements (e.g. "5 sessions together" with 1
 * session shows 1/5). Mirrors `evaluate` in shape; returns null for triggers
 * that have no meaningful counter (MANUAL).
 */
function progressFor(
  type: AchievementTrigger,
  threshold: number | null,
  c: ClientCounters,
): AchievementProgress | null {
  const t = threshold ?? 1
  switch (type) {
    case 'FIRST_SESSION':
      return { current: Math.min(c.sessionsCompleted, 1), target: 1 }
    case 'SESSIONS_COMPLETED':
      return { current: c.sessionsCompleted, target: t }
    case 'IN_PERSON_SESSIONS':
      return { current: c.sessionsCompletedInPerson, target: t }
    case 'VIRTUAL_SESSIONS':
      return { current: c.sessionsCompletedVirtual, target: t }
    case 'CONSECUTIVE_SESSIONS_ATTENDED':
      return { current: c.consecutiveCompletedFromMostRecent, target: t }
    case 'FIRST_PACKAGE_ASSIGNED':
      return { current: c.hasAnyPackage ? 1 : 0, target: 1 }
    case 'PACKAGES_COMPLETED':
      return { current: c.packagesCompleted, target: t }
    case 'FIRST_HOMEWORK_DONE':
      return { current: Math.min(c.homeworkDone, 1), target: 1 }
    case 'HOMEWORK_TASKS_DONE':
      return { current: c.homeworkDone, target: t }
    case 'HOMEWORK_STREAK_DAYS':
      return { current: c.homeworkStreakDays, target: t }
    case 'PERFECT_WEEK':
      return { current: c.perfectWeeks, target: t }
    case 'CLIENT_ANNIVERSARY_DAYS':
      return { current: c.daysAsClient, target: t }
    case 'MESSAGES_SENT':
      return { current: c.messagesSentByClient, target: t }
    case 'PRODUCTS_PURCHASED':
      return { current: c.productsPurchased, target: t }
    case 'PROFILE_COMPLETED':
      return { current: c.profileComplete ? 1 : 0, target: 1 }
    case 'MANUAL':
      return null
  }
}

/**
 * Returns a map of achievementId → { current, target } for every published
 * auto-rule of the trainer that owns this client. The view uses this to draw
 * partial progress bars on badges the client is working towards.
 */
export async function computeAchievementProgress(
  clientId: string,
): Promise<Record<string, AchievementProgress>> {
  const client = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: { id: true, trainerId: true, createdAt: true, userId: true },
  })
  if (!client) return {}

  const rules = await prisma.achievement.findMany({
    where: {
      trainerId: client.trainerId,
      published: true,
      triggerType: { not: 'MANUAL' },
    },
    select: { id: true, triggerType: true, triggerValue: true },
  })
  if (rules.length === 0) return {}

  const need = new Set(rules.map(r => r.triggerType))
  const counters = await loadCounters(
    client.id,
    client.userId,
    client.trainerId,
    client.createdAt,
    need,
  )

  const out: Record<string, AchievementProgress> = {}
  for (const rule of rules) {
    const p = progressFor(rule.triggerType, rule.triggerValue, counters)
    if (p) out[rule.id] = p
  }
  return out
}

/**
 * Re-evaluate every active client of the trainer that owns this achievement.
 * Used when a trainer creates a new auto-rule (retroactive backfill) and by
 * the daily cron sweep.
 */
export async function evaluateAchievementForAllClients(achievement: Achievement): Promise<number> {
  if (achievement.triggerType === 'MANUAL') return 0
  if (!achievement.published) return 0
  const clients = await prisma.clientProfile.findMany({
    where: { trainerId: achievement.trainerId, status: 'ACTIVE' },
    select: { id: true },
  })
  let total = 0
  for (const c of clients) {
    const wins = await evaluateAchievementsFor(c.id)
    total += wins.length
  }
  return total
}

/**
 * Don't let a write-point fail because the achievement engine threw.
 * Caller is expected to fire-and-forget; we swallow errors so the parent
 * mutation succeeds even if rule evaluation hits a snag.
 */
export async function safeEvaluate(clientId: string | null | undefined): Promise<void> {
  if (!clientId) return
  try { await evaluateAchievementsFor(clientId) } catch {}
}
