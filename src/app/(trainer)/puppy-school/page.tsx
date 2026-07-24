import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { listPuppySchools, getPuppySchoolWeek } from '@/lib/puppy-school'
import { PuppySchoolView } from './puppy-school-view'

export const metadata: Metadata = { title: 'Puppy School' }

// The Puppy School workspace home: a live week board of day-part occupancy,
// plus setup. Gated by the puppyschool add-on (off until the trainer enables
// it), mirroring the Events page gate.
export default async function PuppySchoolPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  if (!(await hasAddon(trainerId, 'puppyschool'))) redirect('/settings?tab=addons')

  const [schools, board, profile] = await Promise.all([
    listPuppySchools(trainerId),
    getPuppySchoolWeek(trainerId),
    prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { scheduleDays: true } }),
  ])
  // Shared with the scheduler: which weekdays (1=Mon..7=Sun) to show.
  const scheduleDays = Array.isArray(profile?.scheduleDays) ? (profile.scheduleDays as number[]) : [1, 2, 3, 4, 5, 6, 7]
  return <PuppySchoolView schools={schools} board={board} scheduleDays={scheduleDays} />
}
