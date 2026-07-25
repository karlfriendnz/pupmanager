import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MembershipsView } from './memberships-view'

export const metadata: Metadata = { title: 'Memberships' }

// Combo memberships: bundle offerings into one purchasable plan. Loads the
// trainer's memberships plus the offerings they can include (1:1 packages,
// class runs, products).
export default async function MembershipsPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const [memberships, packages, classRuns, products, trainer] = await Promise.all([
    prisma.membership.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      include: { items: { orderBy: { order: 'asc' } }, _count: { select: { purchases: true } } },
    }),
    prisma.package.findMany({ where: { trainerId, isGroup: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, priceCents: true, specialPriceCents: true, description: true } }),
    prisma.classRun.findMany({ where: { trainerId, status: { not: 'CANCELLED' } }, orderBy: { startDate: 'desc' }, select: { id: true, name: true, imageUrl: true, package: { select: { description: true } } } }),
    prisma.product.findMany({ where: { trainerId }, orderBy: { name: 'asc' }, select: { id: true, name: true, priceCents: true, imageUrl: true, description: true } }),
    prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { payoutCurrency: true } }),
  ])

  return (
    <MembershipsView
      memberships={memberships.map(m => ({
        id: m.id, name: m.name, description: m.description, priceCents: m.priceCents,
        imageUrl: m.imageUrl, bgColor: m.bgColor, headerColor: m.headerColor, textColor: m.textColor, featuredColor: m.featuredColor, buttonText: m.buttonText,
        cadence: m.cadence, interval: m.interval, minTermCount: m.minTermCount, earlyTermFeeCents: m.earlyTermFeeCents,
        published: m.published, purchases: m._count.purchases,
        items: m.items.map(i => ({ kind: i.kind, packageId: i.packageId, classRunId: i.classRunId, productId: i.productId, quantity: i.quantity, regrantOnRenewal: i.regrantOnRenewal, imageUrl: i.imageUrl, description: i.description })),
      }))}
      offerings={{
        packages: packages.map(p => ({ id: p.id, name: p.name, priceCents: (p.specialPriceCents ?? p.priceCents) ?? undefined, description: p.description ?? null })),
        classRuns: classRuns.map(r => ({ id: r.id, name: r.name, imageUrl: r.imageUrl ?? null, description: r.package?.description ?? null })),
        products: products.map(p => ({ id: p.id, name: p.name, priceCents: p.priceCents ?? undefined, imageUrl: p.imageUrl ?? null, description: p.description ?? null })),
      }}
      currency={trainer?.payoutCurrency ?? 'nzd'}
    />
  )
}
