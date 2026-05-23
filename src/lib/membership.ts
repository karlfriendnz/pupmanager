// The one place to resolve "who is this trainer, in which business, with what
// powers". Replaces the scattered `trainerProfile.findUnique({ where: { userId } })`
// lookups — that pattern only works for owners; this works for invited members
// too, by going through TrainerMembership.
//
// Role + permissions are read FRESH from the DB here (not trusted from the JWT)
// so an owner changing a member's access takes effect on the member's next
// request, not their next sign-in. Wrapped in React cache() so a layout + page
// in the same render share one query.

import { cache } from 'react'
import { NextResponse } from 'next/server'
import { auth } from './auth'
import { prisma } from './prisma'
import type { CompanyRole } from '@/generated/prisma'
import {
  asPermissionMap,
  can as canPermission,
  type PermissionKey,
  type PermissionMap,
} from './permissions'

export interface TrainerContext {
  /** The logged-in user's id. */
  userId: string
  /** The business / tenant id (== session.user.trainerId, the legacy scope key). */
  companyId: string
  /** This user's membership id within the business, or null for a legacy owner
   *  whose membership row hasn't been backfilled yet. */
  membershipId: string | null
  role: CompanyRole
  /** Raw per-member permission overrides (role defaults applied by can()). */
  permissions: PermissionMap
}

/**
 * Resolve the current trainer's business context, or null if the request isn't
 * an authenticated trainer. Use this instead of re-querying the trainer profile.
 */
export const getTrainerContext = cache(async (): Promise<TrainerContext | null> => {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) return null

  const companyId = session.user.trainerId
  const userId = session.user.id

  const membership = await prisma.trainerMembership.findUnique({
    where: { companyId_userId: { companyId, userId } },
    select: { id: true, role: true, permissions: true },
  })

  if (!membership) {
    // Legacy owner without a membership row yet — treat as OWNER (full access).
    // The JWT only set trainerId from an owned profile in this case.
    return { userId, companyId, membershipId: null, role: 'OWNER', permissions: {} }
  }

  return {
    userId,
    companyId,
    membershipId: membership.id,
    role: membership.role,
    permissions: asPermissionMap(membership.permissions),
  }
})

/** Does the current trainer hold `permission`? False when not signed in. */
export async function hasPermission(permission: PermissionKey): Promise<boolean> {
  const ctx = await getTrainerContext()
  if (!ctx) return false
  return canPermission(permission, ctx.role, ctx.permissions)
}

/**
 * Throw-style guard for API routes / server actions. Returns the context when
 * the permission is held; throws a tagged error otherwise so callers can map it
 * to a 401/403. Owners and managers pass per the role defaults in permissions.ts.
 */
export class PermissionError extends Error {
  constructor(public readonly permission: PermissionKey) {
    super(`Missing permission: ${permission}`)
    this.name = 'PermissionError'
  }
}

export async function requirePermission(permission: PermissionKey): Promise<TrainerContext> {
  const ctx = await getTrainerContext()
  if (!ctx) throw new PermissionError(permission)
  if (!canPermission(permission, ctx.role, ctx.permissions)) throw new PermissionError(permission)
  return ctx
}

/**
 * API-route guard. Returns the TrainerContext when the permission is held, or a
 * ready-to-return NextResponse (401 unauthenticated / 403 forbidden) otherwise:
 *
 *   const guard = await guardPermission('packages.manage')
 *   if (guard instanceof NextResponse) return guard
 *   const trainerId = guard.companyId
 *
 * Owners and managers pass per the role presets, so existing flows are
 * unaffected; only restricted members (staff) are blocked.
 */
export async function guardPermission(permission: PermissionKey): Promise<TrainerContext | NextResponse> {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!canPermission(permission, ctx.role, ctx.permissions)) {
    return NextResponse.json({ error: 'You don’t have permission to do this.' }, { status: 403 })
  }
  return ctx
}

/**
 * Build a Prisma `where` fragment that scopes a query to what this member may
 * see, for the two data-scope permissions. Pass the field name that holds the
 * assigned membership id on the model being queried.
 *
 *   where: { trainerId: ctx.companyId, ...scopeForMember(ctx, 'clients.viewAll') }
 *
 * Owners/managers (or anyone with the viewAll permission) get an empty fragment
 * (see everything). Staff get `{ assignedMembershipId: <their membership> }`.
 */
export function scopeForMember(
  ctx: TrainerContext,
  viewAllPermission: Extract<PermissionKey, 'clients.viewAll' | 'schedule.viewAll'>,
  field: string = 'assignedMembershipId',
): Record<string, unknown> {
  if (canPermission(viewAllPermission, ctx.role, ctx.permissions)) return {}
  // Restricted member: only rows assigned to them. A member with no membership
  // id (legacy owner) never reaches here because OWNER passes viewAll above.
  return { [field]: ctx.membershipId }
}
