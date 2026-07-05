// Pure (React-free) data + selection logic for the contextual add-on nudges.
// Kept out of the .tsx registry so it can be unit-tested without pulling in the
// client-component / lucide import chain. The .tsx registry layers icons + hero
// art on top of this.

import { addonById } from './pricing'

// Short blurb + CTA per promotable add-on. Title is bespoke (not just the
// add-on name) so it reads as a page-level nudge. Voice mirrors the Add-ons
// cards: warm, benefit-first.
export const NUDGE_COPY: Record<string, { title: string; body: string; ctaLabel: string }> = {
  marketing: {
    title: 'Email your whole client list',
    body: 'Send campaigns and seasonal nudges from your own brand — with open and click tracking.',
    ctaLabel: 'Set up Marketing',
  },
  leadmagnets: {
    title: 'Turn enquiries into subscribers',
    body: 'Offer a free download behind a branded sign-up form and grow your mailing list on autopilot.',
    ctaLabel: 'Set up Lead magnets',
  },
  payments: {
    title: 'Get paid in the app',
    body: 'Take card payments for sessions and invoices — connect Stripe and settle straight to your bank.',
    ctaLabel: 'Set up payments',
  },
  routeplanner: {
    title: 'Plan the shortest drive',
    body: 'Order your visits into the most efficient route and record the distance you cover.',
    ctaLabel: 'Set up Route planner',
  },
  achievements: {
    title: 'Celebrate every win',
    body: 'Branded badges your clients earn and share — free marketing every time an owner posts.',
    ctaLabel: 'Set up Achievements',
  },
  shop: {
    title: 'Sell to your clients',
    body: 'A branded in-app shop for the leads, toys and extras they already ask you for.',
    ctaLabel: 'Set up Client shop',
  },
  timesheets: {
    title: 'Track your team’s hours',
    body: 'Turn worked time across sessions and admin into payroll-ready totals.',
    ctaLabel: 'Set up Timesheets',
  },
  googlecalendar: {
    title: 'Sync your Google Calendar',
    body: 'See your sessions and classes in Google Calendar and never double-book again.',
    ctaLabel: 'Connect Google Calendar',
  },
  xero: {
    title: 'Reconcile in Xero',
    body: 'Sync invoices, payments and clients straight into your Xero organisation — no double entry.',
    ctaLabel: 'Connect Xero',
  },
}

// Where an add-on's setup/manage flow lives (mirrors MANAGE_HREF in the Add-ons
// grid). Connect-based add-ons go straight to their Settings tab; the rest land
// on the Add-ons page where they can toggle on.
const CTA_HREF: Record<string, string> = {
  xero: '/settings?tab=xero',
  googlecalendar: '/add-ons',
  payments: '/settings?tab=payments',
}

export function nudgeCtaHref(addonId: string): string {
  return CTA_HREF[addonId] ?? '/add-ons'
}

/** Every add-on we have nudge copy for — the dashboard rotation pool. */
export const PROMOTABLE_ADDON_IDS = Object.keys(NUDGE_COPY)

/**
 * The promotable add-ons a trainer is eligible to be nudged about: those we
 * have copy for, that aren't coming-soon, and that they haven't already turned
 * on / connected. Pass the set of add-on ids that are already active for this
 * trainer (toggle-enabled OR connected, for connect-based add-ons) — anything
 * in that set is filtered out. Pure + deterministic so it's unit-testable.
 */
export function eligibleNudgeAddonIds(activeAddonIds: Iterable<string>): string[] {
  const active = new Set(activeAddonIds)
  return PROMOTABLE_ADDON_IDS.filter((id) => {
    if (active.has(id)) return false
    const def = addonById(id)
    if (!def) return false
    if (def.comingSoon) return false
    return true
  })
}

/**
 * Pick one eligible add-on at random (server-side, once per load). Returns null
 * when the trainer already has everything. `rng` is injectable for tests.
 */
export function pickNudgeAddonId(
  activeAddonIds: Iterable<string>,
  rng: () => number = Math.random,
): string | null {
  const eligible = eligibleNudgeAddonIds(activeAddonIds)
  if (eligible.length === 0) return null
  const idx = Math.min(eligible.length - 1, Math.floor(rng() * eligible.length))
  return eligible[idx]
}
