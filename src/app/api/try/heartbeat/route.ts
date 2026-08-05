import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// POST /api/try/heartbeat — "someone is still using this sandbox".
//
// The demo bar pings this while the tab is visible. It is what makes the IDLE
// timeout mean anything: without it every sandbox would look abandoned the
// moment it was created, or (worse) never look abandoned at all.
//
// Deliberately cannot EXTEND the hard expiry. A phone left face-up on the stand
// with the screen awake would otherwise keep its sandbox alive all weekend.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await auth()
  if (!session?.user?.trainerId || !session.user.isDemo) {
    return NextResponse.json({ ok: false }, { status: 204 })
  }

  await prisma.demoSession.updateMany({
    where: { trainerId: session.user.trainerId, status: 'ACTIVE' },
    data: { lastSeenAt: new Date() },
  })

  return NextResponse.json({ ok: true, expiresAt: session.user.demoExpiresAt ?? null })
}
