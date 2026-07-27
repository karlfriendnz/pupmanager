import { prisma } from './prisma'
import { hasAddon } from './billing'

// The client-facing shape of a published membership (matches ClientMembershipsView's
// card): card styling + resolved included-item labels/images/descriptions.
export interface ClientMembershipItem { label: string; quantity: number; imageUrl: string | null; description: string | null }
export type ClientMembershipInterval = 'WEEK' | 'FORTNIGHT' | 'MONTH'
export interface ClientMembership {
  id: string; name: string; description: string | null; priceCents: number
  imageUrl: string | null; bgColor: string | null; headerColor: string | null; textColor: string | null; featuredColor: string | null
  buttonBgColor: string | null; buttonTextColor: string | null; buttonText: string | null
  items: ClientMembershipItem[]
  cadence: 'ONE_OFF' | 'RECURRING'
  /** Billing period of the headline price. Null for a one-off. */
  interval: ClientMembershipInterval | null
  /** Extra billing options a RECURRING plan offers (e.g. $10/wk OR $35/mo). */
  plans: { id: string; interval: ClientMembershipInterval; priceCents: number }[]
  /**
   * Can a client actually check this out right now? Only ONE_OFF can — the buy
   * route refuses RECURRING with a 409 until the mandate layer ships. The UI
   * reads this rather than re-deriving the rule, so a listing can never offer a
   * button the API would reject.
   */
  buyable: boolean
  /**
   * Why checkout can't take it — drives the card's explanation. Null when it is
   * buyable. Mirrors what POST …/request would record.
   */
  blockedReason: 'RECURRING' | 'NO_PRICE' | null
  /** This client already has a PENDING request in for it. */
  requested: boolean
}

/**
 * Load a trainer's published memberships for the client storefront, resolving
 * each included item's name/image/description (per-item override wins;
 * otherwise the offering's own — a class run's blurb comes from its package).
 * Shared by the Memberships storefront and the Offerings flow.
 *
 * Recurring plans come back too, flagged `buyable: false`. They used to be
 * filtered out here, which meant a trainer whose only published membership was
 * recurring saw NOTHING on either screen — no card, no "Packages" type in the
 * booking flow, and no explanation. Showing it and saying it has to be set up
 * by the trainer is honest; hiding their published work is not.
 */
export async function loadPublishedMemberships(trainerId: string, clientId?: string): Promise<ClientMembership[]> {
  // Memberships are a trainer add-on: switched off, clients see none of them —
  // including in the Offerings flow, where they'd otherwise still be buyable.
  if (!(await hasAddon(trainerId, 'memberships'))) return []

  const memberships = await prisma.membership.findMany({
    where: { trainerId, published: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: { items: { orderBy: { order: 'asc' } }, plans: { orderBy: { order: 'asc' } } },
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
  // Which of these this client has already asked for. Read from the DB rather
  // than kept in component state so "Requested" survives a reload — otherwise
  // someone taps five times wondering whether the first one worked.
  const requestedIds = clientId
    ? new Set((await prisma.membershipRequest.findMany({
        where: { clientId, status: 'PENDING', membershipId: { in: memberships.map(m => m.id) } },
        select: { membershipId: true },
      })).map(r => r.membershipId))
    : new Set<string>()

  const nameOf = new Map<string, string>([...pkgs, ...runs, ...prods].map(x => [x.id, x.name]))
  const imgOf = new Map<string, string | null>([...runs, ...prods].map(x => [x.id, x.imageUrl ?? null]))
  const descOf = new Map<string, string | null>([
    ...pkgs.map(x => [x.id, x.description ?? null] as const),
    ...runs.map(x => [x.id, x.package?.description ?? null] as const),
    ...prods.map(x => [x.id, x.description ?? null] as const),
  ])

  return memberships.map(m => ({
    id: m.id, name: m.name, description: m.description, priceCents: m.priceCents,
    imageUrl: m.imageUrl, bgColor: m.bgColor, headerColor: m.headerColor, textColor: m.textColor, featuredColor: m.featuredColor,
    buttonBgColor: m.buttonBgColor, buttonTextColor: m.buttonTextColor, buttonText: m.buttonText,
    cadence: m.cadence as 'ONE_OFF' | 'RECURRING',
    interval: m.cadence === 'RECURRING' ? ((m.interval ?? null) as ClientMembershipInterval | null) : null,
    plans: m.cadence === 'RECURRING'
      ? m.plans.map(p => ({ id: p.id, interval: p.interval as ClientMembershipInterval, priceCents: p.priceCents }))
      : [],
    buyable: m.cadence === 'ONE_OFF' && m.priceCents > 0,
    blockedReason: m.cadence !== 'ONE_OFF' ? 'RECURRING' : m.priceCents <= 0 ? 'NO_PRICE' : null,
    requested: requestedIds.has(m.id),
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
