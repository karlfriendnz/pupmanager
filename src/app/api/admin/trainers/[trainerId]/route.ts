import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  businessName: z.string().min(1).optional(),
  // Grace period: an ISO datetime to grant access until, or null to clear.
  gracePeriodUntil: z.union([z.string().datetime(), z.null()]).optional(),
  // Mark/unmark this as a PupManager-owned (internal/test) account.
  isInternal: z.boolean().optional(),
  // Soft delete toggle: false = deactivate (block sign-in), true = reinstate.
  active: z.boolean().optional(),
  // Apply a fresh trial of N days from today: sets trialEndsAt = now + N and
  // flips the account to TRIALING. Admin quick-action from /admin/trainers.
  applyTrialDays: z.number().int().positive().max(3650).optional(),
})

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return null
  return session
}

export async function PATCH(req: Request, { params }: { params: Promise<{ trainerId: string }> }) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { trainerId } = await params
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: trainerId, role: 'TRAINER' } })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { name, email, businessName, gracePeriodUntil, isInternal, active, applyTrialDays } = parsed.data

  if (email && email !== user.email) {
    const conflict = await prisma.user.findUnique({ where: { email } })
    if (conflict) return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
  }

  await prisma.user.update({
    where: { id: trainerId },
    data: {
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
      // active:false soft-deletes (deactivate); active:true reinstates.
      ...(active !== undefined && { deactivatedAt: active ? null : new Date() }),
    },
  })

  const profileData = {
    ...(businessName !== undefined && { businessName }),
    ...(isInternal !== undefined && { isInternal }),
    // null clears the grace period; a string sets it; undefined leaves it.
    ...(gracePeriodUntil !== undefined && {
      gracePeriodUntil: gracePeriodUntil === null ? null : new Date(gracePeriodUntil),
    }),
    // Apply a fresh N-day trial from now and put the account back on trial.
    ...(applyTrialDays !== undefined && {
      trialEndsAt: new Date(Date.now() + applyTrialDays * 24 * 60 * 60 * 1000),
      subscriptionStatus: 'TRIALING' as const,
    }),
  }
  if (Object.keys(profileData).length > 0) {
    await prisma.trainerProfile.update({
      where: { userId: trainerId },
      data: profileData,
    })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ trainerId: string }> }) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { trainerId } = await params
  const user = await prisma.user.findUnique({
    where: { id: trainerId, role: 'TRAINER' },
    include: { trainerProfile: { select: { id: true } } },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Permanent delete is only allowed once the account has been soft-deleted —
  // the admin must deactivate first, then explicitly confirm hard removal.
  if (!user.deactivatedAt) {
    return NextResponse.json(
      { error: 'Account must be deactivated before it can be permanently deleted.' },
      { status: 409 },
    )
  }

  const profileId = user.trainerProfile?.id

  try {
    // One transaction so a partial delete can't leave the account half-gone.
    // Kept bulk (no per-row loop) and given a generous timeout — the final
    // cascade delete can touch a lot of tenant data over the pooler, and the
    // default 5s interactive-transaction limit was timing out ("Transaction
    // not found").
    await prisma.$transaction(async tx => {
      if (profileId) {
        // ClientShare references TrainerProfile with no cascade (both
        // directions) — clear those rows first or the profile delete is
        // blocked by a FK constraint.
        await tx.clientShare.deleteMany({
          where: { OR: [{ sharedById: profileId }, { sharedWithId: profileId }] },
        })

        // This trainer's client links (ClientProfile.trainerId has no cascade).
        const clients = await tx.clientProfile.findMany({
          where: { trainerId: profileId },
          select: { userId: true },
        })
        const userIds = [...new Set(clients.map(c => c.userId))]

        // Drop the client links for THIS trainer first.
        await tx.clientProfile.deleteMany({ where: { trainerId: profileId } })

        // A client can belong to several trainers (composite userId+trainerId).
        // Only delete the underlying client User when they have no remaining
        // ClientProfile under another trainer. Computed in bulk (one query for
        // who's still linked, one deleteMany for the orphans) to avoid an N+1.
        if (userIds.length > 0) {
          const stillLinked = await tx.clientProfile.findMany({
            where: { userId: { in: userIds } },
            select: { userId: true },
            distinct: ['userId'],
          })
          const linked = new Set(stillLinked.map(c => c.userId))
          const orphanIds = userIds.filter(id => !linked.has(id))
          if (orphanIds.length > 0) {
            await tx.user.deleteMany({ where: { id: { in: orphanIds } } })
          }
        }
      }

      // Deletes the User → cascades the TrainerProfile and all tenant data.
      await tx.user.delete({ where: { id: trainerId } })
    }, { timeout: 30_000, maxWait: 10_000 })
  } catch (e) {
    console.error('Failed to delete trainer', trainerId, e)
    const message = e instanceof Error ? e.message : 'Failed to delete trainer'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
