import { prisma } from '@/lib/prisma'
import { isStripeConfigured } from '@/lib/stripe'
import {
  CORE_PRICE, SEAT_PRICE, ADDONS, CURRENCIES, PLAN_NAME, DEFAULT_CURRENCY,
  type CurrencyCode,
} from '@/lib/pricing'
import { BillingOverview, type BillingRow } from './billing-overview'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Billing' }

// Which currencies have a wired-up Stripe Price ID. NZD is implied by the
// legacy stripePriceId column; the rest come from the per-currency map.
function wiredCurrencies(stripePriceId: string | null, byCurrency: unknown): CurrencyCode[] {
  const map = (byCurrency ?? {}) as Record<string, string>
  const set = new Set<string>(Object.keys(map))
  if (stripePriceId) set.add(DEFAULT_CURRENCY)
  return CURRENCIES.map(c => c.code).filter(c => set.has(c))
}

export default async function AdminBillingPage() {
  // Core base lives in subscription_plans (cheapest active paid row).
  const core = await prisma.subscriptionPlan.findFirst({
    where: { isActive: true, priceMonthly: { gt: 0 } },
    orderBy: { priceMonthly: 'asc' },
    select: { id: true, name: true, description: true, stripePriceId: true, stripePriceIdsByCurrency: true, isActive: true },
  })

  // Seat + add-ons live in billing_items. Guard against the table not
  // existing yet (migration not applied) so the page never hard-crashes.
  let items: { id: string; kind: 'SEAT' | 'ADDON'; name: string; description: string | null; isActive: boolean; stripePriceId: string | null; stripePriceIdsByCurrency: unknown }[] = []
  try {
    items = await prisma.billingItem.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, kind: true, name: true, description: true, isActive: true, stripePriceId: true, stripePriceIdsByCurrency: true },
    })
  } catch {
    items = []
  }

  const coreRow: BillingRow = {
    id: core?.id ?? 'core',
    label: 'Core software',
    name: core?.name ?? PLAN_NAME,
    description: core?.description ?? 'Every core feature · unlimited clients and dogs',
    kind: 'CORE',
    prices: CORE_PRICE,
    wired: core ? wiredCurrencies(core.stripePriceId, core.stripePriceIdsByCurrency) : [],
    isActive: core?.isActive ?? false,
    exists: !!core,
    toggleable: false,
  }

  const seatItem = items.find(i => i.kind === 'SEAT')
  const seatRow: BillingRow = {
    id: 'seat',
    label: 'Extra trainer (per seat)',
    name: seatItem?.name ?? 'Extra trainer',
    description: seatItem?.description ?? 'An additional trainer seat on your account.',
    kind: 'SEAT',
    prices: SEAT_PRICE,
    wired: seatItem ? wiredCurrencies(seatItem.stripePriceId, seatItem.stripePriceIdsByCurrency) : [],
    isActive: seatItem?.isActive ?? false,
    exists: !!seatItem,
    toggleable: true,
  }

  const addonRows: BillingRow[] = ADDONS.map(def => {
    const row = items.find(i => i.id === def.id)
    return {
      id: def.id,
      label: def.name,
      name: row?.name ?? def.name,
      description: def.description,
      badge: def.badge,
      kind: 'ADDON' as const,
      prices: def.price,
      wired: row ? wiredCurrencies(row.stripePriceId, row.stripePriceIdsByCurrency) : [],
      isActive: row?.isActive ?? false,
      exists: !!row,
      toggleable: true,
    }
  })

  const stripeReady = isStripeConfigured()

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-slate-400 text-sm mt-1">
          The live billing model — Core software, per-seat extra trainers, and add-ons.
          Prices are governed in code (<code className="text-slate-300">src/lib/pricing.ts</code>) to stay in
          sync with the marketing site; Stripe wiring is done via <code className="text-slate-300">scripts/setup-billing.ts</code>.
        </p>
      </div>
      <BillingOverview
        core={coreRow}
        seat={seatRow}
        addons={addonRows}
        currencies={CURRENCIES}
        stripeReady={stripeReady}
      />
    </div>
  )
}
