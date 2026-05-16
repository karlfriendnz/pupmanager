// Client self-booking engine. A client opts a package's booking from
// their availability tab; the package is opted in via clientSelfBook and
// either books instantly or creates a pending BookingRequest the trainer
// confirms. Session placement reuses the group-class date generator and
// the same ClientPackage/TrainingSession shape the trainer-assign flow
// produces, so a self-booked package is indistinguishable downstream.
import { prisma } from './prisma'
import type { Prisma } from '@/generated/prisma'
import { generateSessionDates } from './class-runs'

export { generateSessionDates }

type Tx = Prisma.TransactionClient

/** A package is self-bookable only when the trainer opted it in. */
export function isSelfBookable(pkg: { clientSelfBook: boolean }): boolean {
  return pkg.clientSelfBook === true
}

/**
 * Session titles match the trainer-assign flow exactly so self-booked
 * sessions read identically on the calendar.
 */
export function sessionTitle(name: string, sessionCount: number, i: number): string {
  if (sessionCount === 1) return name
  if (sessionCount > 1) return `${name} — session ${i + 1}/${sessionCount}`
  return `${name} — session ${i + 1}`
}

/**
 * Create the ClientPackage + its TrainingSession series inside a
 * transaction. Mirrors POST /api/clients/[clientId]/packages so a
 * self-booked / trainer-confirmed booking is the same as a manual one.
 */
export async function createBookingAssignment(
  tx: Tx,
  args: {
    trainerId: string
    clientId: string
    packageId: string
    dogId: string | null
    pkg: { name: string; sessionCount: number; durationMins: number; sessionType: 'IN_PERSON' | 'VIRTUAL' }
    sessionDates: Date[]
  },
): Promise<string> {
  const assignment = await tx.clientPackage.create({
    data: {
      packageId: args.packageId,
      clientId: args.clientId,
      startDate: args.sessionDates[0],
    },
  })
  await tx.trainingSession.createMany({
    data: args.sessionDates.map((d, i) => ({
      trainerId: args.trainerId,
      clientId: args.clientId,
      dogId: args.dogId,
      clientPackageId: assignment.id,
      title: sessionTitle(args.pkg.name, args.pkg.sessionCount, i),
      scheduledAt: d,
      durationMins: args.pkg.durationMins,
      sessionType: args.pkg.sessionType,
    })),
  })
  return assignment.id
}

/** Pending self-booking requests for the trainer's dashboard panel. */
export function pendingBookingRequestCount(trainerId: string): Promise<number> {
  return prisma.bookingRequest.count({ where: { trainerId, status: 'PENDING' } })
}
