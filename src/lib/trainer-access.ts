import { prisma } from './prisma'
import type { CompanyRole } from '@/generated/prisma'
import { asPermissionMap, can } from './permissions'

/**
 * Returns the client profile if the caller has access (their business owns it,
 * or it's CO_MANAGE-shared with their business), plus whether they can edit.
 *
 * Resolves the caller's business via TrainerMembership, so it works for invited
 * members (managers/staff), not just owners. A staff member without
 * `clients.viewAll` only reaches clients assigned to them; `canEdit` follows the
 * `clients.edit` permission (Owner/Manager always pass).
 */
export async function getClientAccess(clientId: string, userId: string) {
  // Prefer an OWNER membership if the user somehow has more than one (enum
  // orders by definition order: OWNER < MANAGER < STAFF).
  const membership = await prisma.trainerMembership.findFirst({
    where: { userId },
    select: { id: true, companyId: true, role: true, permissions: true },
    orderBy: { role: 'asc' },
  })

  let companyId: string
  let membershipId: string | null = null
  let role: CompanyRole = 'OWNER'
  let perms = {}

  if (membership) {
    companyId = membership.companyId
    membershipId = membership.id
    role = membership.role
    perms = asPermissionMap(membership.permissions)
  } else {
    // Legacy owner without a membership row yet — resolve via the owned profile.
    const tp = await prisma.trainerProfile.findUnique({ where: { userId }, select: { id: true } })
    if (!tp) return null
    companyId = tp.id
  }

  const canViewAll = can('clients.viewAll', role, perms)
  const canEditClients = can('clients.edit', role, perms)

  // Owned by this business?
  const owned = await prisma.clientProfile.findFirst({
    where: { id: clientId, trainerId: companyId },
    select: { id: true, userId: true, dogId: true, trainerId: true, assignedMembershipId: true },
  })
  if (owned) {
    // Restricted members can only reach clients assigned to them.
    if (!canViewAll && owned.assignedMembershipId !== membershipId) return null
    return { client: owned, trainerId: companyId, canEdit: canEditClients }
  }

  // CO_MANAGE / READ_ONLY share with this business.
  const share = await prisma.clientShare.findFirst({
    where: { clientId, sharedWithId: companyId },
    include: {
      client: { select: { id: true, userId: true, dogId: true, trainerId: true, assignedMembershipId: true } },
    },
  })
  if (!share) return null
  if (!canViewAll && share.client.assignedMembershipId !== membershipId) return null

  const canEdit = share.shareType === 'CO_MANAGE' && canEditClients
  return { client: share.client, trainerId: companyId, canEdit }
}
