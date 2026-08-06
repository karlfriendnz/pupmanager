import { NextResponse, after } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { safeEvaluate } from '@/lib/achievements'
import { notifyMessageRecipient } from '@/lib/notify-message-recipient'
import { THREAD_PROPOSAL_SELECT } from '@/lib/thread-proposal'
import {
  attachmentCreateRows,
  attachmentRefsSchema,
  CHAT_ATTACHMENT_SELECT,
  toChatAttachments,
} from '@/lib/message-attachments'
import { z } from 'zod'

const schema = z.object({
  clientId: z.string().min(1),
  // Was `.min(1)`. A photo-only message is a real message — "is this the right
  // harness" is a picture, not a sentence — so the body may be empty PROVIDED
  // something else is being sent. The refine below is what enforces that; the
  // browser's disabled Send button is not a check (AGENTS.md #3).
  body: z.string().max(2000).default(''),
  channel: z.enum(['TRAINER_CLIENT', 'TRAINER_TRAINER']).default('TRAINER_CLIENT'),
  attachments: attachmentRefsSchema,
}).refine(
  v => v.body.trim().length > 0 || (v.attachments?.length ?? 0) > 0,
  { message: 'Write something or add a photo', path: ['body'] },
)

// GET /api/messages?clientId=xxx — fetch thread for a client
export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
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
    // Only the sender's display name — never User.email (the trainer's PRIVATE
    // sign-in address). Clients must only ever see publicEmail, not this one.
    // bookingProposal is null on all but the handful of messages that ARE a
    // counter-offer; those render as an Approve / Suggest-another card.
    include: {
      sender: { select: { name: true } },
      bookingProposal: { select: THREAD_PROPOSAL_SELECT },
      attachments: { select: CHAT_ATTACHMENT_SELECT },
    },
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

  return NextResponse.json(
    messages.map(m => ({ ...m, attachments: toChatAttachments(m.attachments) })),
  )
}

// POST /api/messages — send a message
export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { clientId, channel, attachments } = parsed.data
  const msgBody = parsed.data.body.trim()

  // Validate sender is either the trainer for this client, or the client themselves
  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
    select: { id: true },
  })

  if (trainerProfile) {
    // Trainer/staff sender: gate on the messages.send permission (clients, who
    // have no membership, are validated by ownership below instead).
    const guard = await guardPermission('messages.send')
    if (guard instanceof NextResponse) return guard
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

  // Every photo path must belong to THIS thread. The upload route already
  // proved the sender may write into that prefix; this proves they are not now
  // stapling an image from one conversation onto another.
  const built = attachmentCreateRows(attachments, { kind: 'direct', clientId })
  if (!built.ok) {
    return NextResponse.json({ error: 'Those photos do not belong to this conversation' }, { status: 400 })
  }

  const message = await prisma.message.create({
    data: {
      clientId,
      senderId: session.user.id,
      body: msgBody,
      channel,
      ...(built.rows.length > 0 ? { attachments: { create: built.rows } } : {}),
    },
    include: {
      sender: { select: { name: true, email: true } },
      attachments: { select: CHAT_ATTACHMENT_SELECT },
    },
  })

  // Side effects (achievement evaluation, APNs push) run AFTER the
  // response is sent so the sender's UI gets its message back fast
  // instead of waiting on Apple's HTTP/2 round-trip. Fluid Compute
  // keeps the function alive long enough for `after()` callbacks to
  // finish; if APNs takes 800ms, the client doesn't pay it.
  after(async () => {
    try {
      // MESSAGES_SENT achievement trigger — client-authored messages only.
      if (channel === 'TRAINER_CLIENT' && !trainerProfile) {
        await safeEvaluate(clientId)
      }
      if (channel === 'TRAINER_CLIENT') {
        await notifyMessageRecipient({
          messageId: message.id,
          clientId,
          senderId: session.user.id,
          body: msgBody,
          // A photo-only message has no body at all. Without this the push, the
          // email and the in-app feed row would all say nothing.
          attachmentCount: built.rows.length,
        })
      }
    } catch (err) {
      console.error('[messages POST after]', err)
    }
  })

  // The storage path never leaves the server: photos go back as ids the
  // authorising route resolves (AGENTS.md #5 — props on a client component are
  // page source, and so is a JSON response).
  return NextResponse.json(
    { ...message, attachments: toChatAttachments(message.attachments) },
    { status: 201 },
  )
}
