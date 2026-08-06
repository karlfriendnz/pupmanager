import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getGroupAccess } from '@/lib/message-group-access'
import { canSeeResponses, REMOVED_MEMBER_LABEL } from '@/lib/message-groups'
import { CHAT_ATTACHMENT_SELECT, toChatAttachments } from '@/lib/message-attachments'
import { messagePreview } from '@/lib/message-preview'

// GET /api/message-groups/<id>/responses/<messageId>
//
// "Who said what" for one broadcast. In BROADCAST mode every reply is private
// to the trainer, so without this they'd be scattered one per person with no
// way to see the shape of the answer.
//
// Three things it deliberately does:
//   • one row per PARTICIPANT, not per reply — the people who haven't answered
//     are the most useful rows on the screen, because that's the list you chase
//   • no structure imposed on the replies. A broadcast is an open question
//     ("what time suits?", "we're having a Christmas do") and the answers are
//     sentences. There is no tally, because there is nothing to tally.
//   • ?person=<participantId> drills into the private exchange with one person
//     FOR THIS BROADCAST, so the trainer can reply where they read it.
//
// Trainer/staff only in BROADCAST mode, guarded here rather than by the UI
// simply not linking to it — that is the whole guarantee the mode makes.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ groupId: string; messageId: string }> },
) {
  const { groupId, messageId } = await params
  const access = await getGroupAccess(groupId)
  if (access instanceof NextResponse) return access

  if (!canSeeResponses(access.mode, access.isTrainerSide)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const post = await prisma.groupMessage.findFirst({
    where: { id: messageId, groupId, deletedAt: null },
    select: { id: true, body: true, createdAt: true, senderId: true },
  })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const participants = await prisma.messageGroupParticipant.findMany({
    where: { groupId, role: 'CLIENT' },
    select: {
      id: true, userId: true, clientProfileId: true, displayName: true,
      joinedAt: true, leftAt: true,
    },
  })

  const replies = await prisma.groupMessage.findMany({
    where: { groupId, replyToId: messageId, deletedAt: null },
    select: {
      id: true, senderId: true, body: true, createdAt: true,
      // A reply can be a photo with no words at all — both the "last reply"
      // snippet and the drill-down bubbles need to know.
      attachments: { select: CHAT_ATTACHMENT_SELECT },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Every CLIENT in this group. Anyone posting under the broadcast who is NOT
  // one of these is the business talking.
  const clientUserIds = new Set(participants.map(p => p.userId))

  const url = new URL(req.url)
  const personId = url.searchParams.get('person')
  if (personId) {
    const person = participants.find(p => p.id === personId)
    if (!person) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // The private exchange for THIS broadcast: their replies, plus anything
    // the business said back under the same post. Deliberately NOT rerouted
    // into the 1:1 thread — the reply the trainer just read must not vanish
    // from where they read it. Another client's reply can never appear here:
    // it is either filtered out below, or (in BROADCAST) written TRAINER_ONLY
    // and invisible to everyone but the team anyway.
    const conversation = replies.filter(
      r => r.senderId === person.userId || !clientUserIds.has(r.senderId),
    )
    return NextResponse.json({
      post: { id: post.id, body: post.body, createdAt: post.createdAt.toISOString() },
      person: {
        participantId: person.id,
        displayName: person.leftAt ? REMOVED_MEMBER_LABEL : person.displayName,
        // The link across to their full 1:1 history, for when the trainer
        // wants the wider context. Trainer-side payload only.
        clientProfileId: person.clientProfileId,
        left: !!person.leftAt,
      },
      messages: conversation.map(m => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        senderId: m.senderId,
        isMine: m.senderId === access.userId,
        fromPerson: m.senderId === person.userId,
        attachments: toChatAttachments(m.attachments),
      })),
    })
  }

  const byUser = new Map<string, { count: number; last: string; lastAt: Date }>()
  for (const r of replies) {
    const prev = byUser.get(r.senderId)
    byUser.set(r.senderId, {
      count: (prev?.count ?? 0) + 1,
      // "📷 Photo" rather than an empty cell in the who-replied list.
      last: messagePreview({ body: r.body, attachmentCount: r.attachments?.length }),
      lastAt: r.createdAt,
    })
  }

  const rows = participants.map(p => {
    const answer = byUser.get(p.userId)
    return {
      participantId: p.id,
      displayName: p.leftAt ? REMOVED_MEMBER_LABEL : p.displayName,
      clientProfileId: p.clientProfileId,
      replied: !!answer,
      replyCount: answer?.count ?? 0,
      lastReply: answer?.last ?? null,
      lastReplyAt: answer ? answer.lastAt.toISOString() : null,
      // Someone still sitting on a COMMUNITY invitation hasn't seen it at all,
      // which is a different fact from "read it and said nothing".
      invitedOnly: !p.joinedAt && !p.leftAt,
      left: !!p.leftAt,
    }
  })

  // People who answered first; the quiet ones sit at the end, which is where
  // the trainer goes to chase.
  rows.sort((a, b) => {
    if (a.replied !== b.replied) return a.replied ? -1 : 1
    if (a.replied && b.replied) return (b.lastReplyAt ?? '').localeCompare(a.lastReplyAt ?? '')
    return a.displayName.localeCompare(b.displayName)
  })

  return NextResponse.json({
    post: { id: post.id, body: post.body, createdAt: post.createdAt.toISOString() },
    repliedCount: rows.filter(r => r.replied).length,
    totalCount: rows.length,
    rows,
  })
}
