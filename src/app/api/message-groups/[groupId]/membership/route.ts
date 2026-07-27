import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getGroupAccess } from '@/lib/message-group-access'

// POST /api/message-groups/<id>/membership — the member's own controls.
//
//   join   accept a COMMUNITY invitation. THIS is the opt-in: until it
//          happens the client sees the invitation and nothing else — not the
//          conversation, not who else is in it.
//   leave  one tap out. Sets optedOutAt as well as leftAt, which is what makes
//          leaving STICK: re-enrolling in the class next term must never drag
//          someone back into a group they deliberately walked out of.
//   mute   stop the pushes without leaving.
//   rename change the name the other members see. Display name only — this is
//          the only identity a group ever exposes.

const schema = z.object({
  action: z.enum(['join', 'leave', 'mute', 'unmute', 'rename']),
  displayName: z.string().trim().min(1).max(40).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const access = await getGroupAccess(groupId)
  if (access instanceof NextResponse) return access

  // Trainer-side staff use the moderator endpoints; this one is for members.
  if (!access.participant) {
    return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const id = access.participant.id
  switch (parsed.data.action) {
    case 'join':
      await prisma.messageGroupParticipant.update({
        where: { id },
        // Re-joining clears the opt-out — they've changed their mind, which is
        // theirs to do. Only THEY can clear it; an audience refresh cannot.
        data: { joinedAt: new Date(), leftAt: null, optedOutAt: null },
      })
      return NextResponse.json({ ok: true, joined: true })

    case 'leave':
      await prisma.messageGroupParticipant.update({
        where: { id },
        data: { leftAt: new Date(), optedOutAt: new Date() },
      })
      return NextResponse.json({ ok: true, joined: false })

    case 'mute':
      await prisma.messageGroupParticipant.update({ where: { id }, data: { mutedAt: new Date() } })
      return NextResponse.json({ ok: true, muted: true })

    case 'unmute':
      await prisma.messageGroupParticipant.update({ where: { id }, data: { mutedAt: null } })
      return NextResponse.json({ ok: true, muted: false })

    case 'rename': {
      const name = parsed.data.displayName
      if (!name) return NextResponse.json({ error: 'Pick a name' }, { status: 400 })
      await prisma.messageGroupParticipant.update({ where: { id }, data: { displayName: name } })
      return NextResponse.json({ ok: true, displayName: name })
    }
  }
}
