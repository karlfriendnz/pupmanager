import { describe, it, expect } from 'vitest'
import {
  NUDGE_COPY,
  nudgeCtaHref,
  PROMOTABLE_ADDON_IDS,
  eligibleNudgeAddonIds,
  pickNudgeAddonId,
} from '@/lib/addon-nudges'
import { addonById, ADDONS } from '@/lib/pricing'

// The add-on nudges promote a related add-on on relevant trainer pages and
// rotate on the dashboard. These tests cover the registry integrity and the
// eligibility/selection logic — no DB, pure functions.

describe('addon nudge registry', () => {
  it('every promotable id is a real, non-coming-soon add-on', () => {
    expect(PROMOTABLE_ADDON_IDS.length).toBeGreaterThan(0)
    for (const id of PROMOTABLE_ADDON_IDS) {
      const def = addonById(id)
      expect(def, `unknown add-on id: ${id}`).toBeTruthy()
      expect(def!.comingSoon, `${id} is coming-soon and must not be promoted`).toBeFalsy()
    }
  })

  it('never includes the coming-soon AI add-on', () => {
    expect(PROMOTABLE_ADDON_IDS).not.toContain('ai')
  })

  it('promotes every add-on a trainer has to opt into, and only those', () => {
    // An add-on without `defaultOn` is off until the trainer explicitly enables
    // it (see hasAddon), so with no nudge it's invisible to anyone who never
    // opens Settings → Add-ons — free ones included. `defaultOn` cores are
    // already on and coming-soon ones can't be enabled, so both are excluded.
    // This is the invariant: adding an opt-in add-on without copy fails here.
    // `hidden` add-ons are built but not surfaced anywhere yet — no card, no
    // nudge — so they need no promo copy until they're revealed.
    const needsNudge = ADDONS.filter((a) => !a.defaultOn && !a.comingSoon && !a.hidden).map((a) => a.id)
    expect([...PROMOTABLE_ADDON_IDS].sort()).toEqual([...needsNudge].sort())
  })

  it('promotes the free-but-opt-in add-ons (todos, instagram)', () => {
    expect(PROMOTABLE_ADDON_IDS).toContain('todos')
    expect(PROMOTABLE_ADDON_IDS).toContain('instagram')
    // Toggle-based, so the CTA lands on the Add-ons page rather than a tab.
    expect(nudgeCtaHref('todos')).toBe('/add-ons')
    expect(nudgeCtaHref('instagram')).toBe('/add-ons')
  })

  it('has complete copy (title, body, cta) for every promotable id', () => {
    for (const id of PROMOTABLE_ADDON_IDS) {
      const copy = NUDGE_COPY[id]
      expect(copy?.title?.length, `${id} title`).toBeGreaterThan(0)
      expect(copy?.body?.length, `${id} body`).toBeGreaterThan(0)
      expect(copy?.ctaLabel?.length, `${id} ctaLabel`).toBeGreaterThan(0)
    }
  })

  it('routes connect-based add-ons to their Settings tab, others to /add-ons', () => {
    expect(nudgeCtaHref('payments')).toBe('/settings?tab=payments')
    // Google Calendar no longer has a settings tab — it's managed in the add-on popup.
    expect(nudgeCtaHref('googlecalendar')).toBe('/add-ons')
    expect(nudgeCtaHref('xero')).toBe('/settings?tab=xero')
    expect(nudgeCtaHref('marketing')).toBe('/add-ons')
    expect(nudgeCtaHref('leadmagnets')).toBe('/add-ons')
  })
})

describe('eligibleNudgeAddonIds', () => {
  it('returns the full pool when nothing is active', () => {
    expect(eligibleNudgeAddonIds([])).toEqual(PROMOTABLE_ADDON_IDS)
  })

  it('filters out add-ons the trainer already has active', () => {
    const eligible = eligibleNudgeAddonIds(['marketing', 'payments'])
    expect(eligible).not.toContain('marketing')
    expect(eligible).not.toContain('payments')
    expect(eligible).toContain('leadmagnets')
  })

  it('returns an empty list when every promotable add-on is active', () => {
    expect(eligibleNudgeAddonIds(PROMOTABLE_ADDON_IDS)).toEqual([])
  })

  it('ignores unrelated active add-on ids', () => {
    // A default-on core add-on the trainer has (e.g. classes) shouldn't shrink
    // the pool — it's not promotable in the first place.
    expect(eligibleNudgeAddonIds(['classes', 'notes'])).toEqual(PROMOTABLE_ADDON_IDS)
  })
})

describe('pickNudgeAddonId', () => {
  it('returns null when the trainer already has everything', () => {
    expect(pickNudgeAddonId(PROMOTABLE_ADDON_IDS)).toBeNull()
  })

  it('picks deterministically from the eligible pool given an rng', () => {
    // rng = 0 → first eligible; rng ~1 → last eligible.
    const first = pickNudgeAddonId([], () => 0)
    const last = pickNudgeAddonId([], () => 0.999999)
    expect(first).toBe(PROMOTABLE_ADDON_IDS[0])
    expect(last).toBe(PROMOTABLE_ADDON_IDS[PROMOTABLE_ADDON_IDS.length - 1])
  })

  it('only ever picks an eligible (not-yet-active) add-on', () => {
    const active = ['marketing', 'leadmagnets']
    const eligible = eligibleNudgeAddonIds(active)
    // Sweep the rng across [0,1) and confirm every pick is in the eligible set.
    for (let i = 0; i < 20; i++) {
      const pick = pickNudgeAddonId(active, () => i / 20)
      expect(pick).not.toBeNull()
      expect(eligible).toContain(pick!)
    }
  })

  it('never picks the same add-on the page already excludes (rng clamped in range)', () => {
    // rng returning exactly 1 must not overflow the array.
    expect(pickNudgeAddonId([], () => 1)).toBe(PROMOTABLE_ADDON_IDS[PROMOTABLE_ADDON_IDS.length - 1])
  })
})
