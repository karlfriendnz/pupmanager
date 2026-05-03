import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ClientHomeView } from './home-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Home' }

// Monday-anchored start of the current week in the user's local time. Good
// enough for a homework window — exact tz handling can come later.
function startOfWeek(now: Date) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day) // shift back to Monday
  d.setDate(d.getDate() + diff)
  return d
}
function endOfWeek(now: Date) {
  const start = startOfWeek(now)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return end
}

export default async function ClientHomePage() {
  const session = await auth()
  if (!session) redirect('/login')

  const clientProfile = await prisma.clientProfile.findUnique({
    where: { userId: session.user.id },
    include: {
      trainer: { select: { id: true, businessName: true, logoUrl: true, dashboardBgUrl: true } },
      dog: { select: { id: true, name: true, breed: true, photoUrl: true } },
      dogs: { select: { id: true, name: true, breed: true, photoUrl: true } },
    },
  })
  if (!clientProfile) redirect('/login')

  const allDogs = [
    ...(clientProfile.dog ? [clientProfile.dog] : []),
    ...clientProfile.dogs,
  ]
  const primaryDog = allDogs[0] ?? null

  const now = new Date()
  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)

  const [
    upcomingSession,
    recentSessions,
    weekTasks,
    latestMessage,
    activeClientPackage,
    featuredProducts,
    libraryProducts,
    pendingRequests,
    allAchievements,
    earnedAchievements,
  ] = await Promise.all([
    prisma.trainingSession.findFirst({
      where: {
        clientId: clientProfile.id,
        scheduledAt: { gte: now },
        status: 'UPCOMING',
      },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        durationMins: true,
        location: true,
        sessionType: true,
        virtualLink: true,
      },
    }),
    prisma.trainingSession.findMany({
      where: {
        clientId: clientProfile.id,
        status: { in: ['COMPLETED', 'COMMENTED', 'INVOICED'] },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 5,
      select: {
        id: true,
        title: true,
        scheduledAt: true,
      },
    }),
    prisma.trainingTask.findMany({
      where: {
        clientId: clientProfile.id,
        date: { gte: weekStart, lt: weekEnd },
      },
      orderBy: [{ date: 'asc' }, { order: 'asc' }],
      select: {
        id: true,
        title: true,
        repetitions: true,
        completion: { select: { id: true } },
      },
    }),
    prisma.message.findFirst({
      where: { clientId: clientProfile.id, channel: 'TRAINER_CLIENT' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        body: true,
        createdAt: true,
        readAt: true,
        senderId: true,
        sender: { select: { name: true } },
      },
    }),
    prisma.clientPackage.findFirst({
      where: { clientId: clientProfile.id },
      orderBy: { assignedAt: 'desc' },
      select: {
        id: true,
        package: { select: { name: true, sessionCount: true } },
        sessions: { select: { id: true, status: true } },
      },
    }),
    prisma.product.findMany({
      where: { trainerId: clientProfile.trainer.id, active: true, featured: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      take: 6,
      select: {
        id: true, name: true, kind: true, priceCents: true, imageUrl: true,
      },
    }),
    prisma.product.findMany({
      where: { trainerId: clientProfile.trainer.id, active: true, kind: 'DIGITAL' },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      take: 6,
      select: {
        id: true, name: true, description: true, downloadUrl: true,
      },
    }),
    prisma.productRequest.findMany({
      where: { clientId: clientProfile.id, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        product: { select: { id: true, name: true } },
      },
    }),
    prisma.achievement.findMany({
      where: { trainerId: clientProfile.trainer.id },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, icon: true, color: true },
    }),
    prisma.clientAchievement.findMany({
      where: { clientId: clientProfile.id },
      select: { achievementId: true },
    }),
  ])

  const earnedSet = new Set(earnedAchievements.map(e => e.achievementId))

  // Package progress = sessions that aren't UPCOMING.
  const packageProgress = activeClientPackage
    ? {
        label: activeClientPackage.package.name,
        completed: activeClientPackage.sessions.filter(s => s.status !== 'UPCOMING').length,
        total: activeClientPackage.package.sessionCount,
      }
    : null

  // Latest message — only shown if it's from someone other than the client.
  const latestMessageProp = latestMessage && latestMessage.senderId !== session.user.id
    ? {
        from: latestMessage.sender.name ?? 'Your trainer',
        preview: latestMessage.body,
        createdAt: latestMessage.createdAt.toISOString(),
        unread: latestMessage.readAt === null,
      }
    : null

  return (
    <ClientHomeView
      clientName={session.user.name ?? 'there'}
      businessName={clientProfile.trainer.businessName}
      dashboardBgUrl={clientProfile.trainer.dashboardBgUrl}
      trainerLogoUrl={clientProfile.trainer.logoUrl}
      primaryDog={primaryDog}
      upcomingSession={upcomingSession ? {
        id: upcomingSession.id,
        title: upcomingSession.title,
        scheduledAt: upcomingSession.scheduledAt.toISOString(),
        durationMins: upcomingSession.durationMins,
        location: upcomingSession.location,
        sessionType: upcomingSession.sessionType,
      } : null}
      recentSessions={recentSessions.map(s => ({
        id: s.id,
        title: s.title,
        scheduledAt: s.scheduledAt.toISOString(),
      }))}
      homework={weekTasks.map(t => ({
        id: t.id,
        title: t.title,
        repetitions: t.repetitions,
        done: t.completion !== null,
      }))}
      latestMessage={latestMessageProp}
      packageProgress={packageProgress}
      featuredProducts={featuredProducts.map(p => ({
        id: p.id,
        name: p.name,
        kind: p.kind as 'PHYSICAL' | 'DIGITAL',
        priceCents: p.priceCents,
        imageUrl: p.imageUrl,
      }))}
      libraryItems={libraryProducts.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        downloadUrl: p.downloadUrl,
      }))}
      pendingRequests={pendingRequests.map(r => ({
        id: r.id,
        productId: r.product.id,
        productName: r.product.name,
      }))}
      achievements={allAchievements.map(a => ({
        id: a.id,
        name: a.name,
        icon: a.icon,
        color: a.color,
        earned: earnedSet.has(a.id),
      }))}
    />
  )
}
