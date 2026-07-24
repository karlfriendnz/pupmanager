import { prisma } from './prisma'
import { addonById } from './pricing'

const DAY_MS = 24 * 60 * 60 * 1000

export interface ActiveComp {
  itemId: string
  name: string
  expiresAt: Date
  daysLeft: number
}

/**
 * Active admin comp grants for this trainer that have a FUTURE expiry — the
 * source for the in-app "X days left of your free <add-on> trial" banner.
 * Open-ended comps (no expiry) aren't returned: nothing is counting down.
 */
export async function activeAddonComps(trainerId: string): Promise<ActiveComp[]> {
  const now = Date.now()
  const rows = await prisma.trainerAddon.findMany({
    where: { trainerId, grantedByAdmin: true, active: true, expiresAt: { gt: new Date(now) } },
    select: { itemId: true, expiresAt: true },
    orderBy: { expiresAt: 'asc' },
  })
  return rows.map(r => ({
    itemId: r.itemId,
    name: addonById(r.itemId)?.name ?? r.itemId,
    expiresAt: r.expiresAt!,
    daysLeft: Math.max(0, Math.ceil((r.expiresAt!.getTime() - now) / DAY_MS)),
  }))
}
