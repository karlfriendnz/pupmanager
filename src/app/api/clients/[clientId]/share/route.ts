import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  partnerEmail: z.string().email(),
  shareType: z.enum(['READ_ONLY', 'CO_MANAGE', 'TRANSFER']),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { clientId } = await params
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const { partnerEmail, shareType } = parsed.data

  const myProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!myProfile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // Verify this trainer owns the client
  const client = await prisma.clientProfile.findFirst({
    where: { id: clientId, trainerId: myProfile.id },
  })
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // Find the partner trainer
  const partnerUser = await prisma.user.findUnique({
    where: { email: partnerEmail, role: 'TRAINER' },
    include: { trainerProfile: { select: { id: true } } },
  })
  if (!partnerUser?.trainerProfile) {
    return NextResponse.json({ error: 'No trainer account found with that email.' }, { status: 404 })
  }

  const partnerProfileId = partnerUser.trainerProfile.id

  // Create the share record
  await prisma.clientShare.create({
    data: {
      clientId: client.id,
      sharedById: myProfile.id,
      sharedWithId: partnerProfileId,
      shareType,
    },
  })

  // If transfer: update primary trainer
  if (shareType === 'TRANSFER') {
    await prisma.clientProfile.update({
      where: { id: client.id },
      data: { trainerId: partnerProfileId },
    })
  }

  // Notify partner (fire-and-forget)
  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: partnerEmail,
    subject: `A client has been ${shareType === 'TRANSFER' ? 'transferred' : 'shared'} with you on PupManager`,
    html: `<p>Log in to PupManager to view the client's profile and training history.</p>`,
  }).catch(() => null) // non-critical

  return NextResponse.json({ ok: true })
}
