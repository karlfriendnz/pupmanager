/**
 * Create the full billing model in Stripe via the API, then wire the
 * resulting Price IDs into the DB. One command does what would otherwise
 * be 30 manual dashboard prices.
 *
 *   5 products × 6 currencies = 30 recurring monthly prices:
 *     core · seat · achievements · shop · ai
 *
 * Reads STRIPE_SECRET_KEY + DATABASE_URL from .env.local. Run:
 *
 *   npx tsx scripts/create-stripe-products.ts
 *
 * Idempotent: products are matched by metadata.pmKey, prices by
 * lookup_key (pm_<key>_<CUR>), so re-running reuses what exists instead of
 * duplicating. Amounts come from src/lib/pricing.ts (the source of truth,
 * mirroring the marketing site). Uses whichever mode the key is in — pass
 * a sk_test_… key for test mode, sk_live_… to go live.
 *
 * NB: writes to PROD Supabase (no dev DB). Harmless while STRIPE_SECRET_KEY
 * is unset in the deployed env (checkout stays off), but treat as a
 * production write. Requires the billing_addons migration to be applied.
 */
import fs from 'node:fs'
import Stripe from 'stripe'
import { scriptPrisma } from "../src/lib/prisma-script"
import {
  CORE_PRICE, SEAT_PRICE, ADDONS, CURRENCIES, PLAN_NAME,
  type CurrencyCode,
} from '../src/lib/pricing'

// Load .env.local into process.env (Prisma/Next keep secrets there; the
// bare `.env` is empty in this repo). Don't override anything already set.
function loadEnvLocal() {
  try {
    for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env.local — rely on the ambient environment */ }
}
loadEnvLocal()

const SECRET = process.env.STRIPE_SECRET_KEY ?? ''
if (!SECRET) {
  console.error('STRIPE_SECRET_KEY is not set — add it to .env.local (sk_test_… for test mode).')
  process.exit(1)
}
const MODE = SECRET.startsWith('sk_live_') ? 'LIVE' : 'TEST'

const prisma = scriptPrisma()
const stripe = new Stripe(SECRET, { apiVersion: '2026-04-22.dahlia' })

interface ProductDef {
  key: 'core' | 'seat' | 'achievements' | 'shop' | 'ai' | 'marketing' | 'routeplanner'
  name: string
  description: string
  prices: Record<CurrencyCode, number>
}

// Free add-ons (e.g. Timesheets) never go through Stripe — they're excluded
// from product/price creation and just get a BillingItem row below (FK anchor).
const PRODUCTS: ProductDef[] = [
  { key: 'core', name: PLAN_NAME, description: 'Every core feature · unlimited clients and dogs', prices: CORE_PRICE },
  { key: 'seat', name: 'Extra trainer', description: 'An additional trainer seat on your account.', prices: SEAT_PRICE },
  ...ADDONS.filter(a => !a.free).map(a => ({
    key: a.id as ProductDef['key'],
    name: a.name,
    description: a.description,
    prices: a.price,
  })),
]

async function ensureProduct(def: ProductDef): Promise<string> {
  const found = await stripe.products.search({ query: `metadata['pmKey']:'${def.key}'`, limit: 1 })
  if (found.data[0]) return found.data[0].id
  const p = await stripe.products.create({
    name: `PupManager — ${def.name}`,
    description: def.description,
    metadata: { pmKey: def.key },
  })
  return p.id
}

async function ensurePrice(productId: string, key: string, currency: CurrencyCode, amount: number): Promise<string> {
  const lookup_key = `pm_${key}_${currency}`
  const existing = await stripe.prices.list({ lookup_keys: [lookup_key], limit: 1 })
  if (existing.data[0]) return existing.data[0].id
  const price = await stripe.prices.create({
    product: productId,
    currency: currency.toLowerCase(),
    unit_amount: Math.round(amount * 100), // all six currencies are 2-decimal
    recurring: { interval: 'month' },
    lookup_key,
    metadata: { pmKey: key, pmCurrency: currency },
  })
  return price.id
}

async function main() {
  console.log(`Creating Stripe products/prices in ${MODE} mode…\n`)

  // key → { NZD: priceId(canonical), byCurrency: { AUD: id, … } }
  const wired: Record<string, { nzd: string; byCurrency: Record<string, string> }> = {}

  for (const def of PRODUCTS) {
    const productId = await ensureProduct(def)
    const byCurrency: Record<string, string> = {}
    let nzd = ''
    for (const { code } of CURRENCIES) {
      const priceId = await ensurePrice(productId, def.key, code, def.prices[code])
      if (code === 'NZD') nzd = priceId
      else byCurrency[code] = priceId
    }
    wired[def.key] = { nzd, byCurrency }
    console.log(`✓ ${def.key.padEnd(13)} ${productId}  (${CURRENCIES.length} prices)`)
  }

  console.log(`\nWiring the DB (${MODE} columns)…`)

  // Dual-mode: a TEST key writes the *Test price columns; a LIVE key writes
  // the live columns. Run once per key to fill both sets on the same rows.
  const TEST = MODE === 'TEST'
  const priceCols = (nzd: string, byCurrency: Record<string, string>) =>
    TEST
      ? { stripePriceIdTest: nzd, stripePriceIdsByCurrencyTest: byCurrency }
      : { stripePriceId: nzd, stripePriceIdsByCurrency: byCurrency }

  // Core → subscription_plans
  await prisma.subscriptionPlan.upsert({
    where: { id: 'core' },
    create: {
      id: 'core', name: PLAN_NAME, priceMonthly: CORE_PRICE.NZD, maxClients: null,
      description: 'Every core feature · unlimited clients and dogs',
      ...priceCols(wired.core.nzd, wired.core.byCurrency),
    },
    update: { isActive: true, ...priceCols(wired.core.nzd, wired.core.byCurrency) },
  })
  const { count } = await prisma.subscriptionPlan.updateMany({
    where: { id: { not: 'core' } }, data: { isActive: false },
  })

  // Seat + add-ons → billing_items
  const items: { id: string; kind: 'SEAT' | 'ADDON'; name: string; description: string; priceMonthly: number; sortOrder: number }[] = [
    { id: 'seat', kind: 'SEAT', name: 'Extra trainer', description: 'An additional trainer seat on your account.', priceMonthly: SEAT_PRICE.NZD, sortOrder: 0 },
    ...ADDONS.map((a, i) => ({ id: a.id, kind: 'ADDON' as const, name: a.name, description: a.description, priceMonthly: a.price.NZD, sortOrder: i + 1 })),
  ]
  for (const item of items) {
    const w = wired[item.id] // undefined for free add-ons (no Stripe prices)
    const cols = w ? priceCols(w.nzd, w.byCurrency) : {}
    await prisma.billingItem.upsert({
      where: { id: item.id },
      create: { ...item, ...cols },
      update: { isActive: true, ...cols },
    })
  }

  console.log(`✓ wired core + ${items.length} billing items (${MODE} columns) · deactivated ${count} legacy plan(s)`)
  console.log(`\nDone (${MODE}). 30 prices created. ${TEST ? 'Set STRIPE_SECRET_KEY_TEST + STRIPE_WEBHOOK_SECRET_TEST' : 'Set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET'} in the relevant env, and run the other mode too.`)
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
