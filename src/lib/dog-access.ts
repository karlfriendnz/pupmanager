import { prisma } from './prisma'
import type { Prisma } from '@/generated/prisma'

type Db = typeof prisma | Prisma.TransactionClient

// Ownership check shared by every route that accepts a dogId from the request
// and attaches it to a record (tasks, class enrolments, field values, …). A dog
// belongs to a client when it's that client's primary dog (ClientProfile.dogId)
// or one of their additional dogs (Dog.clientProfileId). Trusting a dogId
// without this lets a caller link/attach data to ANOTHER client's dog.
export async function dogBelongsToClient(dogId: string, clientId: string, db: Db = prisma): Promise<boolean> {
  const dog = await db.dog.findFirst({
    where: { id: dogId, OR: [{ clientProfileId: clientId }, { primaryFor: { some: { id: clientId } } }] },
    select: { id: true },
  })
  return !!dog
}

/** Same check across ANY of a set of client-profile ids (a user who is a client
 * of several businesses owns dogs under multiple profiles). */
export async function dogBelongsToAnyClient(dogId: string, clientIds: string[], db: Db = prisma): Promise<boolean> {
  if (clientIds.length === 0) return false
  const dog = await db.dog.findFirst({
    where: {
      id: dogId,
      OR: [{ clientProfileId: { in: clientIds } }, { primaryFor: { some: { id: { in: clientIds } } } }],
    },
    select: { id: true },
  })
  return !!dog
}
