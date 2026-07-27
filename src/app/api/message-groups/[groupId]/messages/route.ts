import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getGroupAccess, canPost } from '@/lib/message-group-access'
import { notifyGroupPost } from '@/lib/notify-group-post'
import {
  visibleMessagesWhere,
  visibilityForPost,
  REMOVED_MEMBER_LABEL,
} from '@/lib/message-groups'

// GET  /api/message-groups/<id>/messages — the thread, as this viewer sees it
// POST /api/message-groups/<id>/messages — post into it
//
// The whole BROADCAST/COMMUNITY difference lives in two helpers:
// visibleMessagesWhere (what you may read) and visibilityForPost (what your
// post is written as). There is no second code path to get out of step.

export async function GET(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const access = await getGroupAccess(groupId)
  if (access instanceof NextResponse) return access

  // A COMMUNITY invitation that hasn't been accepted is not consent. Until
  // they opt in they see the invitation, not the conversation — and crucially
  // not the other members.
  const consented = access.isTrainerSide || !!access.participant?.joinedAt
  if (!consented) {
    return NextResponse.json({
      group: { id: groupId, name: access.name, mode: access.mode, joined: false, canPost: false, isTrainerSide: false },
      messages: [],
      participants: [],
    })
  }

  const url = new URL(req.url)
  // Optional lens: only the replies to one broadcast post, which is what the
  // trainer's "who said what" screen drills into.
  const replyTo = url.searchParams.get('replyTo')

  const [rows, participants] = await Promise.all([
    prisma.groupMessage.findMany({
      where: {
        groupId,
        ...visibleMessagesWhere({ userId: access.userId, isTrainerSide: access.isTrainerSide }),
        ...(replyTo ? { replyToId: replyTo } : {}),
      },
      select: {
        id: true, body: true, bodyHtml: true, senderId: true, createdAt: true,
        visibility: true, replyToId: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }),
    prisma.messageGroupParticipant.findMany({
      where: { groupId },
      select: { id: true, userId: true, displayName: true, role: true, joinedAt: true, leftAt: true },
    }),
  ])

  // Display name ONLY. Never the login email, never a phone, never a link
  // through to a client profile — that mapping simply is not in this payload,
  // which is the point.
  const nameOf = new Map(
    participants.map(p => [p.userId, p.leftAt ? REMOVED_MEMBER_LABEL : p.displayName]),
  )

  // Mark read: a watermark, not a per-message flag. Message.readAt is left
  // completely alone — it is a single timestamp that cannot express "read" for
  // N people, and it is also the 1:1 email-fallback trigger.
  if (access.participant) {
    after(async () => {
      // Swallowed deliberately: failing to move a read watermark must never
      // surface as a failed thread load.
      try {
        await prisma.messageGroupParticipant.update({
          where: { id: access.participant!.id },
          data: { lastReadAt: new Date() },
        })
      } catch (err) {
        console.error('[group messages] read watermark', err)
      }
    })
  }

  const liveMembers = participants.filter(p => !p.leftAt && p.joinedAt)
  return NextResponse.json({
    group: {
      id: groupId,
      name: access.name,
      mode: access.mode,
      archivedAt: access.archivedAt,
      isTrainerSide: access.isTrainerSide,
      joined: true,
      canPost: canPost(access),
      memberCount: liveMembers.filter(p => p.role === 'CLIENT').length,
    },
    messages: rows.map(m => ({
      id: m.id,
      body: m.body,
      bodyHtml: m.bodyHtml,
      createdAt: m.createdAt.toISOString(),
      senderId: m.senderId,
      senderName: nameOf.get(m.senderId) ?? REMOVED_MEMBER_LABEL,
      visibility: m.visibility,
      replyToId: m.replyToId,
      isMine: m.senderId === access.userId,
    })),
    // In BROADCAST a client must not learn who else is here, so the member
    // list is trainer-side only.
    participants: access.isTrainerSide || access.mode === 'COMMUNITY'
      ? liveMembers.map(p => ({ id: p.id, displayName: p.displayName, role: p.role }))
      : [],
  })
}

const postSchema = z.object({
  body: z.string().min(1).max(2000),
  /** The broadcast being answered, so a group with three questions in it can
   *  tell which reply belongs to which. */
  replyToId: z.string().min(1).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const access = await getGroupAccess(groupId)
  if (access instanceof NextResponse) return access

  if (access.archivedAt) {
    return NextResponse.json({ error: 'This group is closed.' }, { status: 403 })
  }
  if (!canPost(access)) {
    // A COMMUNITY member who hasn't accepted cannot post — otherwise they
    // would make themselves visible to the others without ever consenting.
    return NextResponse.json({ error: 'Join this group before posting.' }, { status: 403 })
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const body = parsed.data.body.trim()
  if (!body) return NextResponse.json({ error: 'Write something first' }, { status: 400 })

  // A replyTo must be a post in THIS group, or a crafted request could staple
  // a reply onto another group's broadcast.
  let replyToId: string | null = null
  if (parsed.data.replyToId) {
    const parent = await prisma.groupMessage.findFirst({
      where: { id: parsed.data.replyToId, groupId },
      select: { id: true },
    })
    if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    replyToId = parent.id
  }

  const visibility = visibilityForPost(access.mode, access.isTrainerSide)

  // In a BROADCAST group a client is always answering something, even when
  // they just type into the thread — they see one conversation, not a list of
  // questions. Attach an unattributed reply to the most recent thing the
  // business actually said, so it lands against the right question in the
  // trainer's responses view instead of floating loose. Doing it server-side
  // means every client (web, native, anything later) behaves the same.
  if (!replyToId && !access.isTrainerSide && access.mode === 'BROADCAST') {
    const latestBroadcast = await prisma.groupMessage.findFirst({
      where: { groupId, visibility: 'EVERYONE', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    replyToId = latestBroadcast?.id ?? null
  }
  const message = await prisma.groupMessage.create({
    data: { groupId, senderId: access.userId, body, visibility, replyToId },
    select: { id: true, body: true, createdAt: true, senderId: true, visibility: true, replyToId: true },
  })

  await prisma.messageGroup.update({
    where: { id: groupId },
    data: { lastMessageAt: message.createdAt },
  })

  after(async () => {
    await notifyGroupPost({
      groupId,
      messageId: message.id,
      senderId: access.userId,
      body,
      visibility,
      isTrainerSide: access.isTrainerSide,
    })
  })

  return NextResponse.json(
    {
      id: message.id,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      senderId: message.senderId,
      senderName: access.participant?.displayName ?? 'You',
      visibility: message.visibility,
      replyToId: message.replyToId,
      isMine: true,
    },
    { status: 201 },
  )
}
