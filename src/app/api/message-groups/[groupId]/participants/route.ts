import { NextResponse, after } from 'next/server'
import { z } from 'zod'

import { guardPermission } from '@/lib/membership'
import {
  MAX_REQUESTED_IDS,
  chunk,
  resolveGroupAudience,
} from '@/lib/message-groups'
import { notifyGroupInvite } from '@/lib/notify-group-invite'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

/**
 * POST /api/message-groups/<id>/participants — add people to a group that
 * already exists.
 *
 * A group could only ever shrink: participants had a DELETE and nothing else,
 * so the roster was fixed at creation. Which is the wrong way round — a class
 * takes a late booking, someone new starts, and the group they should be in was
 * closed the moment it was made.
 *
 * Everything about WHO can be added is deferred to resolveGroupAudience, the
 * same resolver the create route uses. It is where sample clients are dropped,
 * inactive ones are excluded unless asked for, and two ClientProfiles belonging
 * to one person are collapsed to one participant. Re-deriving any of that here
 * would mean two answers to "who is in this group" that eventually disagree.
 *
 * THREE RULES INHERITED, NOT REWRITTEN
 *
 * Leaving sticks. Someone with `optedOutAt` — they walked out, or a moderator
 * removed them — is NOT re-added by this. Being able to add people back by hand
 * would quietly undo the one guarantee a member has. Someone merely `leftAt`
 * (dropped off a roster) is restored, because that was never their decision.
 *
 * BROADCAST joins immediately; COMMUNITY only invites. Nobody is exposed to
 * anybody in a broadcast, so there is nothing to consent to. In a community the
 * new person would become visible to the others and they to them, so it stays
 * an invitation until they accept — and somebody has to actually ask, which is
 * why the invite notification fires here too.
 *
 * `skipDuplicates` on the insert: adding someone already in the group is a
 * no-op, not an error. The trainer's mental model is "make sure these people
 * are in", and a 409 for a name they'd already added is a worse answer.
 */

const schema = z.object({
  scope: z.enum(['MANUAL', 'ALL_CLIENTS', 'CLASS_RUN', 'PACKAGE', 'MEMBERSHIP']),
  clientIds: z.array(z.string()).max(MAX_REQUESTED_IDS).optional(),
  classRunId: z.string().optional(),
  packageId: z.string().optional(),
  membershipId: z.string().optional(),
  includeWaitlist: z.boolean().optional(),
  includeInactive: z.boolean().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const guard = await guardPermission('messages.send')
  if (guard instanceof NextResponse) return guard

  const { groupId } = await params
  const group = await prisma.messageGroup.findFirst({
    where: { id: groupId, trainerId: guard.companyId },
    select: { id: true, mode: true, archivedAt: true },
  })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (group.archivedAt) {
    return NextResponse.json({ error: 'This group is archived.' }, { status: 409 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  const input = parsed.data

  const audience = await resolveGroupAudience(guard, {
    scope: input.scope,
    clientIds: input.clientIds,
    classRunId: input.classRunId,
    packageId: input.packageId,
    membershipId: input.membershipId,
    includeWaitlist: input.includeWaitlist,
    includeInactive: input.includeInactive,
  })
  if (audience.members.length === 0) {
    return NextResponse.json({ ok: true, added: 0, restored: 0, refused: 0 })
  }

  const userIds = audience.members.map(m => m.userId)
  const existing = await prisma.messageGroupParticipant.findMany({
    where: { groupId, userId: { in: userIds } },
    select: { id: true, userId: true, leftAt: true, optedOutAt: true },
  })
  const byUserId = new Map(existing.map(p => [p.userId, p]))

  const toCreate = audience.members.filter(m => !byUserId.has(m.userId))
  // Dropped off a roster and coming back — restore them.
  const toRestore = existing.filter(p => p.leftAt && !p.optedOutAt).map(p => p.id)
  // Walked out, or were removed. Their decision stands; adding them by hand
  // must not be a way around it.
  const refused = existing.filter(p => p.optedOutAt).length

  const joinedAt = group.mode === 'BROADCAST' ? new Date() : null
  for (const part of chunk(toCreate)) {
    await prisma.messageGroupParticipant.createMany({
      data: part.map(m => ({
        groupId,
        userId: m.userId,
        clientProfileId: m.clientProfileId,
        role: 'CLIENT' as const,
        displayName: m.displayName,
        joinedAt,
      })),
      skipDuplicates: true,
    })
  }
  if (toRestore.length) {
    await prisma.messageGroupParticipant.updateMany({
      where: { id: { in: toRestore } },
      data: { leftAt: null },
    })
  }

  // Somebody has to actually ask, or the new member is silently excluded by the
  // consent check with no way to learn the group exists. After the response —
  // the rows are the source of truth and a dead device token must not fail this.
  if (group.mode === 'COMMUNITY' && toCreate.length > 0) {
    after(() => notifyGroupInvite({ groupId }))
  }

  return NextResponse.json({
    ok: true,
    added: toCreate.length,
    restored: toRestore.length,
    // Surfaced rather than swallowed: "I added Sam and Sam isn't there" needs
    // an answer, and the answer is that Sam left.
    refused,
    skipped: audience.skipped.length,
  })
}
