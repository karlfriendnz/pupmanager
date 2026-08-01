import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { notifyClient } from '@/lib/client-notify'

// Individually inviting clients to a package.
//
// An invitation is a MembershipRequest with reason INVITE — the same table as
// "client asks trainer", read the other way round. Reusing it rather than
// adding a model keeps one answer to "what is outstanding between this client
// and this package", which is what both sides' screens are built on:
//
//   PENDING   invited, hasn't joined yet
//   FULFILLED they joined
//   DECLINED  the invitation was withdrawn — this is also how it is revoked
//
// An invitation beats the package's eligibility mode, including ACHIEVEMENT. A
// trainer naming a specific client has looked at that client and decided; the
// ladder is the default for when they haven't. That is deliberate and is what
// makes INVITE_ONLY work at all.
export const runtime = 'nodejs'

const postSchema = z.object({
  clientIds: z.array(z.string()).min(1).max(200),
})
const deleteSchema = z.object({
  clientIds: z.array(z.string()).min(1).max(200),
})

async function ownedMembership(trainerId: string, id: string) {
  return prisma.membership.findFirst({
    where: { id, trainerId },
    select: { id: true, name: true },
  })
}

/** Only this trainer's own clients — an id from another business resolves to nothing. */
async function ownClientIds(trainerId: string, ids: string[]): Promise<string[]> {
  const rows = await prisma.clientProfile.findMany({
    where: { id: { in: [...new Set(ids)] }, trainerId },
    select: { id: true },
  })
  return rows.map(r => r.id)
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await ownedMembership(ctx.companyId, id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const invites = await prisma.membershipRequest.findMany({
    where: { membershipId: id, reason: 'INVITE', status: { in: ['PENDING', 'FULFILLED'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, status: true, createdAt: true,
      client: { select: { id: true, user: { select: { name: true, email: true } } } },
    },
  })

  return NextResponse.json({
    invites: invites.map(i => ({
      id: i.id,
      clientId: i.client.id,
      name: i.client.user?.name ?? i.client.user?.email ?? 'Unnamed',
      status: i.status,
      invitedAt: i.createdAt.toISOString(),
    })),
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const membership = await ownedMembership(ctx.companyId, id)
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = postSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  const clientIds = await ownClientIds(ctx.companyId, parsed.data.clientIds)
  if (clientIds.length === 0) return NextResponse.json({ ok: true, invited: 0, reinstated: 0 })

  // What is already on file, so a re-invite reinstates rather than stacking a
  // second row — and so the notification only goes to people who didn't already
  // have the invitation.
  const existing = await prisma.membershipRequest.findMany({
    where: { membershipId: id, reason: 'INVITE', clientId: { in: clientIds } },
    select: { id: true, clientId: true, status: true },
  })
  const byClient = new Map(existing.map(e => [e.clientId, e]))

  const fresh = clientIds.filter(c => !byClient.has(c))
  // Previously withdrawn. Inviting them again is the trainer changing their
  // mind, so it goes back to PENDING rather than being refused as a duplicate.
  const reinstate = existing.filter(e => e.status === 'DECLINED').map(e => e.id)

  if (fresh.length) {
    await prisma.membershipRequest.createMany({
      data: fresh.map(clientId => ({
        clientId,
        membershipId: id,
        reason: 'INVITE' as const,
        status: 'PENDING' as const,
      })),
      skipDuplicates: true,
    })
  }
  if (reinstate.length) {
    await prisma.membershipRequest.updateMany({
      where: { id: { in: reinstate } },
      data: { status: 'PENDING', fulfilledAt: null },
    })
  }

  // Being invited is the whole point — it has to reach them, or the package
  // simply appears one day with no explanation.
  const toTell = [...fresh, ...existing.filter(e => e.status === 'DECLINED').map(e => e.clientId)]
  if (toTell.length) {
    const people = await prisma.clientProfile.findMany({
      where: { id: { in: toTell } },
      select: { userId: true, dog: { select: { name: true } } },
    })
    const trainerName = await prisma.trainerProfile.findUnique({
      where: { id: ctx.companyId },
      select: { businessName: true },
    })
    for (const p of people) {
      // notifyClient never throws — a dead device token must not lose the
      // invitation itself, and the row is already written either way.
      await notifyClient({
        userId: p.userId,
        trainerId: ctx.companyId,
        type: 'CLIENT_MEMBERSHIP_INVITE',
        vars: {
          trainerName: trainerName?.businessName ?? 'Your trainer',
          dogName: p.dog?.name ?? 'your dog',
          planName: membership.name,
        },
        link: '/my-memberships',
      })
    }
  }

  return NextResponse.json({ ok: true, invited: fresh.length, reinstated: reinstate.length })
}

/**
 * Withdraw invitations.
 *
 * DECLINED rather than deleted, so "we invited them and then didn't" stays
 * visible instead of the row quietly vanishing. Deliberately does NOT touch
 * anyone who has already joined — taking a package off someone who is paying
 * for it is a cancellation, and cancellations go through the cancel path with
 * its refund and notice rules, not through here.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await ownedMembership(ctx.companyId, id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  const clientIds = await ownClientIds(ctx.companyId, parsed.data.clientIds)
  if (clientIds.length === 0) return NextResponse.json({ ok: true, withdrawn: 0 })

  const res = await prisma.membershipRequest.updateMany({
    where: {
      membershipId: id,
      reason: 'INVITE',
      clientId: { in: clientIds },
      status: 'PENDING',
    },
    data: { status: 'DECLINED' },
  })

  return NextResponse.json({ ok: true, withdrawn: res.count })
}
