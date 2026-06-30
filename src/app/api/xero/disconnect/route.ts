import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'

// Disconnect Xero. Owner-only + same-origin. Deleting the connection row IS the
// disconnect — no row == not connected. (Xero refresh tokens expire on their own
// 60 days after last use, so we don't need to revoke server-side.)
export async function POST(req: Request) {
  const csrf = requireSameOrigin(req)
  if (csrf) return csrf

  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  await prisma.xeroConnection.deleteMany({ where: { trainerId: session.user.trainerId } })
  return NextResponse.json({ ok: true })
}
