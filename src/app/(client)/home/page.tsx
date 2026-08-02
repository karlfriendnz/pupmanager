import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { NOT_SUSPENDED, SESSIONS_NOT_SUSPENDED } from '@/lib/membership-access'
import { getActiveClient } from '@/lib/client-context'
import { ClientHomeView } from './home-view'
import { AppInstallModal } from '../app-install-modal'
import { computeAchievementProgress } from '@/lib/achievements'
import { getEnabledAddons } from '@/lib/billing'
import { mergeClientDogs } from '@/lib/dogs'
import { productPriceSummary } from '@/lib/product-price'
import { todayInTz, weekBoundsUtcDates } from '@/lib/timezone'
import { clientVisibleHomeworkWhere } from '@/lib/homework-visibility'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Home' }

export default async function ClientHomePage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const clientProfile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    include: {
      user: { select: { name: true } },
      trainer: { select: { id: true, businessName: true, logoUrl: true, clientWelcomeNote: true, user: { select: { timezone: true } } } },
      dog: { select: { id: true, name: true, breed: true, photoUrl: true } },
      dogs: { select: { id: true, name: true, breed: true, photoUrl: true } },
    },
  })
  if (!clientProfile) redirect('/login')

  const allDogs = mergeClientDogs(clientProfile.dog, clientProfile.dogs)
  const primaryDog = allDogs[0] ?? null

  // Trainer-curated gallery for the primary dog — drives the home hero.
  const galleryMedia = primaryDog
    ? await prisma.dogMedia.findMany({
        where: { dogId: primaryDog.id },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, kind: true, url: true, thumbnailUrl: true },
      })
    : []

  const now = new Date()

  // Sessions happen in the trainer's locale, and so does "this week" — the week
  // has to roll over at the trainer's midnight, not the server's (Vercel is UTC).
  const timeZone = clientProfile.trainer.user?.timezone ?? 'Pacific/Auckland'

  // TrainingTask.date is a Postgres DATE (a calendar day, no time), so the
  // bounds are calendar days too — see weekBoundsUtcDates. The old version
  // built local-midnight *instants* and handed them to a DATE comparison,
  // which knocked the whole window a day earlier in any zone ahead of UTC: on
  // a Sunday `lt weekEnd` became "< today", so homework the trainer had set
  // for today vanished from the client's "This week" list entirely.
  const { weekStart, weekEnd } = weekBoundsUtcDates(todayInTz(timeZone))

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
    achievementProgress,
  ] = await Promise.all([
    prisma.trainingSession.findFirst({
      where: {
        clientId: clientProfile.id,
        scheduledAt: { gte: now },
        status: 'UPCOMING',
        // Hidden while the membership that granted it is unpaid.
        ...SESSIONS_NOT_SUSPENDED,
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
    // "Recap ready" has to MEAN a recap is ready. A completed session is not
    // the same thing: the write-up stays private until the trainer sends it
    // (formResponses.sentAt), so this promised a recap and then the detail
    // screen — correctly — had nothing to show.
    prisma.trainingSession.findMany({
      where: {
        clientId: clientProfile.id,
        status: { in: ['COMPLETED', 'COMMENTED', 'INVOICED'] },
        formResponses: { some: { sentAt: { not: null } } },
        ...SESSIONS_NOT_SUSPENDED,
      },
      orderBy: { scheduledAt: 'desc' },
      take: 5,
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        attachments: {
          where: { kind: { in: ['IMAGE', 'VIDEO'] } },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { kind: true, url: true, thumbnailUrl: true },
        },
      },
    }),
    prisma.trainingTask.findMany({
      where: {
        clientId: clientProfile.id,
        // Practice homework stays hidden until the session it came out of has
        // run — see lib/homework-visibility.
        AND: [
          clientVisibleHomeworkWhere(now),
          {
            OR: [
              { date: { gte: weekStart, lt: weekEnd } },
              // Preparation for a session that hasn't happened yet stays on the
              // list however far ahead it was handed out. It is dated at its
              // session, so a trainer who sends "bring a hungry dog and a pot
              // of chicken" two weeks early would otherwise have it appear the
              // week of the class — which is the one thing preparation must
              // never do.
              { timing: 'BEFORE_SESSION', session: { scheduledAt: { gte: now } } },
            ],
          },
        ],
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
      // The progress bar must not keep counting down a package they have lost
      // access to — that would read as "still going" while nothing works.
      where: { clientId: clientProfile.id, ...NOT_SUSPENDED },
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
        id: true, name: true, kind: true, priceCents: true, salePriceCents: true, imageUrl: true,
        // Enough to say "from $X · 3 options" rather than a single price a
        // varianted product doesn't have.
        variants: {
          where: { active: true },
          select: { priceCents: true, salePriceCents: true },
        },
      },
    }),
    // "Your library" = the downloads THIS CLIENT actually has. It used to be
    // every digital product the trainer sells, which put things they had never
    // bought under a heading that says they own them — and, having no download
    // of their own, those rows quietly linked to the shop instead.
    //
    // Having it means one of two things: they paid (a PaymentItem on a PAID
    // payment), or the trainer handed it over and marked the request fulfilled.
    prisma.product.findMany({
      where: {
        trainerId: clientProfile.trainer.id,
        active: true,
        kind: 'DIGITAL',
        OR: [
          { paymentItems: { some: { payment: { status: 'PAID', clientId: clientProfile.id } } } },
          { requests: { some: { clientId: clientProfile.id, fulfilledAt: { not: null } } } },
        ],
      },
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
      // Only published — drafts are trainer-side WIP and shouldn't surface
      // to clients (or to trainer-in-preview, since the goal is "what the
      // client sees").
      where: { trainerId: clientProfile.trainer.id, published: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, icon: true, imageUrl: true, color: true },
    }),
    prisma.clientAchievement.findMany({
      where: { clientId: clientProfile.id },
      select: { achievementId: true },
    }),
    computeAchievementProgress(clientProfile.id),
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
  const latestMessageProp = latestMessage && latestMessage.senderId !== active.userId
    ? {
        from: latestMessage.sender.name ?? 'Your trainer',
        preview: latestMessage.body,
        createdAt: latestMessage.createdAt.toISOString(),
        unread: latestMessage.readAt === null,
      }
    : null

  // Both are trainer add-ons — gate the home shop shortcut + product row, and the
  // achievements section. Asked once.
  const homeAddons = await getEnabledAddons(clientProfile.trainer.id)
  const shopEnabled = homeAddons.has('shop')
  const achievementsEnabled = homeAddons.has('achievements')

  return (
    <>
    <AppInstallModal />
    <ClientHomeView
      shopEnabled={shopEnabled}
      // Sessions happen in the trainer's locale — render them there, not in the
      // server's zone (UTC) or whatever zone the client's device is in.
      timeZone={timeZone}
      clientName={clientProfile.user.name ?? 'there'}
      businessName={clientProfile.trainer.businessName}
      welcomeNote={clientProfile.trainer.clientWelcomeNote}
      trainerLogoUrl={clientProfile.trainer.logoUrl}
      primaryDog={primaryDog}
      gallery={galleryMedia.map(m => ({ id: m.id, kind: m.kind as 'IMAGE' | 'VIDEO', url: m.url, thumbnailUrl: m.thumbnailUrl }))}
      upcomingSession={upcomingSession ? {
        id: upcomingSession.id,
        title: upcomingSession.title,
        scheduledAt: upcomingSession.scheduledAt.toISOString(),
        durationMins: upcomingSession.durationMins,
        location: upcomingSession.location,
        sessionType: upcomingSession.sessionType,
      } : null}
      recentSessions={recentSessions.map(s => {
        const m = s.attachments[0]
        return {
          id: s.id,
          title: s.title,
          scheduledAt: s.scheduledAt.toISOString(),
          mediaUrl: m ? (m.thumbnailUrl ?? m.url) : null,
          mediaKind: m?.kind ?? null,
        }
      })}
      homework={weekTasks.map(t => ({
        id: t.id,
        title: t.title,
        repetitions: t.repetitions,
        done: t.completion !== null,
      }))}
      latestMessage={latestMessageProp}
      packageProgress={packageProgress}
      featuredProducts={featuredProducts.map(p => {
        const summary = productPriceSummary(p, p.variants)
        return {
          id: p.id,
          name: p.name,
          kind: p.kind as 'PHYSICAL' | 'DIGITAL',
          priceCents: p.priceCents,
          salePriceCents: p.salePriceCents,
          imageUrl: p.imageUrl,
          optionCount: summary.count,
          fromCents: summary.from,
        }
      })}
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
      // Empty when the trainer's add-on is off, which hides the whole section —
      // the badges were showing on a client's home for businesses that had
      // switched achievements off (Karl, 2026-07-30).
      achievements={(achievementsEnabled ? allAchievements : []).map(a => ({
        id: a.id,
        name: a.name,
        icon: a.icon,
        imageUrl: a.imageUrl,
        color: a.color,
        earned: earnedSet.has(a.id),
        progress: achievementProgress[a.id] ?? null,
      }))}
    />
    </>
  )
}
