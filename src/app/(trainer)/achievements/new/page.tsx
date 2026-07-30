import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { PageHeader } from '@/components/shared/page-header'
import { AchievementForm, EMPTY_ACHIEVEMENT } from '../achievement-form'
import type { Metadata } from 'next'
import { addonSettingsHref } from '@/lib/configurable-features'

export const metadata: Metadata = { title: 'New achievement' }

export default async function NewAchievementPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const profile = await prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { id: true } })
  if (!profile) redirect('/login')
  if (!(await hasAddon(profile.id, 'achievements'))) redirect(addonSettingsHref('achievements'))

  return (
    <>
      <PageHeader title="New achievement" back={{ href: '/achievements', label: 'Achievements' }} />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-8">
        <AchievementForm isNew initial={EMPTY_ACHIEVEMENT} />
      </div>
    </>
  )
}
