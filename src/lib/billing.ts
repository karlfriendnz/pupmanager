// Shared billing helpers — price-ID resolution and the "what's on sale"
// config used by /billing/setup, /api/billing/checkout and the Stripe
// webhook. The Core base lives in SubscriptionPlan; seats + add-ons live
// in BillingItem. Both carry the same price shape (NZD default in
// `stripePriceId`, per-currency overrides in `stripePriceIdsByCurrency`),
// so resolvePriceId works for either.
import { prisma } from './prisma'
import { DEFAULT_CURRENCY, type CurrencyCode } from './pricing'

export interface PricedItem {
  stripePriceId: string | null
  stripePriceIdsByCurrency: unknown
}

/**
 * Resolve the Stripe Price ID for a currency. Per-currency overrides win;
 * NZD falls back to the legacy `stripePriceId` column. Returns null when
 * nothing is wired up (caller decides whether to fall back to NZD).
 */
export function resolvePriceId(item: PricedItem, currency: CurrencyCode): string | null {
  const byCurrency = (item.stripePriceIdsByCurrency ?? {}) as Record<string, string>
  return (
    byCurrency[currency] ??
    (currency === DEFAULT_CURRENCY ? item.stripePriceId : null) ??
    item.stripePriceId ??
    null
  )
}

/** Currencies that have a wired-up price for this item (NZD implied by the legacy column). */
export function configuredCurrencies(item: PricedItem): Set<string> {
  const byCurrency = (item.stripePriceIdsByCurrency ?? {}) as Record<string, string>
  const set = new Set<string>(Object.keys(byCurrency))
  if (item.stripePriceId) set.add(DEFAULT_CURRENCY)
  return set
}

const ITEM_SELECT = {
  id: true,
  kind: true,
  name: true,
  description: true,
  priceMonthly: true,
  stripePriceId: true,
  stripePriceIdsByCurrency: true,
  sortOrder: true,
} as const

const PLAN_SELECT = {
  id: true,
  name: true,
  stripePriceId: true,
  stripePriceIdsByCurrency: true,
} as const

export type BillingItemRow = {
  id: string
  kind: 'SEAT' | 'ADDON'
  name: string
  description: string | null
  priceMonthly: number
  stripePriceId: string | null
  stripePriceIdsByCurrency: unknown
  sortOrder: number
}

export type CorePlanRow = {
  id: string
  name: string
  stripePriceId: string | null
  stripePriceIdsByCurrency: unknown
}

export interface BillingConfig {
  core: CorePlanRow | null
  seat: BillingItemRow | null
  addons: BillingItemRow[]
}

/**
 * Load the active billable items: the Core plan (cheapest active paid
 * SubscriptionPlan), the per-seat item, and the toggleable add-ons.
 */
export async function loadBillingConfig(): Promise<BillingConfig> {
  const [core, items] = await Promise.all([
    prisma.subscriptionPlan.findFirst({
      where: { isActive: true, priceMonthly: { gt: 0 } },
      orderBy: { priceMonthly: 'asc' },
      select: PLAN_SELECT,
    }),
    prisma.billingItem.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: ITEM_SELECT,
    }),
  ])

  const rows = items as BillingItemRow[]
  return {
    core: core as CorePlanRow | null,
    seat: rows.find((i) => i.kind === 'SEAT') ?? null,
    addons: rows.filter((i) => i.kind === 'ADDON'),
  }
}

/**
 * Reverse lookup: given a Stripe Price ID, which billable thing is it?
 * Used by the webhook to map subscription line items back to core / seat /
 * add-on. Returns a tag the webhook can act on.
 */
export async function classifyPriceId(
  priceId: string,
): Promise<
  | { type: 'core'; planId: string }
  | { type: 'seat'; itemId: string }
  | { type: 'addon'; itemId: string }
  | null
> {
  // Core lives in subscription_plans. Match the legacy column first, then
  // scan per-currency maps in memory (the plan set is tiny).
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { stripePriceId: priceId },
    select: { id: true },
  })
  if (plan) return { type: 'core', planId: plan.id }

  const plans = await prisma.subscriptionPlan.findMany({
    select: { id: true, stripePriceIdsByCurrency: true },
  })
  const planByCurrency = plans.find((p) => {
    const byCurrency = (p.stripePriceIdsByCurrency ?? {}) as Record<string, string>
    return Object.values(byCurrency).includes(priceId)
  })
  if (planByCurrency) return { type: 'core', planId: planByCurrency.id }

  const item = await findBillingItemByPriceId(priceId)
  if (item) {
    return item.kind === 'SEAT'
      ? { type: 'seat', itemId: item.id }
      : { type: 'addon', itemId: item.id }
  }
  return null
}

export type PriceClassification =
  | { type: 'core'; id: string }
  | { type: 'seat'; id: string }
  | { type: 'addon'; id: string }

/**
 * Build a one-shot index from every wired Stripe Price ID (NZD column +
 * each per-currency entry) to what it represents. The webhook uses this to
 * classify a subscription's line items in a single pass instead of a query
 * per item. Plans/items are a tiny set, so this is cheap.
 */
export async function loadPriceIndex(): Promise<Map<string, PriceClassification>> {
  const [plans, items] = await Promise.all([
    prisma.subscriptionPlan.findMany({
      select: { id: true, stripePriceId: true, stripePriceIdsByCurrency: true },
    }),
    prisma.billingItem.findMany({ select: ITEM_SELECT }),
  ])

  const index = new Map<string, PriceClassification>()
  const add = (priceId: string | null | undefined, value: PriceClassification) => {
    if (priceId) index.set(priceId, value)
  }
  const eachPriceId = (row: PricedItem, fn: (id: string) => void) => {
    if (row.stripePriceId) fn(row.stripePriceId)
    const byCurrency = (row.stripePriceIdsByCurrency ?? {}) as Record<string, string>
    for (const id of Object.values(byCurrency)) fn(id)
  }

  for (const plan of plans) {
    eachPriceId(plan, (id) => add(id, { type: 'core', id: plan.id }))
  }
  for (const item of items as BillingItemRow[]) {
    const type = item.kind === 'SEAT' ? 'seat' : 'addon'
    eachPriceId(item, (id) => add(id, { type, id: item.id }))
  }
  return index
}

/**
 * Find a BillingItem by any of its Stripe Price IDs (NZD column or any
 * per-currency entry). JSON containment can't reliably match a scalar
 * value across arbitrary keys in Postgres, so we match the column first
 * and fall back to an in-memory scan of the small item set.
 */
export async function findBillingItemByPriceId(priceId: string): Promise<BillingItemRow | null> {
  const direct = await prisma.billingItem.findFirst({
    where: { stripePriceId: priceId },
    select: ITEM_SELECT,
  })
  if (direct) return direct as BillingItemRow

  const all = (await prisma.billingItem.findMany({ select: ITEM_SELECT })) as BillingItemRow[]
  return (
    all.find((i) => {
      const byCurrency = (i.stripePriceIdsByCurrency ?? {}) as Record<string, string>
      return Object.values(byCurrency).includes(priceId)
    }) ?? null
  )
}
