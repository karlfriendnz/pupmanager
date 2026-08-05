import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NotADemoTenantError, purgeDemoTenant } from '@/lib/demo-tenant'

// POST /api/try/exit — the visitor pressed "Finish demo".
//
// Destroys the sandbox there and then rather than waiting for the sweep, so the
// next person at the stand cannot pick up the phone and be inside the last
// person's workspace. The lead is untouched.
//
// Authorised by the SESSION, not by an id in the body: you can only end the
// sandbox you are signed into. A signed-in real trainer hitting this gets a
// 403, and even if that check were wrong `purgeDemoTenant` would refuse the
// tenant for want of the demo markers.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await auth()
  if (!session?.user?.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  if (!session.user.isDemo) {
    return NextResponse.json({ error: 'Not a demo session' }, { status: 403 })
  }

  const trainerId = session.user.trainerId

  // Mark it ended first. If the delete then fails, the sweep still knows this
  // one is finished with and will try again.
  await prisma.demoSession.updateMany({
    where: { trainerId, status: 'ACTIVE' },
    data: { status: 'ENDED', endedAt: new Date() },
  })

  try {
    const result = await purgeDemoTenant(prisma, trainerId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof NotADemoTenantError) {
      // The session says demo and the tenant says otherwise. Refuse loudly —
      // this is exactly the disagreement the purge exists to stop.
      console.error('[try/exit] refused', err.message)
      return NextResponse.json({ error: 'Not a demo session' }, { status: 403 })
    }
    console.error('[try/exit] purge failed', err)
    // The sweep will collect it. Tell the visitor it worked, because from where
    // they stand it did: they are about to be signed out either way.
    return NextResponse.json({ ok: true, deferred: true })
  }
}
