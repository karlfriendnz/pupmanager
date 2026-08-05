import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DEMO_IDLE_MINUTES, NotADemoTenantError, purgeDemoTenant } from '@/lib/demo-tenant'

// Sweeps up abandoned trade-show sandboxes.
//
// Nobody at a stand presses "exit" — they hand the phone back and walk off — so
// this, not the exit button, is the cleanup path that actually runs. Three
// kinds of sandbox are collected:
//
//   ENDED   they did press exit but the delete failed at the time
//   expired past the hard cap, however busy the tab looked
//   idle    nothing has touched the heartbeat for DEMO_IDLE_MINUTES
//
// Bearer-authed with CRON_SECRET and scheduled via Supabase pg_cron, like every
// other job here (see the accompanying migration — never vercel.json crons).
//
// SAFETY: this route picks candidates by the marker column and then hands each
// one to `purgeDemoTenant`, which re-derives every check for itself. The query
// below is a shortlist, not an authority — a bug in this WHERE clause cannot
// delete a real business, because the function it calls would refuse.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Bounded per run; the next tick takes the rest. */
const BATCH = 50

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const now = new Date()
  const idleCutoff = new Date(now.getTime() - DEMO_IDLE_MINUTES * 60_000)

  const due = await prisma.demoSession.findMany({
    where: {
      trainerId: { not: null },
      OR: [
        { status: 'ENDED' },
        { status: 'ACTIVE', expiresAt: { lte: now } },
        { status: 'ACTIVE', lastSeenAt: { lte: idleCutoff } },
      ],
    },
    select: { id: true, trainerId: true },
    orderBy: { expiresAt: 'asc' },
    take: BATCH,
  })

  let purged = 0
  let refused = 0
  const failures: string[] = []

  for (const s of due) {
    if (!s.trainerId) continue
    try {
      await purgeDemoTenant(prisma, s.trainerId)
      purged++
    } catch (err) {
      if (err instanceof NotADemoTenantError) {
        // Not a demo tenant, or the pairing does not hold. Never force it —
        // detach instead, so the sweep stops re-reading a row it must not act
        // on and somebody can look at why.
        refused++
        console.error('[purge-demo] REFUSED', err.message)
        await prisma.demoSession.update({
          where: { id: s.id },
          data: { status: 'FAILED', endedAt: new Date(), trainerId: null, entryTokenHash: null },
        }).catch(() => {})
        continue
      }
      failures.push(s.id)
      console.error('[purge-demo] failed to purge session', s.id, err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ ok: true, scanned: due.length, purged, refused, failures: failures.length })
}
