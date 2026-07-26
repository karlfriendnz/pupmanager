import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AchievementsManager } from './achievements-manager'
import type { TriggerType } from './triggers'
import { hasAddon } from '@/lib/billing'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Achievements' }

export default async function AchievementsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
    select: { id: true },
  })
  if (!trainerProfile) redirect('/login')
  if (!(await hasAddon(trainerProfile.id, 'achievements'))) redirect('/settings?tab=addons')

  const achievements = await prisma.achievement.findMany({
    where: { trainerId: trainerProfile.id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })

  return (
    <>
      <PageHeader title="Achievements" subtitle="Badges and milestones dogs earn as they train, to keep clients motivated." />
      <div className="p-4 md:p-8 w-full max-w-3xl mx-auto">
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
