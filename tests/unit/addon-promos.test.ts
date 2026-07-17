import { describe, it, expect } from 'vitest'
import { ADDONS } from '@/lib/pricing'
import { ADDON_PROMO_IMAGES } from '@/lib/addon-promo-images'
import { ADDON_PROMO_IDS } from '@/components/shared/addon-promos'
import { NUDGE_COPY } from '@/lib/addon-nudges'

// Registry integrity for the Add-ons grid.
//
// The bug this exists to prevent (hit for real on 2026-07-17): the Add-ons card
// click does
//
//   if (manageHref && (LINK_ONLY.has(id) || active[id])) router.push(manageHref)
//   setLearnMore(card)                       // ← renders <AddonPromoModal>
//
// and AddonPromoModal does `PROMOS[addonId]; if (!cfg) return null`. So an
// add-on with no PROMOS entry, no LINK_ONLY entry, and not currently active
// renders NOTHING — the card is simply dead, and since the promo carries the
// on/off toggle, the add-on can't be enabled from the grid at all. It fails
// silently: no error, no crash, nothing in the console.
//
// `pos`, `xero` and `instagram` were all in that state. These are pure data
// checks — no DB, no rendering.

// Add-ons that never open the promo, so they legitimately have no PROMOS entry.
// Keep this list SHORT and justified — each entry is a card that must route
// somewhere instead (LINK_ONLY in addons-grid.tsx).
const LINK_ONLY_IDS = ['payments'] // enabled by connecting Stripe, not a toggle

describe('add-on promo registry', () => {
  it('every add-on either opens a promo or is deliberately link-only', () => {
    // The invariant: no add-on may fall through to a promo that isn't there.
    const missing = ADDONS
      .map((a) => a.id)
      .filter((id) => !ADDON_PROMO_IDS.includes(id) && !LINK_ONLY_IDS.includes(id))

    expect(
      missing,
      `these add-ons would render a dead card (no PROMOS entry, not link-only): ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('every add-on has a hero image for its card and nudge', () => {
    const missing = ADDONS.map((a) => a.id).filter((id) => !ADDON_PROMO_IMAGES[id])

    expect(missing, `add-ons with no promo image: ${missing.join(', ')}`).toEqual([])
  })

  it('every promo id is a real add-on — no orphaned entries', () => {
    const known = new Set<string>(ADDONS.map((a) => a.id))
    for (const id of ADDON_PROMO_IDS) {
      expect(known.has(id), `PROMOS has "${id}", which is not in ADDONS`).toBe(true)
    }
  })

  it('link-only add-ons are real, and stay the exception', () => {
    const known = new Set<string>(ADDONS.map((a) => a.id))
    for (const id of LINK_ONLY_IDS) expect(known.has(id), `unknown link-only id: ${id}`).toBe(true)
    // A guard against quietly "fixing" a dead card by adding it here instead of
    // writing its promo — link-only means the card routes to a config page.
    expect(LINK_ONLY_IDS.length).toBeLessThanOrEqual(2)
  })

  it('the instant sale add-on is reachable', () => {
    // Regression pin for the reported bug: clicking "Learn more" on Instant
    // sale did nothing at all.
    expect(ADDON_PROMO_IDS).toContain('pos')
    expect(ADDON_PROMO_IMAGES.pos).toBeTruthy()
  })

  it('every nudged add-on can actually be enabled where the nudge sends you', () => {
    // The nudges' CTA lands on /add-ons for most add-ons — so a nudged add-on
    // with a dead card sends the trainer to a page where nothing works. This is
    // how the Instagram nudge shipped pointing at a dead card.
    for (const id of Object.keys(NUDGE_COPY)) {
      const reachable = ADDON_PROMO_IDS.includes(id) || LINK_ONLY_IDS.includes(id)
      expect(reachable, `"${id}" is nudged but its Add-ons card is dead`).toBe(true)
    }
  })
})
