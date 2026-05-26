import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { setSessionCookie } from '@/lib/session-cookie'

// GET /api/admin/impersonate/[trainerId] — "Log in as this trainer".
//
// Admin-only. Re-issues the caller's session cookie as the target trainer so
// the whole app behaves exactly as that trainer (subject to the same role +
// permission checks). The admin's own id is stamped into the new JWT as
// `impersonatorId` — carried encrypted, so it can't be forged — which powers
// the "Exit impersonation" banner and the /api/impersonate/stop restore route.
//
// [trainerId] is the trainer's User.id (the id the admin trainers table keys
// its rows off — see (admin)/admin/trainers/page.tsx).
export async function GET(
  req: Request,
  ctx: { params: Promise<{ trainerId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const { trainerId } = await ctx.params
  const target = await prisma.user.findUnique({
    where: { id: trainerId },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!target || target.role !== 'TRAINER') {
    return NextResponse.redirect(new URL('/admin/trainers', req.url))
  }

  const res = NextResponse.redirect(new URL('/dashboard', req.url))
  await setSessionCookie(res, {
    id: target.id,
    sub: target.id,
    role: 'TRAINER',
    name: target.name,
    email: target.email,
    impersonatorId: session.user.id,
  })
  return res
}
