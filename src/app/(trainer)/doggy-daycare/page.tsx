import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { hasAddon } from '@/lib/billing'
import { listPuppySchools, getPuppySchoolWeek } from '@/lib/puppy-school'
import { PuppySchoolView } from './puppy-school-view'

export const metadata: Metadata = { title: 'Doggy Daycare' }

// The Puppy School workspace home: a live week board of day-part occupancy,
// plus setup. Gated by the puppyschool add-on (off until the trainer enables
// it), mirroring the Events page gate.
export default async function PuppySchoolPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  if (!(await hasAddon(trainerId, 'puppyschool'))) redirect('/settings?tab=addons')

  // Which weekdays the board shows comes from the daycare's own day-parts
  // (board.openDays) — not TrainerProfile.scheduleDays, which belongs to the
  // scheduler. Configured in Settings → Daycare.
  const [schools, board] = await Promise.all([
    listPuppySchools(trainerId),
    getPuppySchoolWeek(trainerId),
  ])
  return <PuppySchoolView schools={schools} board={board} />
}
