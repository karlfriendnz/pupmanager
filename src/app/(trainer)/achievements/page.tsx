import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AchievementsManager } from './achievements-manager'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Achievements' }

export default async function AchievementsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!trainerProfile) redirect('/login')

  const achievements = await prisma.achievement.findMany({
    where: { trainerId: trainerProfile.id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })

  return (
    <>
      <PageHeader title="Achievements" />
      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
      <p className="text-sm text-slate-500 mb-6">
        Build a catalogue of badges your clients can earn — first session completed, off-leash recall, 30-day streak, anything that fits your programme.
      </p>

      <AchievementsManager
        initial={achievements.map(a => ({
          id: a.id,
          name: a.name,
          description: a.description,
          icon: a.icon,
          color: a.color,
          published: a.published,
          triggerType: a.triggerType,
          triggerValue: a.triggerValue,
        }))}
      />
      </div>
    </>
  )
}
