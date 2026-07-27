import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { enforceRateLimit } from '@/lib/rate-limit'
import {
  resolveGroupAudience,
  chunk,
  firstNameOf,
  MAX_REQUESTED_IDS,
} from '@/lib/message-groups'
import { notifyGroupInvite } from '@/lib/notify-group-invite'
import { after } from 'next/server'

// POST /api/message-groups — create a group.
//
// A group is created once and posted into over time; this endpoint does not
// send anything. The mode is chosen HERE and is the single most consequential
// field on the record: a trainer who thinks they are broadcasting and has
// actually built a community has exposed their client list to itself.

// GET /api/message-groups?classRunId=<id> — this business's groups, so a
// surface like the class screen can show what already exists instead of
// letting a trainer create a second group for the same class by accident.
export async function GET(req: Request) {
  const guard = await guardPermission('messages.send')
  if (guard instanceof NextResponse) return guard

  const classRunId = new URL(req.url).searchParams.get('classRunId')
  const groups = await prisma.messageGroup.findMany({
    // Always tenant-scoped: a classRunId from another business matches nothing.
    where: { trainerId: guard.companyId, ...(classRunId ? { classRunId } : {}) },
    select: {
      id: true, name: true, mode: true, archivedAt: true,
      _count: { select: { participants: { where: { role: 'CLIENT', leftAt: null } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({
    groups: groups.map(g => ({
      id: g.id,
      name: g.name,
      mode: g.mode,
      archived: !!g.archivedAt,
      memberCount: g._count.participants,
    })),
  })
}

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  mode: z.enum(['BROADCAST', 'COMMUNITY']),
  scope: z.enum(['MANUAL', 'ALL_CLIENTS', 'CLASS_RUN', 'PACKAGE', 'MEMBERSHIP']),
  clientIds: z.array(z.string().min(1)).max(MAX_REQUESTED_IDS).optional(),
  classRunId: z.string().min(1).optional(),
  packageId: z.string().min(1).optional(),
  membershipId: z.string().min(1).optional(),
  includeWaitlist: z.boolean().optional(),
  includeInactive: z.boolean().optional(),
  important: z.boolean().optional(),
})

export async function POST(req: Request) {
  const guard = await guardPermission('messages.send')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = guard.companyId

  // Same gate as the Messages screen — "if you have the app you can
  // communicate" (Karl). No separate flag.
  if (!(await hasAddon(trainerId, 'clientapp'))) {
    return NextResponse.json(
      { error: 'The Client app add-on is required to message clients.', code: 'ADDON_REQUIRED' },
      { status: 403 },
    )
  }

  const limited = await enforceRateLimit({ key: `message-group:${trainerId}`, limit: 30, windowMs: 60 * 60_000 })
  if (limited) return limited

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
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
  if (audience.notFound) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (audience.members.length === 0) {
    return NextResponse.json(
      { error: 'There is nobody to put in this group.', skipped: audience.skipped },
      { status: 422 },
    )
  }
  // No size cap, by decision. The composer's confirm step above 25 is what
  // stops a whole-customer-base group happening by accident.

  const creator = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true },
  })

  const group = await prisma.messageGroup.create({
    data: {
      trainerId,
      name: (input.name ?? audience.suggestedName).slice(0, 80) || 'New group',
      mode: input.mode,
      scope: input.scope,
      classRunId: input.scope === 'CLASS_RUN' ? input.classRunId ?? null : null,
      packageId: input.scope === 'PACKAGE' ? input.packageId ?? null : null,
      membershipId: input.scope === 'MEMBERSHIP' ? input.membershipId ?? null : null,
      includeWaitlist: input.includeWaitlist ?? false,
      important: input.important ?? false,
    },
    select: { id: true, name: true, mode: true },
  })

  // The trainer is ALWAYS a participant and always a moderator.
  await prisma.messageGroupParticipant.create({
    data: {
      groupId: group.id,
      userId: session.user.id,
      role: guard.role === 'OWNER' ? 'OWNER' : 'STAFF',
      displayName: firstNameOf(creator?.name ?? null, creator?.email ?? null),
      joinedAt: new Date(),
    },
  })

  // Chunked so a 300-person group is three inserts, not one giant statement
  // and not 300 round-trips.
  const joinedAt = input.mode === 'BROADCAST' ? new Date() : null
  for (const part of chunk(audience.members)) {
    await prisma.messageGroupParticipant.createMany({
      data: part.map(m => ({
        groupId: group.id,
        userId: m.userId,
        clientProfileId: m.clientProfileId,
        role: 'CLIENT' as const,
        displayName: m.displayName,
        // BROADCAST: in immediately — nobody is exposed to anybody, so there
        // is nothing to consent to. COMMUNITY: invited only. joinedAt stays
        // null until the client accepts, and until then they cannot see the
        // thread's other members or post into it.
        joinedAt,
      })),
      skipDuplicates: true,
    })
  }

  // COMMUNITY members are invited, not added, so somebody has to actually ASK
  // them — otherwise the group is created, posted into, and every member is
  // silently excluded by the consent check with no way to learn it exists.
  // After the response: the participant rows are the source of truth and a dead
  // device token must not fail the create.
  if (group.mode === 'COMMUNITY') {
    after(() => notifyGroupInvite({ groupId: group.id }))
  }

  return NextResponse.json(
    {
      groupId: group.id,
      name: group.name,
      mode: group.mode,
      memberCount: audience.members.length,
      skipped: audience.skipped,
    },
    { status: 201 },
  )
}
