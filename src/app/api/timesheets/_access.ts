// Shared access rules for timesheets.
//
// Timesheets are per-user, but an OWNER or MANAGER can view (and act on) any
// team member's timesheets so they can review/finalise/send on a member's
// behalf. STAFF stay scoped to their own sheets. There's no timesheet-specific
// permission key, so we gate on role — mirroring how schedule.viewAll defaults
// to true for OWNER + MANAGER and false for STAFF.

import { prisma } from '@/lib/prisma'
import type { TrainerContext } from '@/lib/membership'

/** Can this trainer see/manage every member's timesheets, not just their own? */
export function canViewAllTimesheets(ctx: TrainerContext): boolean {
  return ctx.role === 'OWNER' || ctx.role === 'MANAGER'
}

/**
 * Resolve which user's timesheets a request targets. `memberId` is a
 * TrainerMembership id chosen via the team tabs. Owners/managers may target any
 * member in the company; everyone else (and any unknown id) falls back to self.
 * Returns the target userId.
 */
export async function resolveTargetUserId(ctx: TrainerContext, memberId: string | null | undefined): Promise<string> {
  if (!memberId || !canViewAllTimesheets(ctx)) return ctx.userId
  const membership = await prisma.trainerMembership.findFirst({
    where: { id: memberId, companyId: ctx.companyId },
    select: { userId: true },
  })
  return membership?.userId ?? ctx.userId
}

/**
 * Prisma `where` fragment that scopes a single-sheet lookup to what this trainer
 * may touch. Owners/managers can reach any sheet in the company; others only
 * their own.
 */
export function sheetScope(ctx: TrainerContext): Record<string, unknown> {
  if (canViewAllTimesheets(ctx)) return { companyId: ctx.companyId }
  return { companyId: ctx.companyId, userId: ctx.userId }
}
