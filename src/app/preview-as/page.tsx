import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DemoClientPreview } from './demo-preview'

// Index for the "preview as client" feature. /preview-as/[clientId] is the
// real renderer for a trainer's actual client. When the trainer has no clients
// yet (typical during onboarding), we render a synthetic demo preview using
// hardcoded sample data so they can still see what the client experience
// looks like.

export default async function PreviewAsIndexPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const [client, profile, achievements] = await Promise.all([
    prisma.clientProfile.findFirst({
      where: { trainerId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { businessName: true, logoUrl: true, dashboardBgUrl: true },
    }),
    prisma.achievement.findMany({
      where: { trainerId, published: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, icon: true, color: true },
      take: 8,
    }),
  ])

  if (client) redirect(`/preview-as/${client.id}`)

  // No real clients — render the synthetic demo using the trainer's branding
  // + their published achievements so the preview reflects their setup.
  return (
    <DemoClientPreview
      businessName={profile?.businessName || 'Your business'}
      logoUrl={profile?.logoUrl ?? null}
      dashboardBgUrl={profile?.dashboardBgUrl ?? null}
      achievements={achievements}
    />
  )
}
