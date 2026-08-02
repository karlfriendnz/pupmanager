import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AchievementsManager } from './achievements-manager'
import type { TriggerType } from './triggers'
import { hasAddon } from '@/lib/billing'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'
import { addonSettingsHref } from '@/lib/configurable-features'

export const metadata: Metadata = { title: 'Achievements' }

export default async function AchievementsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
    select: { id: true },
  })
  if (!trainerProfile) redirect('/login')
  if (!(await hasAddon(trainerProfile.id, 'achievements'))) redirect(addonSettingsHref('achievements'))

  const achievements = await prisma.achievement.findMany({
    where: { trainerId: trainerProfile.id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })

  return (
    <>
      <PageHeader title="Achievements" />
      {/* Full width, like every other list. Badges are pictures, and a column
          of them down the middle of a desktop screen wastes the room the grid
          view needs. */}
      <div className="w-full p-4 md:p-8">
      <AchievementsManager
        initial={achievements.map(a => ({
          id: a.id,
          name: a.name,
          description: a.description,
          icon: a.icon,
          imageUrl: a.imageUrl,
          color: a.color,
          published: a.published,
          triggerType: a.triggerType as TriggerType,
          triggerValue: a.triggerValue,
        }))}
      />
      </div>
    </>
  )
}
