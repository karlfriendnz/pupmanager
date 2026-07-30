import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { PageHeader } from '@/components/shared/page-header'
import { AchievementForm } from '../achievement-form'
import type { TriggerType } from '../triggers'
import type { Metadata } from 'next'
import { addonSettingsHref } from '@/lib/configurable-features'

export const metadata: Metadata = { title: 'Achievement' }

export default async function AchievementPage({ params }: { params: Promise<{ achievementId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  if (!(await hasAddon(trainerId, 'achievements'))) redirect(addonSettingsHref('achievements'))

  const { achievementId } = await params

  // Scoped by trainerId — another tenant's badge is a 404, not an edit form.
  const achievement = await prisma.achievement.findFirst({
    where: { id: achievementId, trainerId },
  })
  if (!achievement) notFound()

  return (
    <>
      <PageHeader title={achievement.name} back={{ href: '/achievements', label: 'Achievements' }} />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-8">
        <AchievementForm
          isNew={false}
          initial={{
            id: achievement.id,
            name: achievement.name,
            description: achievement.description,
            icon: achievement.icon,
            imageUrl: achievement.imageUrl,
            color: achievement.color,
            published: achievement.published,
            triggerType: achievement.triggerType as TriggerType,
            triggerValue: achievement.triggerValue,
          }}
        />
      </div>
    </>
  )
}
