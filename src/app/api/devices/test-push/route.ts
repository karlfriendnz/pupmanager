import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const tokens = await prisma.deviceToken.findMany({
      where: { userId: session.user.id, platform: 'IOS' },
    })

    if (tokens.length === 0) {
      return NextResponse.json({
        ok: false,
        reason: 'no-devices',
        message: 'No iOS devices are registered for your account yet. Open the app on iPhone, allow notifications, then try again.',
      })
    }

    const results = await sendApns(
      tokens.map(t => t.token),
      {
        alert: { title: 'PupManager test', body: 'Push notifications are working ✅' },
        customData: { type: 'test' },
      },
    )

    const stale = results.filter(r => !r.ok && r.reason && INVALID_TOKEN_REASONS.has(r.reason)).map(r => r.token)
    if (stale.length > 0) {
      await prisma.deviceToken.deleteMany({ where: { token: { in: stale } } })
    }

    const sent = results.filter(r => r.ok).length
    return NextResponse.json({
      ok: sent > 0,
      sent,
      failed: results.length - sent,
      invalidated: stale.length,
      details: results.map(r => ({ ok: r.ok, status: r.status, reason: r.reason })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[test-push] crashed:', message, stack)
    return NextResponse.json({ ok: false, reason: 'crash', message, stack }, { status: 500 })
  }
}
