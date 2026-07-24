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
    pkgIds.length ? prisma.package.findMany({ where: { id: { in: pkgIds } }, select: { id: true, name: true } }) : [],
    runIds.length ? prisma.classRun.findMany({ where: { id: { in: runIds } }, select: { id: true, name: true } }) : [],
    prodIds.length ? prisma.product.findMany({ where: { id: { in: prodIds } }, select: { id: true, name: true } }) : [],
  ])
  const nameOf = new Map<string, string>([...pkgs, ...runs, ...prods].map(x => [x.id, x.name]))

  return (
    <ClientMembershipsView
      currency={profile.trainer?.payoutCurrency ?? 'nzd'}
      memberships={memberships.map(m => ({
        id: m.id, name: m.name, description: m.description, priceCents: m.priceCents,
        items: m.items
          .map(it => {
            const id = it.packageId ?? it.classRunId ?? it.productId
            return { label: id ? nameOf.get(id) ?? '' : '', quantity: it.quantity }
          })
          .filter(x => x.label),
      }))}
    />
  )
}
