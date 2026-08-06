import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { countPendingMembershipRequests } from '@/lib/membership-requests'
import { MembershipsView } from './memberships-view'
import { pastMembershipIds } from './past-memberships'
import { addonSettingsHref } from '@/lib/configurable-features'

export const metadata: Metadata = { title: 'Packages' }

// Combo packages: bundle offerings into one purchasable plan. Loads the
// trainer's packages plus the offerings they can include (1:1 sessions,
// class runs, products).
export default async function MembershipsPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  // An add-on: trainers without it are sent to the Add-ons tab (the nav shows a
  // locked "turn it on" row until then), same as Events and Doggy Daycare.
  if (!(await hasAddon(trainerId, 'memberships'))) redirect(addonSettingsHref('memberships'))

  const [memberships, packages, classRuns, products, trainer, achievements, clientRows, requestCounts] = await Promise.all([
    prisma.membership.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      include: {
        items: { orderBy: { order: 'asc' } },
        plans: { orderBy: { order: 'asc' } },
        prerequisites: { select: { achievementId: true } },
        _count: { select: { purchases: true } },
      },
    }),
    prisma.package.findMany({ where: { trainerId, isGroup: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, priceCents: true, specialPriceCents: true, description: true } }),
    prisma.classRun.findMany({ where: { trainerId, status: { not: 'CANCELLED' } }, orderBy: { startDate: 'desc' }, select: { id: true, name: true, imageUrl: true, package: { select: { description: true } } } }),
    prisma.product.findMany({ where: { trainerId }, orderBy: { name: 'asc' }, select: { id: true, name: true, priceCents: true, imageUrl: true, description: true } }),
    prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { payoutCurrency: true } }),
    // What a package can be gated on, and who can be invited to one. Sample
    // clients are excluded — inviting the demo data to a real package would be
    // confusing and does nothing.
    prisma.achievement.findMany({
      where: { trainerId, isSample: false },
      orderBy: { order: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.clientProfile.findMany({
      where: { trainerId, status: 'ACTIVE' },
      orderBy: { user: { name: 'asc' } },
      select: { id: true, user: { select: { name: true, email: true } } },
    }),
    // Clients waiting on each package. The trainer answers them on the
    // dashboard; the count here is so demand is visible where they'd go to fix
    // the reason it can't be bought (set a price, or think about the plan).
    countPendingMembershipRequests(trainerId),
  ])

  // Which of these have run their course — see ./past-memberships for the rule.
  const pastIds = await pastMembershipIds(prisma, memberships.map(m => m.id))

  return (
    <MembershipsView
      memberships={memberships.map(m => ({
        id: m.id, name: m.name, description: m.description, priceCents: m.priceCents,
        imageUrl: m.imageUrl, bgColor: m.bgColor, headerColor: m.headerColor, textColor: m.textColor, featuredColor: m.featuredColor,
        buttonBgColor: m.buttonBgColor, buttonTextColor: m.buttonTextColor, buttonText: m.buttonText,
        cadence: m.cadence, interval: m.interval, minTermCount: m.minTermCount, earlyTermFeeCents: m.earlyTermFeeCents,
        published: m.published, purchases: m._count.purchases, isPast: pastIds.has(m.id),
        eligibility: m.eligibility, showWhenLocked: m.showWhenLocked,
        prerequisiteIds: m.prerequisites.map(p => p.achievementId),
        pendingRequests: requestCounts.get(m.id) ?? 0,
        items: m.items.map(i => ({ kind: i.kind, packageId: i.packageId, classRunId: i.classRunId, productId: i.productId, quantity: i.quantity, regrantOnRenewal: i.regrantOnRenewal, imageUrl: i.imageUrl, description: i.description })),
        plans: m.plans.map(p => ({ interval: p.interval, intervalCount: p.intervalCount, priceCents: p.priceCents, minTermCount: p.minTermCount, earlyTermFeeCents: p.earlyTermFeeCents })),
      }))}
      offerings={{
        packages: packages.map(p => ({ id: p.id, name: p.name, priceCents: (p.specialPriceCents ?? p.priceCents) ?? undefined, description: p.description ?? null })),
        classRuns: classRuns.map(r => ({ id: r.id, name: r.name, imageUrl: r.imageUrl ?? null, description: r.package?.description ?? null })),
        products: products.map(p => ({ id: p.id, name: p.name, priceCents: p.priceCents ?? undefined, imageUrl: p.imageUrl ?? null, description: p.description ?? null })),
      }}
      currency={trainer?.payoutCurrency ?? 'nzd'}
      achievements={achievements}
      clients={clientRows.map(c => ({
        id: c.id,
        name: c.user?.name?.trim() || c.user?.email || 'Unnamed',
      }))}
    />
  )
}
