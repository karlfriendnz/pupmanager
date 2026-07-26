import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { getDayStops } from '@/lib/route-day'

// Every stop for a given day — 1:1 visits, classes, casual classes, events and
// daycare — optionally filtered to one trainer member. Drives the route
// manager's day switcher.
export async function GET(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const url = new URL(req.url)
  const date = url.searchParams.get('date')
  const memberId = url.searchParams.get('memberId')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  const profile = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { user: { select: { timezone: true } } },
  })
  const tz = profile?.user.timezone ?? 'Pacific/Auckland'

  const stops = await getDayStops(ctx.companyId, date, tz, memberId)
  return NextResponse.json({ stops })
}
