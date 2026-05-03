import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Eye } from 'lucide-react'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { AppShell } from '@/components/shared/app-shell'
import { ClientHomeView } from '@/app/(client)/home/home-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Preview as client' }

// Mirrors /src/app/(client)/home/page.tsx — Monday-anchored window for the
// homework strip.
function startOfWeek(now: Date) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}
function endOfWeek(now: Date) {
  const start = startOfWeek(now)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return end
}

export default async function PreviewAsClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')

  const { clientId } = await params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) notFound()

  const clientProfile = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    include: {
      user: { select: { name: true, email: true } },
      trainer: {
        select: {
          id: true,
          businessName: true,
          logoUrl: true,
          dashboardBgUrl: true,
        },
      },
      dog: { select: { id: true, name: true, breed: true, photoUrl: true } },
      dogs: { select: { id: true, name: true, breed: true, photoUrl: true } },
    },
  })
  if (!clientProfile) notFound()

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
      where: { clientId: clientProfile.id, scheduledAt: { gte: now }, status: 'UPCOMING' },
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
      where: { clientId: clientProfile.id, status: { in: ['COMPLETED', 'COMMENTED', 'INVOICED'] } },
      orderBy: { scheduledAt: 'desc' },
      take: 5,
      select: { id: true, title: true, scheduledAt: true },
    }),
    prisma.trainingTask.findMany({
      where: { clientId: clientProfile.id, date: { gte: weekStart, lt: weekEnd } },
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
      select: { id: true, name: true, kind: true, priceCents: true, imageUrl: true },
    }),
    prisma.product.findMany({
      where: { trainerId: clientProfile.trainer.id, active: true, kind: 'DIGITAL' },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      take: 6,
      select: { id: true, name: true, description: true, downloadUrl: true },
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

  const packageProgress = activeClientPackage
    ? {
        label: activeClientPackage.package.name,
        completed: activeClientPackage.sessions.filter(s => s.status !== 'UPCOMING').length,
        total: activeClientPackage.package.sessionCount,
      }
    : null

  // The preview only shows incoming messages — the trainer-as-themself's
  // sentMessages get filtered out the same way they would in the real app.
  const latestMessageProp = latestMessage && latestMessage.senderId !== clientProfile.userId
    ? {
        from: latestMessage.sender.name ?? 'Your trainer',
        preview: latestMessage.body,
        createdAt: latestMessage.createdAt.toISOString(),
        unread: latestMessage.readAt === null,
      }
    : null

  const clientName = clientProfile.user.name ?? clientProfile.user.email

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col">
      <PreviewBanner clientId={clientId} clientName={clientName} />
      <div className="flex-1">
        <AppShell
          role="CLIENT"
          userName={clientProfile.user.name ?? ''}
          userEmail={clientProfile.user.email ?? ''}
          trainerLogo={clientProfile.trainer.logoUrl}
          businessName={clientProfile.trainer.businessName}
        >
          <ClientHomeView
            clientName={clientProfile.user.name ?? 'there'}
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
        </AppShell>
      </div>
    </div>
  )
}

function PreviewBanner({ clientId, clientName }: { clientId: string; clientName: string }) {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 py-2 bg-gradient-to-r from-amber-50 via-amber-100 to-amber-50 border-b border-amber-200 text-amber-900 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Eye className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="font-medium truncate">
          Previewing as <span className="font-semibold">{clientName}</span>
        </span>
        <span className="hidden sm:inline text-xs text-amber-700/80">the client cannot see this · some links may not work as you</span>
      </div>
      <Link
        href={`/clients/${clientId}`}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/70 hover:bg-white text-amber-800 text-xs font-medium transition-colors shrink-0"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Exit preview
      </Link>
    </div>
  )
}
