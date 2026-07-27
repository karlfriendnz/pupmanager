// Group messaging — a group is a THREAD, not a fan-out.
//
// It sits in the messages list beside the 1:1 client threads and you post into
// it over time (WhatsApp/Facebook group semantics). Two modes, and the whole
// difference between them is one field on each post:
//
//   BROADCAST  trainer/staff posts are EVERYONE; a client's reply is written
//              TRAINER_ONLY. Members never see each other. No consent step is
//              needed because nothing about one client is disclosed to another.
//   COMMUNITY  everything is EVERYONE. Dog owners become visible to each
//              other, which is a disclosure they never agreed to when they
//              handed their details to a trainer — so it is opt-in per client,
//              per group, default off.
//
// Nothing in here touches `Message`. 1:1 messaging keeps its single `readAt`
// column and behaves exactly as it did; groups carry their own per-participant
// read watermark. See docs/plan-group-messaging.md §4.2.

import { prisma } from '@/lib/prisma'
import { scopeForMember, type TrainerContext } from '@/lib/membership'
import type { MessageGroupMode, MessageGroupScope } from '@/generated/prisma'

/** There is deliberately NO cap on group size (Karl, 2026-07-27): a trainer
 *  must be able to message their entire customer base. What there IS is a
 *  confirm step above this many people — the one thing standing between them
 *  and an unrecallable message to everyone they know. */
export const CONFIRM_ABOVE = 25

/** Rows per INSERT when adding participants or fanning out pushes. One
 *  statement for 300 rows is what times out on a slow connection; a per-row
 *  loop is 300 round-trips. */
export const INSERT_CHUNK = 100

/** Payload guard only — not a product limit. */
export const MAX_REQUESTED_IDS = 5000

