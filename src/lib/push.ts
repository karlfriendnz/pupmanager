import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { sendFcm, FCM_INVALID_TOKEN_REASONS } from '@/lib/fcm'
import { unreadBadgeCountForUser } from '@/lib/unread-messages'

interface PushPayload {
  alert: { title: string; body: string }
  customData?: Record<string, unknown>
  /**
   * App-icon badge number. Omit to let sendPush stamp the recipient's current
   * unread total automatically (the normal case — see below). Pass an explicit
   * value only to override (e.g. a test push forcing a specific number).
   */
  badge?: number
}

export interface PushResult {
  token: string
  ok: boolean
  status?: number
  reason?: string
  platform: 'IOS' | 'ANDROID'
}

// Send a push to ALL of a user's registered devices — iOS via APNs, Android via
// FCM — and prune any tokens the provider reports as dead. This is the single
// entry point every notification path should use; sending straight to sendApns
// (the old pattern) silently dropped every Android device.
export async function sendPush(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; total: number; results: PushResult[] }> {
  const tokens = await prisma.deviceToken.findMany({
    where: { userId },
    select: { token: true, platform: true },
  })
  if (tokens.length === 0) return { sent: 0, total: 0, results: [] }

  const ios = tokens.filter(t => t.platform === 'IOS').map(t => t.token)
  const android = tokens.filter(t => t.platform === 'ANDROID').map(t => t.token)

  // Stamp the icon badge with the recipient's CURRENT unread total (absolute,
  // not an increment — that's how APNs badges work). A new-message push then
  // shows the right running count, and other push types (reminders, invoices)
  // carry the unchanged unread total so they never wrongly bump the badge. The
  // app zeroes it on open (native @capawesome/capacitor-badge). An explicit
  // payload.badge overrides (test pushes); otherwise compute it here.
  const badge = payload.badge ?? await unreadBadgeCountForUser(userId)
  const withBadge = { ...payload, badge }

  const [iosResults, androidResults] = await Promise.all([
    ios.length ? sendApns(ios, withBadge) : Promise.resolve([]),
    android.length ? sendFcm(android, withBadge) : Promise.resolve([]),
  ])

  const stale: string[] = []
  for (const r of iosResults) if (!r.ok && r.reason && INVALID_TOKEN_REASONS.has(r.reason)) stale.push(r.token)
  for (const r of androidResults) if (!r.ok && r.reason && FCM_INVALID_TOKEN_REASONS.has(r.reason)) stale.push(r.token)
  if (stale.length > 0) await prisma.deviceToken.deleteMany({ where: { token: { in: stale } } })

  const results: PushResult[] = [
    ...iosResults.map(r => ({ ...r, platform: 'IOS' as const })),
    ...androidResults.map(r => ({ ...r, platform: 'ANDROID' as const })),
  ]
  return { sent: results.filter(r => r.ok).length, total: tokens.length, results }
}
