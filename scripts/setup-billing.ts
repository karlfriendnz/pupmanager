/**
 * Wire the full billing model to Stripe Price IDs.
 *
 * Five products, six currencies each = 30 prices:
 *   - Core software  → subscription_plans row "core"
 *   - Extra trainer  → billing_items row "seat"   (kind SEAT)
 *   - Achievements   → billing_items row "achievements" (kind ADDON)
 *   - Client shop    → billing_items row "shop"   (kind ADDON)
 *   - AI helper      → billing_items row "ai"     (kind ADDON)
 *
 * Create the products + one recurring monthly Price per currency in the
 * Stripe Dashboard, paste the price_… IDs into PRICE_IDS below, then:
 *
 *   npx tsx scripts/setup-billing.ts
 *
 * Idempotent — re-run to swap TEST → LIVE by replacing the IDs (and the
 * STRIPE_SECRET_KEY / webhook secret). NZD is the canonical default and
 * goes in the legacy stripePriceId column; the rest go in
 * stripePriceIdsByCurrency. Leave a cell as the placeholder to skip it
 * (the UI falls back to NZD for that currency).
 *
 * NB: there is no separate dev DB — this writes to PROD Supabase. Harmless
 * while STRIPE_SECRET_KEY is unset in prod (checkout stays off), but treat
 * it as a production write regardless.
 */
import { PrismaClient } from '../src/generated/prisma'
import {
  PLAN_NAME, CORE_PRICE, SEAT_PRICE, ADDONS,
  CURRENCIES, type CurrencyCode,
} from '../src/lib/pricing'

const prisma = new PrismaClient()

type PriceMap = Record<CurrencyCode, string>
const TODO = 'price_REPLACE_ME'
const blank = (): PriceMap => ({ NZD: TODO, AUD: TODO, GBP: TODO, CAD: TODO, USD: TODO, ZAR: TODO })

// ── PASTE STRIPE PRICE IDS HERE ───────────────────────────────────────────
// Each must be a recurring/month Price in the matching currency. Amounts
// for reference live in src/lib/pricing.ts.
const PRICE_IDS: Record<'core' | 'seat' | 'achievements' | 'shop' | 'ai', PriceMap> = {
  core:         blank(), // 45 AUD / 49 NZD / 25 GBP / 39 CAD / 35 USD / 649 ZAR
  seat:         blank(), // 36 AUD / 39 NZD / 19 GBP / 31 CAD / 28 USD / 519 ZAR
  achievements: blank(), // 18 AUD / 19 NZD /  9 GBP / 15 CAD / 13 USD / 249 ZAR
  shop:         blank(), // 27 AUD / 29 NZD / 15 GBP / 23 CAD / 21 USD / 389 ZAR
  ai:           blank(), // 27 AUD / 29 NZD / 15 GBP / 23 CAD / 21 USD / 389 ZAR
}
// ──────────────────────────────────────────────────────────────────────────

const isReal = (id: string) => id.startsWith('price_') && !id.includes('REPLACE_ME')

/** Split a PriceMap into the NZD canonical column + the per-currency overrides. */
function split(map: PriceMap, label: string): { nzd: string; byCurrency: Record<string, string> } {
  const nzd = map.NZD
  if (!isReal(nzd)) {
    throw new Error(`${label}: NZD price ID is required (the canonical default) — paste it into PRICE_IDS.`)
  }
  const byCurrency: Record<string, string> = {}
  for (const { code } of CURRENCIES) {
    if (code === 'NZD') continue
    if (isReal(map[code])) byCurrency[code] = map[code]
  }
  return { nzd, byCurrency }
}

async function main() {
  // ── Core (subscription_plans) ──
  const coreSplit = split(PRICE_IDS.core, 'core')
  await prisma.subscriptionPlan.upsert({
    where: { id: 'core' },
    create: {
      id: 'core',
      name: PLAN_NAME,
      priceMonthly: CORE_PRICE.NZD,
      maxClients: null,
      description: 'Every core feature · unlimited clients and dogs',
      stripePriceId: coreSplit.nzd,
      stripePriceIdsByCurrency: coreSplit.byCurrency,
    },
    update: {
      isActive: true,
      stripePriceId: coreSplit.nzd,
      stripePriceIdsByCurrency: coreSplit.byCurrency,
    },
  })
  // Retire any other paid tiers so /billing/setup resolves to Core.
  const { count } = await prisma.subscriptionPlan.updateMany({
    where: { id: { not: 'core' } },
    data: { isActive: false },
  })

  // ── Seat + add-ons (billing_items) ──
  const items: { id: string; kind: 'SEAT' | 'ADDON'; name: string; description: string; priceMonthly: number; sortOrder: number; map: PriceMap }[] = [
    { id: 'seat', kind: 'SEAT', name: 'Extra trainer', description: 'An additional trainer seat on your account.', priceMonthly: SEAT_PRICE.NZD, sortOrder: 0, map: PRICE_IDS.seat },
    ...ADDONS.map((a, i) => ({
      id: a.id, kind: 'ADDON' as const, name: a.name, description: a.description,
      priceMonthly: a.price.NZD, sortOrder: i + 1, map: PRICE_IDS[a.id],
    })),
  ]

  for (const item of items) {
    const { nzd, byCurrency } = split(item.map, item.id)
    await prisma.billingItem.upsert({
      where: { id: item.id },
      create: {
        id: item.id, kind: item.kind, name: item.name, description: item.description,
        priceMonthly: item.priceMonthly, sortOrder: item.sortOrder,
        stripePriceId: nzd, stripePriceIdsByCurrency: byCurrency,
      },
      update: { isActive: true, stripePriceId: nzd, stripePriceIdsByCurrency: byCurrency },
    })
    console.log(`✓ ${item.id.padEnd(13)} NZD ${nzd}  + [${Object.keys(byCurrency).join(', ') || 'NZD only'}]`)
  }

  console.log(`✓ core          NZD ${coreSplit.nzd}  + [${Object.keys(coreSplit.byCurrency).join(', ') || 'NZD only'}]`)
  console.log(`  deactivated ${count} legacy plan(s)`)
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
