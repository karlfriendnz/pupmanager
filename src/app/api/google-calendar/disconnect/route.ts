import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'
import { getTrainerContext } from '@/lib/membership'
import { revokeGoogleTokens } from '@/lib/google-calendar'

// Disconnect Google Calendar for the CURRENT member (per-staff) + same-origin.
// We revoke the grant on Google's side (so PupManager is removed from that
// member's connected apps), then delete the local connection row + their imported
// busy blocks. The revoke is best-effort — if Google is unreachable we still drop
// the local record.
export async function POST(req: Request) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const ctx = await getTrainerContext()
  if (!ctx || !ctx.membershipId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const membershipId = ctx.membershipId

  const connection = await prisma.googleCalendarConnection.findUnique({ where: { membershipId } })
  if (connection) {
    try {
      await revokeGoogleTokens(connection)
    } catch (err) {
      console.error('[google-calendar] revoke on disconnect failed', err)
    }
  }

  await prisma.googleCalendarConnection.deleteMany({ where: { membershipId } })
  await prisma.googleBusyBlock.deleteMany({ where: { membershipId } })
  return NextResponse.json({ ok: true })
}
