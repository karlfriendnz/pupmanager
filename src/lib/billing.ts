// Shared billing helpers — price-ID resolution and the "what's on sale"
// config used by /billing/setup, /api/billing/checkout, /api/billing/seats and
// the Stripe webhook. The Core base lives in SubscriptionPlan; seats + add-ons
// live in BillingItem. Both carry the same price shape.
//
// Dual-mode: each price-bearing row stores BOTH a live set (stripePriceId +
// stripePriceIdsByCurrency) and a test/sandbox set (…Test). `sandbox` selects
// which set to resolve against, so the demo account runs entirely on Stripe
// test mode while everyone else is on live.
import { prisma } from './prisma'
import { DEFAULT_CURRENCY, ADDONS, type CurrencyCode } from './pricing'

// Core add-ons that are ON by default (enabled unless the trainer explicitly
// turned them off with an active:false row).
const DEFAULT_ON_ADDON_IDS = ADDONS.filter(a => a.defaultOn).map(a => a.id)

export interface PricedItem {
  stripePriceId: string | null
  stripePriceIdsByCurrency: unknown
  stripePriceIdTest: string | null
  stripePriceIdsByCurrencyTest: unknown
}

function priceColumns(item: PricedItem, sandbox: boolean): { single: string | null; byCurrency: Record<string, string> } {
  return sandbox
    ? { single: item.stripePriceIdTest, byCurrency: (item.stripePriceIdsByCurrencyTest ?? {}) as Record<string, string> }
    : { single: item.stripePriceId, byCurrency: (item.stripePriceIdsByCurrency ?? {}) as Record<string, string> }
}

/**
 * Resolve the Stripe Price ID for a currency in the given mode. Per-currency
 * overrides win; NZD falls back to the single column. Returns null when
 * nothing is wired up (caller decides whether to fall back to NZD).
 */
export function resolvePriceId(item: PricedItem, currency: CurrencyCode, sandbox = false): string | null {
  const { single, byCurrency } = priceColumns(item, sandbox)
  return (
    byCurrency[currency] ??
    (currency === DEFAULT_CURRENCY ? single : null) ??
    single ??
    null
  )
}

/** Currencies that have a wired-up price for this item in the given mode. */
export function configuredCurrencies(item: PricedItem, sandbox = false): Set<string> {
  const { single, byCurrency } = priceColumns(item, sandbox)
  const set = new Set<string>(Object.keys(byCurrency))
  if (single) set.add(DEFAULT_CURRENCY)
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
  stripePriceIdTest: true,
  stripePriceIdsByCurrencyTest: true,
  sortOrder: true,
} as const

const PLAN_SELECT = {
  id: true,
  name: true,
  stripePriceId: true,
  stripePriceIdsByCurrency: true,
  stripePriceIdTest: true,
  stripePriceIdsByCurrencyTest: true,
} as const

export type BillingItemRow = {
  id: string
  kind: 'SEAT' | 'ADDON'
  name: string
  description: string | null
  priceMonthly: number
  stripePriceId: string | null
  stripePriceIdsByCurrency: unknown
  stripePriceIdTest: string | null
  stripePriceIdsByCurrencyTest: unknown
  sortOrder: number
}

export type CorePlanRow = {
  id: string
  name: string
  stripePriceId: string | null
  stripePriceIdsByCurrency: unknown
  stripePriceIdTest: string | null
  stripePriceIdsByCurrencyTest: unknown
}

export interface BillingConfig {
  core: CorePlanRow | null
  seat: BillingItemRow | null
  addons: BillingItemRow[]
}

/**
 * Load the active billable items: the Core plan (cheapest active paid
 * SubscriptionPlan), the per-seat item, and the toggleable add-ons. Rows carry
 * both live + test price columns; resolvePriceId picks per mode.
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
 * The set of add-on ids currently active for a trainer (drives feature gating).
 * EVERY add-on — free or paid — is OFF until the trainer explicitly enables it
 * (free = one-tap, paid = via Stripe). So a fresh account shows all add-on
 * features locked until turned on in Add-ons / onboarding.
 */
export async function getEnabledAddons(trainerId: string): Promise<Set<string>> {
  const rows = await prisma.trainerAddon.findMany({
    where: { trainerId },
    select: { itemId: true, active: true },
  })
  const explicit = new Map(rows.map((r) => [r.itemId, r.active]))
  const enabled = new Set<string>()
  for (const [id, active] of explicit) if (active) enabled.add(id)
  // Default-on add-ons count as enabled unless explicitly disabled.
  for (const id of DEFAULT_ON_ADDON_IDS) if (explicit.get(id) !== false) enabled.add(id)
  return enabled
}

/**
 * Is a specific add-on active for this trainer? Off until explicitly enabled —
 * EXCEPT default-on add-ons (core features), which are on unless turned off.
 */
export async function hasAddon(trainerId: string, addonId: string): Promise<boolean> {
  const row = await prisma.trainerAddon.findUnique({
    where: { trainerId_itemId: { trainerId, itemId: addonId } },
    select: { active: true },
  })
  if (row) return row.active
  return DEFAULT_ON_ADDON_IDS.includes(addonId as never)
}

export type PriceClassification =
  | { type: 'core'; id: string }
  | { type: 'seat'; id: string }
  | { type: 'addon'; id: string }

/**
 * Build a one-shot index from every wired Stripe Price ID (single column +
 * each per-currency entry) for the given mode to what it represents. The
 * webhook uses this to classify a subscription's line items in a single pass.
 */
export async function loadPriceIndex(sandbox = false): Promise<Map<string, PriceClassification>> {
  const [plans, items] = await Promise.all([
    prisma.subscriptionPlan.findMany({ select: PLAN_SELECT }),
    prisma.billingItem.findMany({ select: ITEM_SELECT }),
  ])

  const index = new Map<string, PriceClassification>()
  const add = (priceId: string | null | undefined, value: PriceClassification) => {
    if (priceId) index.set(priceId, value)
  }
  const eachPriceId = (row: PricedItem, fn: (id: string) => void) => {
    const { single, byCurrency } = priceColumns(row, sandbox)
    if (single) fn(single)
    for (const id of Object.values(byCurrency)) fn(id)
  }

  for (const plan of plans as CorePlanRow[]) {
    eachPriceId(plan, (id) => add(id, { type: 'core', id: plan.id }))
  }
  for (const item of items as BillingItemRow[]) {
    const type = item.kind === 'SEAT' ? 'seat' : 'addon'
    eachPriceId(item, (id) => add(id, { type, id: item.id }))
  }
  return index
}
