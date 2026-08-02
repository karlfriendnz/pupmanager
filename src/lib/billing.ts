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

/**
 * Add-ons that come WITH another one, and so have no switch of their own.
 *
 * Instant sale (`pos`) is part of selling: if you've turned the shop on, taking a
 * payment on the spot is the same job from the other side of the counter, and a
 * second switch for it was a question nobody needed to be asked.
 *
 * Applied here, in the one place add-ons resolve, so every gate agrees — the nav's
 * Sell action, the session screen, the receivables API and the guest-sale API each
 * ask separately, and a rule written per-caller would have four chances to drift.
 *
 * ADDITIVE ONLY: an explicit row still counts, so a trainer who turned Instant
 * sale on while it had its own switch keeps it whether or not they have the shop.
 * Nobody loses a feature to a tidy-up.
 */
const IMPLIED_BY: Record<string, string> = {
  pos: 'shop',
}

/**
 * On for everyone, whatever the rows say.
 *
 * `clientapp` is how a client sees ANYTHING — their sessions, their homework,
 * their invoices. Switching it off wasn't a configuration, it was turning the
 * product off for the people it's for, and it also took messaging with it because
 * that was the gate messages happened to hang on. Messaging is now its own switch;
 * the app itself isn't a question. (Karl, 2026-07-30.)
 *
 * Forced here rather than by deleting the add-on, because onboarding and several
 * screens still ask about it — they now all get the same answer.
 */
const ALWAYS_ON: ReadonlySet<string> = new Set(['clientapp'])

/** Add what rides along with what's enabled, plus what's on for everyone. */
function withImplied(enabled: Set<string>): Set<string> {
  for (const [rider, owner] of Object.entries(IMPLIED_BY)) {
    if (enabled.has(owner)) enabled.add(rider)
  }
  for (const id of ALWAYS_ON) enabled.add(id)
  return enabled
}

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
    select: { itemId: true, active: true, expiresAt: true },
  })
  const now = Date.now()
  // An admin comp grant lapses at expiresAt: past that, the row still exists
  // (active:true) but no longer grants access — the add-on silently gates off.
  const explicit = new Map(rows.map((r) => [r.itemId, r.active && !isExpired(r.expiresAt, now)]))
  const enabled = new Set<string>()
  for (const [id, active] of explicit) if (active) enabled.add(id)
  // Default-on add-ons count as enabled unless explicitly disabled.
  for (const id of DEFAULT_ON_ADDON_IDS) if (explicit.get(id) !== false) enabled.add(id)
  return withImplied(enabled)
}

/**
 * Batched form of getEnabledAddons for many trainers at once — one query, no
 * N+1. Returns a map of trainerId → enabled add-on id set, applying the exact
 * same rules (explicit active + unexpired, plus default-on unless turned off).
 * Trainers with no rows still get their default-on set. Used by the admin
 * Businesses screen to price every customer's plan on one page load.
 */
export async function getEnabledAddonsBatch(trainerIds: string[]): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>()
  if (trainerIds.length === 0) return result

  const rows = await prisma.trainerAddon.findMany({
    where: { trainerId: { in: trainerIds } },
    select: { trainerId: true, itemId: true, active: true, expiresAt: true },
  })
  const now = Date.now()
  const explicitByTrainer = new Map<string, Map<string, boolean>>()
  for (const r of rows) {
    let m = explicitByTrainer.get(r.trainerId)
    if (!m) {
      m = new Map<string, boolean>()
      explicitByTrainer.set(r.trainerId, m)
    }
    m.set(r.itemId, r.active && !isExpired(r.expiresAt, now))
  }

  for (const id of trainerIds) {
    const explicit = explicitByTrainer.get(id) ?? new Map<string, boolean>()
    const enabled = new Set<string>()
    for (const [itemId, active] of explicit) if (active) enabled.add(itemId)
    for (const defId of DEFAULT_ON_ADDON_IDS) if (explicit.get(defId) !== false) enabled.add(defId)
    result.set(id, withImplied(enabled))
  }
  return result
}

/**
 * PAID add-ons this trainer has switched on that are not yet a billed line item.
 *
 * These come from the trial path in /api/addons: a trainer on a free trial has no
 * Stripe subscription to hang an add-on off, so the row is written active with
 * `stripeSubscriptionItemId` NULL and no Stripe call. That null is the marker —
 * "switched on, never charged for" — and this is the set that must be carried
 * onto the subscription at checkout so the trainer starts paying for what they've
 * been using, instead of it silently becoming free forever.
 *
 * Excluded on purpose:
 *  - FREE add-ons (Timesheets, Xero, …). They also have a null item id and would
 *    otherwise be sent to Stripe, which has no price for them.
 *  - Admin comp grants (grantedByAdmin). Those are deliberately unbilled.
 *  - Lapsed grants (expiresAt in the past). Gating already treats them as off, so
 *    charging for them would bill for something the trainer cannot use.
 */
export async function getUnbilledPaidAddons(trainerId: string): Promise<string[]> {
  const rows = await prisma.trainerAddon.findMany({
    where: {
      trainerId,
      active: true,
      grantedByAdmin: false,
      stripeSubscriptionItemId: null,
    },
    select: { itemId: true, expiresAt: true },
  })
  const now = Date.now()
  const paidIds = new Set<string>(ADDONS.filter(a => !a.free && !a.comingSoon).map(a => a.id))
  return rows.filter(r => paidIds.has(r.itemId) && !isExpired(r.expiresAt, now)).map(r => r.itemId)
}

/** A grant's expiry has passed. Null expiresAt = never lapses. */
function isExpired(expiresAt: Date | null, now = Date.now()): boolean {
  return expiresAt != null && expiresAt.getTime() <= now
}

/**
 * Is a specific add-on active for this trainer? Off until explicitly enabled —
 * EXCEPT default-on add-ons (core features), which are on unless turned off.
 */
export async function hasAddon(trainerId: string, addonId: string): Promise<boolean> {
  // Asked before the row, because a stored `false` must not switch off something
  // that is no longer a choice.
  if (ALWAYS_ON.has(addonId)) return true
  const row = await prisma.trainerAddon.findUnique({
    where: { trainerId_itemId: { trainerId, itemId: addonId } },
    select: { active: true, expiresAt: true },
  })
  if (row) return row.active && !isExpired(row.expiresAt)
  if (DEFAULT_ON_ADDON_IDS.includes(addonId as never)) return true
  // No row of its own — but it may ride along with another add-on (Instant sale
  // comes with the shop). Asked second so an explicit row always wins.
  const owner = IMPLIED_BY[addonId]
  return owner ? hasAddon(trainerId, owner) : false
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
