import { can } from './permissions'
import type { TrainerContext } from './membership'

// A Prisma `where` fragment restricting TrainingSession access for the caller,
// for the session-detail routes (schedule/[sessionId], attachments,
// form-responses, buddies). These previously scoped only by company
// (trainerId), so a RESTRICTED staff member — one without schedule.viewAll and
// limited to their assigned clients — could read/write ANY client's session
// data in the business (notes, attachments, form answers).
//
// Owners/managers (and staff granted schedule.viewAll) see everything → empty
// fragment. A restricted member is limited to:
//   - 1:1 sessions assigned to them (assignedMembershipId === their membership)
//   - class sessions (classRunId set) — those aren't assigned per-member, so we
//     don't lock restricted staff out of class workflows.
//
// Spread into the existing where: `{ id, trainerId: ctx.companyId, ...accessibleSessionWhere(ctx) }`.
export function accessibleSessionWhere(ctx: TrainerContext): Record<string, unknown> {
  if (can('schedule.viewAll', ctx.role, ctx.permissions)) return {}
  return { OR: [{ assignedMembershipId: ctx.membershipId }, { classRunId: { not: null } }] }
}