export function chunk<T>(arr: T[], size = INSERT_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** What another member is allowed to see a departed person as. */
export const REMOVED_MEMBER_LABEL = 'Removed member'

export type AudienceSkipReason = 'NOT_FOUND' | 'SAMPLE' | 'INACTIVE' | 'DUPLICATE_PERSON'

export interface AudienceMember {
  /** ClientProfile id. */
  clientProfileId: string
  userId: string
  /** First name only — the ONLY identity other members ever see. */
  displayName: string
}

export interface AudienceOptions {
  scope: MessageGroupScope
  clientIds?: string[]
  classRunId?: string
  packageId?: string
  membershipId?: string
  /** CLASS_RUN only. The trainer chooses this when creating the group; it is
   *  never a silent default. */
  includeWaitlist?: boolean
  includeInactive?: boolean
}

export interface AudienceResult {
  members: AudienceMember[]
  skipped: { clientId: string; reason: AudienceSkipReason }[]
  /** Suggested group name, from the source. The trainer can edit it. */
  suggestedName: string
  notFound?: true
}

/**
 * First name only. Making this the stored `displayName` — rather than joining
 * to User at read time — is what makes the "display name only" promise
 * structural instead of something every query has to remember not to break.
 */
export function firstNameOf(name: string | null, email: string | null): string {
  const trimmed = (name ?? '').trim()
  if (trimmed) return trimmed.split(/\s+/)[0]
  // No name on file. Never fall back to the email — that is exactly the
  // disclosure a community group must not make. A generic label is safer than
  // leaking an address to eleven strangers.
  return 'Member'
}

/**
 * Resolve a scope into the people who belong in a group.
 *
 * Ids arriving from the browser are never trusted: whatever the scope, the
 * final set always comes from a refetch of ClientProfile scoped to this
 * business (plus accepted ClientShares) and this member's visibility, so a
 * spoofed id from another tenant can never resolve.
 */
export async function resolveGroupAudience(
  ctx: TrainerContext,
  opts: AudienceOptions,
): Promise<AudienceResult> {
  const trainerId = ctx.companyId

  // `null` = no id filter, i.e. everyone this business can reach.
  let requestedIds: string[] | null = []
  let suggestedName = ''

  if (opts.scope === 'ALL_CLIENTS') {
    requestedIds = null
    suggestedName = 'Everyone'
  } else if (opts.scope === 'MANUAL') {
    requestedIds = opts.clientIds ?? []
    suggestedName = 'New group'
  } else if (opts.scope === 'CLASS_RUN') {
    const run = await prisma.classRun.findFirst({
      where: { id: opts.classRunId ?? '', trainerId },
      select: { name: true },
    })
    if (!run) return { members: [], skipped: [], suggestedName: '', notFound: true }
    suggestedName = run.name
    const statuses = opts.includeWaitlist ? ['ENROLLED', 'WAITLISTED'] : ['ENROLLED']
    const enrolments = await prisma.classEnrollment.findMany({
      where: { classRunId: opts.classRunId, status: { in: statuses as never[] } },
      select: { clientId: true },
    })
    requestedIds = enrolments.map(e => e.clientId)
  } else if (opts.scope === 'PACKAGE') {
    const pkg = await prisma.package.findFirst({
      where: { id: opts.packageId ?? '', trainerId },
      select: { name: true },
    })
    if (!pkg) return { members: [], skipped: [], suggestedName: '', notFound: true }
    suggestedName = pkg.name
    const assignments = await prisma.clientPackage.findMany({
      where: { packageId: opts.packageId },
      select: { clientId: true },
    })
    requestedIds = assignments.map(a => a.clientId)
  } else {
    const membership = await prisma.membership.findFirst({
      where: { id: opts.membershipId ?? '', trainerId },
      select: { name: true },
    })
    if (!membership) return { members: [], skipped: [], suggestedName: '', notFound: true }
    suggestedName = membership.name
    const purchases = await prisma.membershipPurchase.findMany({
      where: { membershipId: opts.membershipId, trainerId, status: 'ACTIVE' },
      select: { clientId: true },
    })
    requestedIds = purchases.map(p => p.clientId)
  }

  // Dedupe BEFORE resolving. A client with two dogs in one class has two
  // ClassEnrollment rows and a ticketed event can produce several via
  // ticketGroupId — one person, one membership.
  const uniqueIds = requestedIds === null ? null : [...new Set(requestedIds)]
  if (uniqueIds !== null && uniqueIds.length === 0) {
    return { members: [], skipped: [], suggestedName }
  }

  // The tenancy boundary. Two ways someone legitimately belongs: this business
  // owns them, or another business co-manages them WITH this one through an
  // ACCEPTED ClientShare (Karl: co-managed clients are included).
  const memberScope = scopeForMember(ctx, 'clients.viewAll')
  const candidates = await prisma.clientProfile.findMany({
    where: {
      ...(uniqueIds === null ? {} : { id: { in: uniqueIds } }),
      OR: [
        { trainerId },
        { shares: { some: { sharedWithId: trainerId, acceptedAt: { not: null } } } },
      ],
      ...memberScope,
    },
    select: {
      id: true,
      userId: true,
      trainerId: true,
      status: true,
      isSample: true,
      user: { select: { name: true, email: true } },
    },
  })

  const skipped: { clientId: string; reason: AudienceSkipReason }[] = []
  const resolved = new Set(candidates.map(c => c.id))
  for (const id of uniqueIds ?? []) {
    if (!resolved.has(id)) skipped.push({ clientId: id, reason: 'NOT_FOUND' })
  }

  // One person can hold more than one ClientProfile in reach — ours plus a
  // co-managed one. Dedupe by the underlying User, preferring the profile this
  // business owns. NOTE this is deduping WITHIN one group; a person in two
  // groups that both get an announcement gets it twice, and that is correct.
  const byUser = new Map<string, typeof candidates[number]>()
  for (const c of candidates) {
    if (c.isSample) { skipped.push({ clientId: c.id, reason: 'SAMPLE' }); continue }
    if (c.status === 'INACTIVE' && !opts.includeInactive) {
      skipped.push({ clientId: c.id, reason: 'INACTIVE' }); continue
    }
    const held = byUser.get(c.userId)
    if (!held) { byUser.set(c.userId, c); continue }
    const loser = held.trainerId === trainerId ? c : held
    if (loser === held) byUser.set(c.userId, c)
    skipped.push({ clientId: loser.id, reason: 'DUPLICATE_PERSON' })
  }

  const order = new Map((uniqueIds ?? candidates.map(c => c.id)).map((id, i) => [id, i]))
  const members = [...byUser.values()]
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map(c => ({
      clientProfileId: c.id,
      userId: c.userId,
      displayName: firstNameOf(c.user.name, c.user.email),
    }))

  return { members, skipped, suggestedName }
}

/**
 * Bring a scope-backed group's membership back in line with its source.
 *
 * The rule that matters: **leaving sticks**. Someone the roster dropped and
 * later restored is re-added; someone who walked out, or was removed by a
 * moderator, is not — that's what `optedOutAt` distinguishes from `leftAt`.
 * Without the distinction, re-enrolling next term would silently drag a person
 * back into a group they deliberately left.
 */
export async function syncGroupParticipants(
  ctx: TrainerContext,
  groupId: string,
): Promise<{ added: number; removed: number }> {
  const group = await prisma.messageGroup.findFirst({
    where: { id: groupId, trainerId: ctx.companyId },
    select: {
      id: true, scope: true, mode: true, classRunId: true, packageId: true,
      membershipId: true, includeWaitlist: true,
    },
  })
  // MANUAL groups have no source to re-derive from — their membership is
  // whatever the trainer set, so there is nothing to sync.
  if (!group || group.scope === 'MANUAL') return { added: 0, removed: 0 }

  const audience = await resolveGroupAudience(ctx, {
    scope: group.scope,
    classRunId: group.classRunId ?? undefined,
    packageId: group.packageId ?? undefined,
    membershipId: group.membershipId ?? undefined,
    includeWaitlist: group.includeWaitlist,
  })
  if (audience.notFound) return { added: 0, removed: 0 }

  const existing = await prisma.messageGroupParticipant.findMany({
    where: { groupId, role: 'CLIENT' },
    select: { id: true, userId: true, leftAt: true, optedOutAt: true },
  })
  const byUserId = new Map(existing.map(p => [p.userId, p]))
  const shouldBeIn = new Set(audience.members.map(m => m.userId))

  // Add anyone new, and restore anyone the roster dropped and brought back —
  // but never someone who opted out.
  const toCreate: AudienceMember[] = []
  const toRestore: string[] = []
  for (const m of audience.members) {
    const row = byUserId.get(m.userId)
    if (!row) { toCreate.push(m); continue }
    if (row.optedOutAt) continue // they left. It sticks.
    if (row.leftAt) toRestore.push(row.id)
  }

  for (const group_ of chunk(toCreate)) {
    await prisma.messageGroupParticipant.createMany({
      data: group_.map(m => ({
        groupId,
        userId: m.userId,
        clientProfileId: m.clientProfileId,
        role: 'CLIENT' as const,
        displayName: m.displayName,
        // BROADCAST needs no consent — nobody is exposed to anybody. COMMUNITY
        // stays an invitation until the client accepts.
        joinedAt: group.mode === 'BROADCAST' ? new Date() : null,
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

  // Off the roster → out of the group, but their posts stay (as "Removed
  // member"). This is NOT an opt-out, so if they re-enrol they come back.
  const toRemove = existing
    .filter(p => !shouldBeIn.has(p.userId) && !p.leftAt)
    .map(p => p.id)
  if (toRemove.length) {
    await prisma.messageGroupParticipant.updateMany({
      where: { id: { in: toRemove } },
      data: { leftAt: new Date() },
    })
  }

  return { added: toCreate.length + toRestore.length, removed: toRemove.length }
}

/**
 * The `where` fragment for posts a given viewer may read.
 *
 * In BROADCAST a client sees everything addressed to EVERYONE plus their own
 * replies — never another client's. In COMMUNITY everything is EVERYONE
 * anyway, so the same fragment is correct for both and there is no second
 * code path to get wrong.
 */
export function visibleMessagesWhere(viewer: { userId: string; isTrainerSide: boolean }) {
  if (viewer.isTrainerSide) return { deletedAt: null }
  return {
    deletedAt: null,
    OR: [{ visibility: 'EVERYONE' as const }, { senderId: viewer.userId }],
  }
}

/** What one post should be written as, given the mode and who is posting. */
export function visibilityForPost(mode: MessageGroupMode, isTrainerSide: boolean) {
  if (mode === 'COMMUNITY') return 'EVERYONE' as const
  return isTrainerSide ? ('EVERYONE' as const) : ('TRAINER_ONLY' as const)
}

/**
 * Can this viewer see the responses view — the list of who said what to one
 * broadcast?
 *
 * Trainer/staff always. Clients NEVER in BROADCAST: the whole guarantee of the
 * mode is that one client's reply is invisible to another, and this view is
 * precisely the thing that would break it. In COMMUNITY members can see each
 * other by definition, so it discloses nothing new. Anything unrecognised
 * defaults to hidden.
 */
export function canSeeResponses(mode: MessageGroupMode, isTrainerSide: boolean): boolean {
  if (isTrainerSide) return true
  return mode === 'COMMUNITY'
}
