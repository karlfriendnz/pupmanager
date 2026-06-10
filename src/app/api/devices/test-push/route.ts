import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPush } from '@/lib/push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { sent, total, results } = await sendPush(session.user.id, {
      alert: { title: 'PupManager test', body: 'Push notifications are working ✅' },
      customData: { type: 'test' },
    })

    if (total === 0) {
      return NextResponse.json({
        ok: false,
        reason: 'no-devices',
        message: 'No devices are registered for your account yet. Open the app, allow notifications, then try again.',
      })
    }

    return NextResponse.json({
      ok: sent > 0,
      sent,
      failed: total - sent,
      details: results.map(r => ({ platform: r.platform, ok: r.ok, status: r.status, reason: r.reason })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[test-push] crashed:', message, stack)
    return NextResponse.json({ ok: false, reason: 'crash', message, stack }, { status: 500 })
  }
}
