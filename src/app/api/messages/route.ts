import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  clientId: z.string().min(1),
  body: z.string().min(1).max(2000),
  channel: z.enum(['TRAINER_CLIENT', 'TRAINER_TRAINER']).default('TRAINER_CLIENT'),
})

// GET /api/messages?clientId=xxx — fetch thread for a client
export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })

  if (trainerProfile) {
    // Trainer: verify client belongs to them
    const client = await prisma.clientProfile.findFirst({
      where: { id: clientId, trainerId: trainerProfile.id },
    })
    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } else {
    // Client: verify they are the client
    const clientProfile = await prisma.clientProfile.findFirst({
      where: { id: clientId, userId: session.user.id },
    })
    if (!clientProfile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const messages = await prisma.message.findMany({
    where: { clientId, channel: 'TRAINER_CLIENT' },
    include: { sender: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  })

  // Mark unread messages as read for the current user
  const unreadIds = messages
    .filter(m => !m.readAt && m.senderId !== session.user.id)
    .map(m => m.id)
  if (unreadIds.length > 0) {
    await prisma.message.updateMany({
      where: { id: { in: unreadIds } },
      data: { readAt: new Date() },
    })
  }

  return NextResponse.json(messages)
}

// POST /api/messages — send a message
export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { clientId, body: msgBody, channel } = parsed.data

  // Validate sender is either the trainer for this client, or the client themselves
  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })

  if (trainerProfile) {
    const client = await prisma.clientProfile.findFirst({
      where: { id: clientId, trainerId: trainerProfile.id },
    })
    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } else {
    const clientProfile = await prisma.clientProfile.findFirst({
      where: { id: clientId, userId: session.user.id },
    })
    if (!clientProfile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const message = await prisma.message.create({
    data: {
      clientId,
      senderId: session.user.id,
      body: msgBody,
      channel,
    },
    include: { sender: { select: { name: true, email: true } } },
  })

  return NextResponse.json(message, { status: 201 })
}
