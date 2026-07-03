import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { overlapsAnyBusy } from '@/lib/google-calendar-sync'

// Read the CURRENT member's imported Google "busy" blocks overlapping a time
// range, for the soft (non-blocking) double-booking warning in the schedule
// create/edit flow. Returns { overlap, busy: [{startsAt,endsAt}] }. Never a hard
// error surface — an unauthenticated / unconnected member just gets overlap:false.
export async function GET(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx || !ctx.membershipId) return NextResponse.json({ overlap: false, busy: [] })

  const { searchParams } = new URL(req.url)
  const startRaw = searchParams.get('start')
  const endRaw = searchParams.get('end')
  // Default to the whole imported window (now → ~63 days) when no range is given,
  // so the schedule grid can load every block in one shot; the create/edit
  // overlap-warning callers pass a specific slot range.
  const start = startRaw ? new Date(startRaw) : new Date()
  const end = endRaw ? new Date(endRaw) : new Date(Date.now() + 63 * 24 * 60 * 60 * 1000)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
    return NextResponse.json({ overlap: false, busy: [] })
  }

  // Blocks that intersect [start,end): startsAt < end AND endsAt > start.
  const blocks = await prisma.googleBusyBlock.findMany({
    where: { membershipId: ctx.membershipId, startsAt: { lt: end }, endsAt: { gt: start } },
    select: { startsAt: true, endsAt: true },
    orderBy: { startsAt: 'asc' },
    take: 500,
  })

  return NextResponse.json({
    overlap: overlapsAnyBusy(blocks, start, end),
    busy: blocks.map((b) => ({ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString() })),
  })
}
