import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
})

export async function POST(req: Request) {
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { token, email } = parsed.data

  const record = await prisma.verificationToken.findUnique({ where: { token } })

  if (!record || record.identifier !== email) {
    return NextResponse.json({ error: 'Invalid invitation token.' }, { status: 400 })
  }

  if (record.expires < new Date()) {
    return NextResponse.json({ error: 'Invitation has expired.' }, { status: 410 })
  }

  // Mark email as verified and delete the invite token. For invited team
  // members, also stamp their membership as accepted (idempotent updateMany —
  // a no-op for client invites, which have no membership).
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  await prisma.$transaction([
    prisma.user.update({
      where: { email },
      data: { emailVerified: new Date() },
    }),
    ...(user
      ? [prisma.trainerMembership.updateMany({
          where: { userId: user.id, acceptedAt: null },
          data: { acceptedAt: new Date() },
        })]
      : []),
    prisma.verificationToken.delete({
      where: { token },
    }),
  ])

  return NextResponse.json({ ok: true })
}
