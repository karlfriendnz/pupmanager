import { prisma } from '@/lib/prisma'
import { loadBillingConfig } from '@/lib/billing'
import {
  ADDONS,
  DEFAULT_CURRENCY,
  isCurrencyCode,
  type CurrencyCode,
} from '@/lib/pricing'
import { AddonsGrid, type AddonCard } from '../add-ons/addons-grid'

// Longer, page-specific blurbs shown in the "Learn more" modal. Keyed by the
// pricing.ts AddonId / BillingItem.id so they line up with the cards.
const DETAILS: Record<string, string> = {
  achievements:
    'Give your clients branded badges to earn and show off — first session, ten-session streak, a graduation. Every time an owner shares a win to their socials your business gets in front of a new audience, for free. You choose which milestones unlock a badge and they appear automatically in the client app.',
  shop:
    'Sell the extras your clients already ask for — slip leads, enrichment toys, treat pouches, gift cards — straight inside the app they use to follow their dog\'s progress. The shop carries your name and colours, checkout is one tap, and you keep the full margin on everything you list.',
  ai:
    'Turn a few rough notes into a structured training plan, or a month of session logs into a friendly progress update an owner will actually read. The AI helper drafts; you stay in control — edit anything before it reaches a client. Built to save you the Sunday-night admin, not to replace your expertise.',
  timesheets:
    'Track the hours your team works across sessions, classes and admin, then turn them into payroll-ready totals. Staff clock their own time, owners approve, and everyone sees where the week went.',
  marketing:
    'Reach the right owners at the right moment — win-back nudges for lapsed clients, review requests after a graduation, and seasonal campaigns, all sent from your brand inside PupManager.',
  todos:
    'A quick scratchpad pinned to your dashboard — jot the day’s to-dos and brain-dump loose notes between sessions so nothing slips. Assign items to team members and tick them off as you go.',
  routeplanner:
    'Plan the most efficient run between your home visits. See drive-time and distance from your base to each client — and from one visit to the next — and order your day to cut the kilometres. Distance-from-base appears on every client profile.',
}

// "Coming soon" cards not modelled in pricing.ts at all. (Add-ons that ARE in
// pricing.ts but flagged comingSoon — e.g. AI — are handled below.)
const COMING_SOON: { id: string; name: string; blurb: string }[] = []

// Add-ons settings tab — the standalone /add-ons page's data loading, rendered
// without the page chrome (PageHeader / full-page wrapper live on the settings
// page now).
export async function AddonsTab({ companyId }: { companyId: string }) {
  const [trainer, { addons: addonItems }, activeRows] = await Promise.all([
    prisma.trainerProfile.findUnique({
      where: { id: companyId },
      select: { payoutCurrency: true },
    }),
    loadBillingConfig(),
    prisma.trainerAddon.findMany({
      where: { trainerId: companyId },
      select: { itemId: true, active: true },
    }),
  ])

  // Display currency for the quoted prices. The actual subscription currency is
  // set at Stripe checkout; for a sensible on-load quote we use the trainer's
  // payout currency (ISO 4217 lower-case) when it's one we price in, else NZD.
  const payout = (trainer?.payoutCurrency ?? '').toUpperCase()
  const currency: CurrencyCode = isCurrencyCode(payout) ? payout : DEFAULT_CURRENCY

  // Which BillingItem ids are actually sellable add-ons right now (DB-active).
  // BillingItem.id == pricing AddonId, so we match the two by id.
  const sellableIds = new Set(addonItems.map((a) => a.id))
  const activeIds = new Set(activeRows.filter((r) => r.active).map((r) => r.itemId))

  // Real add-ons from pricing.ts (source of truth for name/blurb/price), each
  // carrying its current on/off state and longer modal copy. Free add-ons (e.g.
  // Timesheets) are always toggleable, shown as "Free", and ON by default.
  const cards: AddonCard[] = ADDONS.filter((a) => !a.comingSoon).map((a) => ({
    id: a.id,
    name: a.name,
    blurb: a.description,
    badge: a.free ? 'Free' : (a.badge ?? null),
    price: a.free ? null : a.price[currency],
    active: activeIds.has(a.id), // every add-on is off until explicitly enabled
    // Free add-ons toggle without Stripe; paid ones need a sellable BillingItem.
    available: a.free ? true : sellableIds.has(a.id),
    details: DETAILS[a.id] ?? a.description,
    comingSoon: false,
  }))

  // Add-ons in pricing.ts but flagged comingSoon (e.g. AI) — preview cards.
  const soonAddons: AddonCard[] = ADDONS.filter((a) => a.comingSoon).map((a) => ({
    id: a.id,
    name: a.name,
    blurb: a.description,
    badge: 'Coming soon',
    price: null,
    active: false,
    available: false,
    details: DETAILS[a.id] ?? a.description,
    comingSoon: true,
  }))

  // Plus the preview-only "coming soon" cards not modelled in pricing.ts.
  const soon: AddonCard[] = COMING_SOON.map((c) => ({
    id: c.id,
    name: c.name,
    blurb: c.blurb,
    badge: 'Coming soon',
    price: null,
    active: false,
    available: false,
    details: DETAILS[c.id] ?? c.blurb,
    comingSoon: true,
  }))

  return (
    <div className="max-w-5xl">
      <AddonsGrid cards={[...cards, ...soonAddons, ...soon]} currency={currency} />
    </div>
  )
}
