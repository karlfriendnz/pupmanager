import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { canUseProfile, PROFILE_COOKIE, type ProfileSide } from '@/lib/account-access'

export const runtime = 'nodejs'

/**
 * The form POST behind /choose-account.
 *
 * A sibling of /api/profile/switch, which the menu button uses. That one speaks
 * JSON and returns a redirect target for the client to follow; this one takes a
 * plain form submit and answers with a real redirect, because /choose-account
 * renders before any shell and should not need JavaScript to work.
 *
 * A form rather than a link on purpose: a GET route that sets a cookie gets
 * prefetched, and the browser would quietly choose for them.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.redirect(new URL('/login', req.url))

  const form = await req.formData().catch(() => null)
  const raw = form?.get('side')
  const side: ProfileSide | null = raw === 'trainer' || raw === 'client' ? raw : null
  if (!side) return NextResponse.redirect(new URL('/choose-account', req.url))

  // Verified, so a hand-posted form cannot put someone on a side they cannot
  // reach. The layouts re-derive access on every request anyway, so the worst
  // this could do is bounce them — but it should not even do that.
  if (!(await canUseProfile(session.user.id, side))) {
    return NextResponse.redirect(new URL('/choose-account', req.url))
  }

  const res = NextResponse.redirect(new URL(side === 'trainer' ? '/dashboard' : '/home', req.url))
  res.cookies.set(PROFILE_COOKIE, side, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return res
}
