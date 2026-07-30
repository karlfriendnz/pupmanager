import { describe, it, expect } from 'vitest'
import {
  configurableFeatures, groupedFeatures, purchasableAddons, featureIsOn,
  notASwitch, FEATURE_GROUPS,
} from '@/lib/configurable-features'
import { ADDONS } from '@/lib/pricing'

// Configure is the switchboard, Add-ons is the shop. The split has to be total and
// non-overlapping: a feature listed on neither page can't be turned on, and one
// listed on both is two sources of truth for the same switch.

describe('the Configure / Add-ons split', () => {
  it('puts free features on Configure', () => {
    const ids = configurableFeatures().map(f => f.id)
    expect(ids).toContain('timesheets')
    expect(ids).toContain('googlecalendar')
    expect(ids).toContain('todos')
  })

  it('keeps paid add-ons off Configure', () => {
    const ids = configurableFeatures().map(f => f.id)
    for (const paid of ['marketing', 'routeplanner', 'shop', 'achievements', 'leadmagnets']) {
      expect(ids).not.toContain(paid)
    }
  })

  it('leaves coming-soon previews to the shop — they are advertising', () => {
    expect(configurableFeatures().map(f => f.id)).not.toContain('ai')
    expect(purchasableAddons().map(a => a.id)).toContain('ai')
  })

  it('never lists the same thing on both pages', () => {
    const a = new Set(configurableFeatures().map(f => f.id))
    const b = new Set(purchasableAddons().map(x => x.id))
    expect([...a].filter(id => b.has(id))).toEqual([])
  })

  // A free add-on nobody thought to categorise must still be reachable.
  it('accounts for every free, shippable add-on that IS a switch', () => {
    const expected = ADDONS
      .filter(a => a.free && !a.comingSoon && !a.hidden)
      .map(a => a.id)
      .filter(id => !notASwitch().includes(id))
      .sort()
    expect(configurableFeatures().map(f => f.id).sort()).toEqual(expected)
  })

  // Its on/off is Stripe Connect's answer, not a row — a switch would show the
  // wrong state and flipping it would connect nothing.
  it('keeps Payments off the switchboard, since it is not a switch', () => {
    expect(configurableFeatures().map(f => f.id)).not.toContain('payments')
    expect(notASwitch()).toContain('payments')
  })

  it('files an uncategorised feature under tools rather than dropping it', () => {
    for (const f of configurableFeatures()) {
      expect(FEATURE_GROUPS).toContain(f.group)
    }
  })
})

describe('hidden features', () => {
  // Built but not advertised (Doggy Daycare while it's unfinished). Invisible —
  // unless you already turned it on, or you could never turn it back off.
  it('are hidden by default', () => {
    expect(configurableFeatures().map(f => f.id)).not.toContain('puppyschool')
  })

  it('appear for a trainer who already has one on', () => {
    const ids = configurableFeatures(new Set(['puppyschool'])).map(f => f.id)
    expect(ids).toContain('puppyschool')
  })
})

describe('groupedFeatures', () => {
  it('drops empty groups instead of rendering an empty heading', () => {
    for (const g of groupedFeatures()) expect(g.features.length).toBeGreaterThan(0)
  })

  it('loses nothing in the grouping', () => {
    const flat = groupedFeatures().flatMap(g => g.features.map(f => f.id)).sort()
    expect(flat).toEqual(configurableFeatures().map(f => f.id).sort())
  })

  it('leads with what you offer', () => {
    expect(groupedFeatures()[0].group).toBe('offerings')
  })
})

describe('featureIsOn', () => {
  it('is on when a row says so', () => {
    expect(featureIsOn('timesheets', new Map([['timesheets', true]]))).toBe(true)
  })

  it('is off when a row says so', () => {
    expect(featureIsOn('timesheets', new Map([['timesheets', false]]))).toBe(false)
  })

  // The case a set-lookup gets wrong: a trainer who has never opened Settings
  // still has the client app and session notes.
  it('is on for a default-on feature with no row at all', () => {
    expect(featureIsOn('clientapp', new Map())).toBe(true)
    expect(featureIsOn('notes', new Map())).toBe(true)
  })

  it('respects an explicit off on a default-on feature', () => {
    expect(featureIsOn('clientapp', new Map([['clientapp', false]]))).toBe(false)
  })

  it('is off for an opt-in feature with no row', () => {
    expect(featureIsOn('timesheets', new Map())).toBe(false)
  })
})

describe('Instant sale comes with the shop', () => {
  // Selling to someone on the spot is the same job as selling to them online, so
  // it stopped being a separate decision. No switch of its own.
  it('is not a switch on Configure', () => {
    expect(configurableFeatures().map(f => f.id)).not.toContain('pos')
    expect(notASwitch()).toContain('pos')
  })

  // It's free, so it must not appear on the shop page either — the shop card says
  // it's included instead.
  it('is not sold on the Add-ons page', () => {
    expect(purchasableAddons().map(a => a.id)).not.toContain('pos')
  })

  it('is named on the shop’s own description, so nobody hunts for a switch', () => {
    const shop = purchasableAddons().find(a => a.id === 'shop')
    expect(shop?.description).toMatch(/instant sale/i)
  })
})

describe('1:1 sessions is configurable too', () => {
  // It was the one offering with no switch at all, so a classes-or-daycare-only
  // business had a menu item they could never use.
  it('appears on Configure, under what you offer', () => {
    const f = configurableFeatures().find(x => x.id === 'onetoone')
    expect(f).toBeDefined()
    expect(f!.group).toBe('offerings')
  })

  // On unless turned off — every existing trainer keeps it without touching anything.
  it('is on by default', () => {
    expect(featureIsOn('onetoone', new Map())).toBe(true)
  })

  it('can be turned off', () => {
    expect(featureIsOn('onetoone', new Map([['onetoone', false]]))).toBe(false)
  })

  it('is not something you buy', () => {
    expect(purchasableAddons().map(a => a.id)).not.toContain('onetoone')
  })
})
