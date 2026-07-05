import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'

// Lightweight "is the current member's Google Calendar connected?" check — the
// add-on promo modal uses it to switch between Connect and Connected·Disconnect.
export async function GET() {
  const ctx = await getTrainerContext()
  if (!ctx?.membershipId) return NextResponse.json({ connected: false })

  const conn = await prisma.googleCalendarConnection.findUnique({
    where: { membershipId: ctx.membershipId },
    select: { id: true },
  })
  return NextResponse.json({ connected: !!conn })
}
