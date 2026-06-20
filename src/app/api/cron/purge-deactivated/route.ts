import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { recordAudit } from '@/lib/audit'

// Finalises self-serve account deletions. A deleted account is soft-deleted
// (deactivatedAt set) for a 30-day grace window so it can be reinstated; this
// cron hard-deletes the ones whose window has passed. Prisma cascades remove
// the user's owned data. Each purge is audited (the audit row survives because
// AuditLog has no FK to users). Bearer-authed with CRON_SECRET like the other
// crons; scheduled via Supabase pg_cron (see the accompanying migration).
const GRACE_DAYS = 30

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000)
  const due = await prisma.user.findMany({
    where: { deactivatedAt: { not: null, lte: cutoff } },
    select: { id: true },
    take: 200, // bounded per run; the next tick picks up the rest
  })

  let purged = 0
  for (const u of due) {
    try {
      await prisma.user.delete({ where: { id: u.id } })
      await recordAudit({ action: 'ACCOUNT_DELETED', actorUserId: u.id, targetType: 'user', targetId: u.id })
      purged++
    } catch (err) {
      console.error('[purge-deactivated] failed to delete user', u.id, err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ ok: true, purged, scanned: due.length })
}
