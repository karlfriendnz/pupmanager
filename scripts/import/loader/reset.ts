/**
 * Delete everything a previous import created for ONE trainer, so the plan can
 * be loaded again from clean. Scoped by trainerId throughout — it can never
 * reach another tenant's rows.
 *
 * Takes a Db handle like the loader does, so a dry run can preview a reset (run
 * it inside the transaction and roll back) instead of having to trust it.
 *
 * Callers must have passed assertWritableTarget() first. --reset is refused
 * against anything but the local sandbox in apply.ts.
 */
import type { Db } from './types'

export interface ResetCounts {
  attendance: number
  enrolments: number
  runTrainers: number
  sessions: number
  clientPackages: number
  classRuns: number
  packages: number
  subscribers: number
  customFieldValues: number
  dogs: number
  profiles: number
  users: number
}

export async function resetTrainer(db: Db, trainerId: string): Promise<ResetCounts> {
  const T = trainerId

  const attendance = await db.sessionAttendance.deleteMany({ where: { session: { trainerId: T } } })
  const enrolments = await db.classEnrollment.deleteMany({ where: { classRun: { trainerId: T } } })
  const runTrainers = await db.classRunTrainer.deleteMany({ where: { classRun: { trainerId: T } } })
  const sessions = await db.trainingSession.deleteMany({ where: { trainerId: T } })
  const clientPkgs = await db.clientPackage.deleteMany({ where: { package: { trainerId: T } } })
  const runs = await db.classRun.deleteMany({ where: { trainerId: T } })
  const packages = await db.package.deleteMany({ where: { trainerId: T } })
  const subs = await db.subscriber.deleteMany({ where: { trainerId: T } })

  // Clients + dogs. Primary dogs are referenced by ClientProfile.dogId and carry
  // no clientProfileId, so release that FK first, then delete additional dogs,
  // profiles, and finally the (now-unreferenced) primary dogs.
  const profiles = await db.clientProfile.findMany({
    where: { trainerId: T },
    select: { id: true, userId: true, dogId: true },
  })
  const profileIds = profiles.map(p => p.id)
  const userIds = [...new Set(profiles.map(p => p.userId))]
  const primaryDogIds = profiles.map(p => p.dogId).filter((d): d is string => !!d)

  const cfv = await db.customFieldValue.deleteMany({ where: { clientId: { in: profileIds } } })
  await db.clientProfile.updateMany({ where: { trainerId: T }, data: { dogId: null } })
  const dogsA = await db.dog.deleteMany({ where: { clientProfileId: { in: profileIds } } })
  const profs = await db.clientProfile.deleteMany({ where: { trainerId: T } })
  const dogsP = await db.dog.deleteMany({ where: { id: { in: primaryDogIds } } })
  // Only clients left with no profile anywhere — never a trainer, never someone
  // who is still a client of a different business.
  const users = await db.user.deleteMany({
    where: { id: { in: userIds }, role: 'CLIENT', clientProfiles: { none: {} } },
  })

  return {
    attendance: attendance.count,
    enrolments: enrolments.count,
    runTrainers: runTrainers.count,
    sessions: sessions.count,
    clientPackages: clientPkgs.count,
    classRuns: runs.count,
    packages: packages.count,
    subscribers: subs.count,
    customFieldValues: cfv.count,
    dogs: dogsA.count + dogsP.count,
    profiles: profs.count,
    users: users.count,
  }
}
