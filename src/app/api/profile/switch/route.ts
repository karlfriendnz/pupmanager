import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { canUseProfile, PROFILE_COOKIE, type ProfileSide } from '@/lib/account-access'

export const runtime = 'nodejs'

const schema = z.object({ side: z.enum(['trainer', 'client']) })

// Switch which surface this person is looking at — their own business, or
// their client account with another trainer. Only meaningful for people who
// hold both relationships.
//
// The cookie this sets is a routing hint for middleware. Access itself is
// re-derived from the database in the (trainer)/(client) layouts on every
// request, so setting it for a side you can't reach just bounces you back.
// We verify here anyway so the UI can't put you in a broken state.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  const side: ProfileSide = parsed.data.side

  if (!(await canUseProfile(session.user.id, side))) {
    return NextResponse.json({ error: `You don't have a ${side} account.` }, { status: 403 })
  }

  const res = NextResponse.json({ ok: true, side, redirectTo: side === 'trainer' ? '/dashboard' : '/home' })
  res.cookies.set(PROFILE_COOKIE, side, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return res
}
