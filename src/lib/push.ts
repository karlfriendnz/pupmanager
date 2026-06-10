import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { sendFcm, FCM_INVALID_TOKEN_REASONS } from '@/lib/fcm'

interface PushPayload {
  alert: { title: string; body: string }
  customData?: Record<string, unknown>
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

  const [iosResults, androidResults] = await Promise.all([
    ios.length ? sendApns(ios, payload) : Promise.resolve([]),
    android.length ? sendFcm(android, payload) : Promise.resolve([]),
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
