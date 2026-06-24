import { prisma } from '@/lib/prisma'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import type { NotificationType, NotificationChannel } from '@/generated/prisma'

export interface ResolvedPref {
  enabled: boolean
  minutesBefore: number | null
  dailyAtHour: number | null
  title: string
  body: string
}

type PrefRowish = {
  enabled: boolean
  minutesBefore: number | null
  dailyAtHour: number | null
  customTitle: string | null
  customBody: string | null
} | null

function merge(meta: typeof NOTIFICATION_TYPES[NotificationType], stored: PrefRowish): ResolvedPref {
  return {
    enabled: stored?.enabled ?? meta.defaults.enabled,
    minutesBefore: stored?.minutesBefore ?? meta.defaults.minutesBefore ?? null,
    dailyAtHour: stored?.dailyAtHour ?? meta.defaults.dailyAtHour ?? null,
    title: stored?.customTitle ?? meta.defaults.title,
    body: stored?.customBody ?? meta.defaults.body,
  }
}

// Resolves the full effective preference for (user, type, channel), optionally
// scoped to an organisation. Resolution order: the per-org override row →ﾠthe
// user's global row (companyId null, which is also every pre-multi-org row) →
// the type's defaults. So a trainer in two orgs can tune each independently
// while their existing settings act as the shared baseline.
export async function resolvePref(
  userId: string,
  type: NotificationType,
  channel: NotificationChannel,
  companyId: string | null = null,
): Promise<ResolvedPref> {
  const meta = NOTIFICATION_TYPES[type]
  const rows = await prisma.notificationPreference.findMany({
    where: companyId
      ? { userId, type, channel, OR: [{ companyId }, { companyId: null }] }
      : { userId, type, channel, companyId: null },
  })
  const stored = rows.find(r => r.companyId === companyId) ?? rows.find(r => r.companyId === null) ?? null
  return merge(meta, stored)
}

// Same as resolvePref but for many (user, org) pairs at once — one round-trip
// for a batch of trainers. Each pair carries its own companyId so a member is
// resolved against the notifying org's prefs (org override → global → default).
export async function resolvePrefsForPairs(
  pairs: { userId: string; companyId: string | null }[],
  type: NotificationType,
  channel: NotificationChannel,
): Promise<Map<string, ResolvedPref>> {
  const meta = NOTIFICATION_TYPES[type]
  const userIds = Array.from(new Set(pairs.map(p => p.userId)))
  const stored = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds }, type, channel },
  })
  // key: `${userId}:${companyId ?? ''}`
  const byKey = new Map(stored.map(s => [`${s.userId}:${s.companyId ?? ''}`, s]))

  const key = (uid: string, cid: string | null) =>
    byKey.get(`${uid}:${cid ?? ''}`) ?? byKey.get(`${uid}:`) ?? null

  return new Map(pairs.map(({ userId, companyId }) => [
    `${userId}:${companyId ?? ''}`,
    merge(meta, key(userId, companyId)),
  ]))
}
