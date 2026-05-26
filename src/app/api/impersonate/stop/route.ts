import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { setSessionCookie } from '@/lib/session-cookie'

// GET /api/impersonate/stop — end an admin impersonation session and restore
// the admin's own session.
//
// The admin's id comes from `impersonatorId` on the *current* (impersonated)
// session, which lives inside the encrypted Auth.js JWT — so a regular trainer
// can't reach this and escalate by guessing an admin id. We still re-verify
// the restored user is actually an ADMIN before minting their session.
export async function GET(req: Request) {
  const session = await auth()
  const impersonatorId = session?.user?.impersonatorId
  if (!impersonatorId) {
    // Not impersonating — nothing to restore. Send them home.
    return NextResponse.redirect(new URL('/', req.url))
  }

  const admin = await prisma.user.findUnique({
    where: { id: impersonatorId },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!admin || admin.role !== 'ADMIN') {
    // Linkage is stale or the account is no longer an admin — fall back to a
    // clean re-login rather than minting anything.
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const res = NextResponse.redirect(new URL('/admin/trainers', req.url))
  await setSessionCookie(res, {
    id: admin.id,
    sub: admin.id,
    role: 'ADMIN',
    name: admin.name,
    email: admin.email,
  })
  return res
}
