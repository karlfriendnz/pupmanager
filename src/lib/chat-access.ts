import { prisma } from '@/lib/prisma'

/**
 * May this user read and write the 1:1 thread for this client?
 *
 * Three ways in, and only three:
 *   • the trainer/staff of the business that owns the ClientProfile;
 *   • a trainer the client has been SHARED with (co-managed);
 *   • the client themselves.
 *
 * This predicate already existed, written out longhand inside
 * /api/messages/stream. It is a shared function now because the photo upload
 * route and the image-serving route have to apply exactly the same rule — and
 * "the same rule, written out three times" is how one of the three ends up
 * being subtly more generous than the others.
 */
export async function canAccessDirectThread(userId: string, clientId: string): Promise<boolean> {
  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (trainerProfile) {
    const owned = await prisma.clientProfile.findFirst({
      where: { id: clientId, trainerId: trainerProfile.id },
      select: { id: true },
    })
    if (owned) return true
    const shared = await prisma.clientShare.findFirst({
      where: { clientId, sharedWithId: trainerProfile.id },
      select: { id: true },
    })
    if (shared) return true
  }
  const own = await prisma.clientProfile.findFirst({
    where: { id: clientId, userId },
    select: { id: true },
  })
  return !!own
}
