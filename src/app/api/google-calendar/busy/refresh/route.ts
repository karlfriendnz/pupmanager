import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'
import { getTrainerContext } from '@/lib/membership'
import { refreshBusyForMembership } from '@/lib/google-calendar-sync'

// Background "freshen my busy times" for the schedule grid. The page SSRs the
// cached blocks (instant), then calls this after mount to pull the member's
// CURRENT Google calendar (live FreeBusy → re-persist), and returns the fresh
// window so the grey strips update within a second or two — without waiting for
// the 3-hourly cron. Best-effort: any failure returns an empty set, never errors.
export async function POST(req: Request) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const ctx = await getTrainerContext()
  if (!ctx || !ctx.membershipId) return NextResponse.json({ busy: [] })

  try {
    // Live FreeBusy for the member's now → ~60-day window, delete + reinsert.
    // No-ops (returns 0) when they're not connected / the add-on is off.
    await refreshBusyForMembership(ctx.membershipId)

    const now = new Date()
    const end = new Date(Date.now() + 63 * 24 * 60 * 60 * 1000)
    const blocks = await prisma.googleBusyBlock.findMany({
      where: { membershipId: ctx.membershipId, startsAt: { lt: end }, endsAt: { gt: now } },
      select: { startsAt: true, endsAt: true, title: true },
      orderBy: { startsAt: 'asc' },
      take: 500,
    })
    return NextResponse.json({
      busy: blocks.map((b) => ({ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), title: b.title })),
    })
  } catch (err) {
    console.error('[google-calendar/busy/refresh] failed', err)
    return NextResponse.json({ busy: [] })
  }
}
