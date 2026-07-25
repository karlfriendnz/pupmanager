import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getActiveClient } from '@/lib/client-context'
import { prisma } from '@/lib/prisma'
import { ClientMembershipsView } from './memberships-view'

export const metadata: Metadata = { title: 'Memberships' }

// The client-facing storefront for a trainer's published one-off memberships.
export default async function ClientMembershipsPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { trainerId: true, trainer: { select: { payoutCurrency: true } } },
  })
  if (!profile) redirect('/login')

  const memberships = await prisma.membership.findMany({
    where: { trainerId: profile.trainerId, published: true, cadence: 'ONE_OFF' },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: { items: { orderBy: { order: 'asc' } } },
  })

  // Resolve the names of the included offerings for display.
  const pkgIds: string[] = [], runIds: string[] = [], prodIds: string[] = []
  for (const m of memberships) for (const it of m.items) {
    if (it.packageId) pkgIds.push(it.packageId)
    if (it.classRunId) runIds.push(it.classRunId)
    if (it.productId) prodIds.push(it.productId)
  }
  const [pkgs, runs, prods] = await Promise.all([
    pkgIds.length ? prisma.package.findMany({ where: { id: { in: pkgIds } }, select: { id: true, name: true, description: true } }) : [],
    runIds.length ? prisma.classRun.findMany({ where: { id: { in: runIds } }, select: { id: true, name: true, imageUrl: true, package: { select: { description: true } } } }) : [],
    prodIds.length ? prisma.product.findMany({ where: { id: { in: prodIds } }, select: { id: true, name: true, imageUrl: true, description: true } }) : [],
  ])
  const nameOf = new Map<string, string>([...pkgs, ...runs, ...prods].map(x => [x.id, x.name]))
  // Packages carry no image; class runs + products do. A class run's blurb comes
  // from its package; packages & products carry their own.
  const imgOf = new Map<string, string | null>([...runs, ...prods].map(x => [x.id, x.imageUrl ?? null]))
  const descOf = new Map<string, string | null>([
    ...pkgs.map(x => [x.id, x.description ?? null] as const),
    ...runs.map(x => [x.id, x.package?.description ?? null] as const),
    ...prods.map(x => [x.id, x.description ?? null] as const),
  ])

  return (
    <ClientMembershipsView
      currency={profile.trainer?.payoutCurrency ?? 'nzd'}
      memberships={memberships.map(m => ({
        id: m.id, name: m.name, description: m.description, priceCents: m.priceCents,
        imageUrl: m.imageUrl, bgColor: m.bgColor, headerColor: m.headerColor, textColor: m.textColor, featuredColor: m.featuredColor, buttonText: m.buttonText,
        items: m.items
          .map(it => {
            const id = it.packageId ?? it.classRunId ?? it.productId
            // Per-item override wins; otherwise pull in the offering's own.
            return {
              label: id ? nameOf.get(id) ?? '' : '',
              quantity: it.quantity,
              imageUrl: it.imageUrl ?? (id ? imgOf.get(id) ?? null : null),
              description: it.description ?? (id ? descOf.get(id) ?? null : null),
            }
          })
          .filter(x => x.label),
      }))}
    />
  )
}
