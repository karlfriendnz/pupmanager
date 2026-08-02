import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { PackagesView } from './packages-view'
import { isPackagePast, type PackageAssignment } from './past-packages'
import { notYetShowingBadge, visibleFromDateStr } from '@/lib/offering-visibility'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: '1:1 Sessions' }

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  // Turned off on Configure? The nav item is hidden, but a bookmark or a stale
  // tab would still land here — a hidden door is not a closed one.
  if (!(await hasAddon(trainerId, 'onetoone'))) redirect('/settings?tab=configure')

  const { connect } = await searchParams

  const [packages, assignments, trainer] = await Promise.all([
    prisma.package.findMany({
      // 1:1 packages only. A group package is the template behind a class and
      // belongs under Group Classes — listing it here showed the same thing in
      // two places, and "assign this to a client" makes no sense for a cohort.
      where: { trainerId, isGroup: false },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { assignments: true, sessionPlans: true } } },
    }),
    // What each assignment is doing, for the Current/Past split. Only the LAST
    // session of each is needed ("has this finished?"), so this stays one row
    // per assignment however many sessions it has.
    prisma.clientPackage.findMany({
      where: { package: { trainerId, isGroup: false } },
      select: {
        packageId: true,
        extendIndefinitely: true,
        sessions: { select: { scheduledAt: true }, orderBy: { scheduledAt: 'desc' }, take: 1 },
      },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      // The timezone is what turns the stored instant back into the day the
      // trainer typed, for the "hold this back until" picker.
      select: { payoutCurrency: true, user: { select: { timezone: true } } },
    }),
  ])
  const currency = (trainer?.payoutCurrency ?? 'NZD').toUpperCase()
  const tz = trainer?.user?.timezone || 'Pacific/Auckland'

  const byPackage = new Map<string, PackageAssignment[]>()
  for (const a of assignments) {
    const list = byPackage.get(a.packageId) ?? []
    list.push({
      extendIndefinitely: a.extendIndefinitely,
      lastSessionAt: a.sessions[0]?.scheduledAt.getTime() ?? null,
    })
    byPackage.set(a.packageId, list)
  }
  // new Date(), not Date.now() — the compiler's purity rule treats the latter
  // as a call it can't move, and every sibling offering page reads it this way.
  const now = new Date().getTime()

  return (
    <PackagesView
      initialPackages={packages.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        sessionCount: p.sessionCount,
        weeksBetween: p.weeksBetween,
        durationMins: p.durationMins,
        bufferMins: p.bufferMins,
        sessionType: p.sessionType,
        priceCents: p.priceCents,
        specialPriceCents: p.specialPriceCents,
        color: (p.color ?? null) as 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'orange' | 'teal' | 'indigo' | 'pink' | 'cyan' | null,
        defaultSessionFormId: p.defaultSessionFormId ?? null,
        requireSessionNotes: p.requireSessionNotes,
        isGroup: p.isGroup,
        capacity: p.capacity,
        allowDropIn: p.allowDropIn,
        dropInPriceCents: p.dropInPriceCents,
        allowWaitlist: p.allowWaitlist,
        publicEnrollment: p.publicEnrollment,
        clientSelfBook: p.clientSelfBook,
        selfBookRequiresApproval: p.selfBookRequiresApproval,
        requirePayment: p.requirePayment,
        visibleFromDate: visibleFromDateStr(p.visibleFrom, tz),
        // Computed here, where the instant is — see notYetShowingBadge.
        notYetShowing: notYetShowingBadge(p.visibleFrom) !== null,
        assignments: p._count.assignments,
        // A consult that runs a curriculum says so on the list — otherwise the
        // only way to tell a series from a plain six-session consult is to open
        // it and find the Curriculum tab.
        seriesSteps: p._count.sessionPlans,
        isPast: isPackagePast(byPackage.get(p.id) ?? [], now),
      }))}
      connectName={connect ?? null}
      currency={currency}
    />
  )
}
