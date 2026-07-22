import { prisma } from './prisma'

// What one person's login can actually reach.
//
// `User.role` is a single enum and stays the DEFAULT landing surface, but it
// was never the truth about access: a person can own a business, contract for
// another, AND be somebody else's client, all on one login. Access is derived
// from the rows that actually exist:
//
//   trainer access = owns a TrainerProfile, or holds an accepted
//                    TrainerMembership in someone else's business
//   client access  = has at least one ClientProfile
//
// This is the real security boundary — the layouts call it on every request.
// The `pm-profile` cookie only records which side you're *currently looking at*;
// it can never grant access on its own.

export const PROFILE_COOKIE = 'pm-profile'

export type ProfileSide = 'trainer' | 'client'

export interface AccountAccess {
  hasTrainerAccess: boolean
  hasClientAccess: boolean
  /** True when this person can legitimately switch between both surfaces. */
  isDual: boolean
}

export async function getAccountAccess(userId: string): Promise<AccountAccess> {
  const [ownProfile, memberships, clientProfiles] = await Promise.all([
    prisma.trainerProfile.count({ where: { userId } }),
    // Only ACCEPTED memberships count — a pending invite must not unlock the
    // trainer app before they've accepted it.
    prisma.trainerMembership.count({ where: { userId, acceptedAt: { not: null } } }),
    prisma.clientProfile.count({ where: { userId } }),
  ])

  const hasTrainerAccess = ownProfile > 0 || memberships > 0
  const hasClientAccess = clientProfiles > 0

  return {
    hasTrainerAccess,
    hasClientAccess,
    isDual: hasTrainerAccess && hasClientAccess,
  }
}

/** Can this user legitimately view the given side? */
export async function canUseProfile(userId: string, side: ProfileSide): Promise<boolean> {
  const access = await getAccountAccess(userId)
  return side === 'trainer' ? access.hasTrainerAccess : access.hasClientAccess
}

/**
 * Which side to land on, given the cookie and what they can actually reach.
 * The cookie is honoured only when it names a side they have access to —
 * otherwise it's ignored and we fall back to whatever they can use, preferring
 * the trainer surface (the paid one they signed up for).
 */
export function resolveProfileSide(
  access: AccountAccess,
  cookieValue: string | undefined,
): ProfileSide | null {
  if (cookieValue === 'client' && access.hasClientAccess) return 'client'
  if (cookieValue === 'trainer' && access.hasTrainerAccess) return 'trainer'
  if (access.hasTrainerAccess) return 'trainer'
  if (access.hasClientAccess) return 'client'
  return null
}
