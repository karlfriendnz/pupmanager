import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ACTIVE_TRAINER_COOKIE } from '@/lib/client-context'

// /switch-trainer/[clientId] — a client with multiple trainer relationships
// picks which one is active. Verifies the profile belongs to the signed-in
// user, pins it via the cookie, and bounces to /home.

const COOKIE_TTL_SECONDS = 60 * 60 * 24 * 365

export async function GET(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const { clientId } = await ctx.params
  const profile = await prisma.clientProfile.findFirst({
    where: { id: clientId, userId: session.user.id },
    select: { id: true },
  })
  if (!profile) {
    return NextResponse.redirect(new URL('/home', req.url))
  }

  const response = NextResponse.redirect(new URL('/home', req.url))
  response.cookies.set(ACTIVE_TRAINER_COOKIE, clientId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_TTL_SECONDS,
  })
  return response
}
