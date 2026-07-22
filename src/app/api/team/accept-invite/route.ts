import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const schema = z.object({ token: z.string().min(1) })

// Accept a team invite as someone who ALREADY has a PupManager login — the
// contractor case: they own a business (or are another trainer's client) and
// have been added to a second business's team.
//
// The new-user path doesn't come through here: those invitees set a password,
// and /api/auth/set-password marks their membership accepted. This route is for
// people who have nothing to set up and just need the membership switched on.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  const record = await prisma.verificationToken.findUnique({ where: { token: parsed.data.token } })
  if (!record) return NextResponse.json({ error: 'This invite link is no longer valid.' }, { status: 400 })
  if (record.expires < new Date()) {
    return NextResponse.json({ error: 'This invite has expired — ask them to resend it.' }, { status: 400 })
  }

  // The invite was issued to an email address. It may only be accepted by the
  // person signed in as that address — otherwise anyone holding the link could
  // graft themselves onto someone else's business.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  })
  if (!user || user.email.toLowerCase() !== record.identifier.toLowerCase()) {
    return NextResponse.json(
      { error: 'This invite was sent to a different email address. Sign in as that account to accept it.' },
      { status: 403 },
    )
  }

  const membership = await prisma.trainerMembership.findFirst({
    where: { userId: session.user.id, acceptedAt: null },
    select: { id: true, companyId: true },
    orderBy: { invitedAt: 'desc' },
  })
  if (!membership) {
    return NextResponse.json({ error: 'There is no pending invite on this account.' }, { status: 404 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.trainerMembership.update({
      where: { id: membership.id },
      data: { acceptedAt: new Date() },
    })
    // Single-use.
    await tx.verificationToken.delete({ where: { token: parsed.data.token } })
  })

  return NextResponse.json({ ok: true, companyId: membership.companyId })
}
