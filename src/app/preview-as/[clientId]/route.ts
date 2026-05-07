import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PREVIEW_COOKIE } from '@/lib/client-context'

// /preview-as/[clientId] — entry point for "view the client app as this
// client". Drops the preview cookie and bounces the trainer to /home, where
// the (client) layout takes over and renders everything as that client sees
// it (with a banner + Exit preview button).

const PREVIEW_TTL_SECONDS = 60 * 60

export async function GET(
  req: Request,
  ctx: { params: Promise<{ clientId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const { clientId } = await ctx.params
  const client = await prisma.clientProfile.findFirst({
    where: { id: clientId, trainerId: session.user.trainerId },
    select: { id: true },
  })
  if (!client) {
    return NextResponse.redirect(new URL('/clients', req.url))
  }

  // The cookie has to be set on the response itself — `cookies()` from
  // next/headers won't ride along on a redirect from a route handler.
  const response = NextResponse.redirect(new URL('/home', req.url))
  response.cookies.set(PREVIEW_COOKIE, clientId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: PREVIEW_TTL_SECONDS,
  })
  return response
}
