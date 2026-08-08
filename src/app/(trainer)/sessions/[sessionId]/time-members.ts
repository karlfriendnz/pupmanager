import { prisma } from '@/lib/prisma'

/**
 * Who time can be logged against, making sure there is at least one.
 *
 * A TimeEntry's `membershipId` is a foreign key to TrainerMembership, so a
 * business with no membership rows cannot log time AT ALL — the picker reads
 * "No team members" and Add is dead. That is not hypothetical: a legacy owner
 * has no membership row (lib/membership.ts treats a missing one as OWNER), and
 * only accounts created since that changed get one at signup. Every other
 * route already assumes the row exists; this makes it true.
 *
 * The upsert is idempotent and only runs when the business has NO members, so
 * a real team never touches it.
 */
export async function ensureTimeMembers(trainerId: string) {
  const find = () => prisma.trainerMembership.findMany({
    where: { companyId: trainerId },
    orderBy: { acceptedAt: 'asc' },
    select: { id: true, user: { select: { name: true, email: true } } },
  })

  const members = await find()
  if (members.length > 0) return members

  const owner = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { userId: true },
  })
  if (!owner?.userId) return members

  await prisma.trainerMembership.upsert({
    where: { companyId_userId: { companyId: trainerId, userId: owner.userId } },
    create: { companyId: trainerId, userId: owner.userId, role: 'OWNER', acceptedAt: new Date() },
    update: {},
  })
  return find()
}
