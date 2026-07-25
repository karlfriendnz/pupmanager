import { prisma } from './prisma'
import { hasAddon } from './billing'

// The client-facing shape of a published membership (matches ClientMembershipsView's
// card): card styling + resolved included-item labels/images/descriptions.
export interface ClientMembershipItem { label: string; quantity: number; imageUrl: string | null; description: string | null }
export interface ClientMembership {
  id: string; name: string; description: string | null; priceCents: number
  imageUrl: string | null; bgColor: string | null; headerColor: string | null; textColor: string | null; featuredColor: string | null; buttonText: string | null
  items: ClientMembershipItem[]
}

/**
 * Load a trainer's published, one-off (buyable) memberships for the client
 * storefront, resolving each included item's name/image/description (per-item
 * override wins; otherwise the offering's own — a class run's blurb comes from
 * its package). Shared by the Memberships storefront and the Offerings flow.
 */
export async function loadPublishedMemberships(trainerId: string): Promise<ClientMembership[]> {
  // Memberships are a trainer add-on: switched off, clients see none of them —
  // including in the Offerings flow, where they'd otherwise still be buyable.
  if (!(await hasAddon(trainerId, 'memberships'))) return []

  const memberships = await prisma.membership.findMany({
    where: { trainerId, published: true, cadence: 'ONE_OFF' },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: { items: { orderBy: { order: 'asc' } } },
  })
  if (memberships.length === 0) return []

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
  const imgOf = new Map<string, string | null>([...runs, ...prods].map(x => [x.id, x.imageUrl ?? null]))
  const descOf = new Map<string, string | null>([
    ...pkgs.map(x => [x.id, x.description ?? null] as const),
    ...runs.map(x => [x.id, x.package?.description ?? null] as const),
    ...prods.map(x => [x.id, x.description ?? null] as const),
  ])

  return memberships.map(m => ({
    id: m.id, name: m.name, description: m.description, priceCents: m.priceCents,
    imageUrl: m.imageUrl, bgColor: m.bgColor, headerColor: m.headerColor, textColor: m.textColor, featuredColor: m.featuredColor, buttonText: m.buttonText,
    items: m.items
      .map(it => {
        const id = it.packageId ?? it.classRunId ?? it.productId
        return {
          label: id ? nameOf.get(id) ?? '' : '',
          quantity: it.quantity,
          imageUrl: it.imageUrl ?? (id ? imgOf.get(id) ?? null : null),
          description: it.description ?? (id ? descOf.get(id) ?? null : null),
        }
      })
      .filter(x => x.label),
  }))
}
