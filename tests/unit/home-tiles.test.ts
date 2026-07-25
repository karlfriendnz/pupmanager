import { describe, it, expect } from 'vitest'
import { resolveHomeTiles, tileOrderForRoles, HOME_TILE_COUNT } from '@/lib/home-tiles'

// The phone home's six buttons are picked from the trainer's trade. What
// matters: everyone gets six, nobody gets a button they can't use, and a
// two-trade business sees both trades.

const ALL_ADDONS = new Set(['notes', 'routeplanner', 'puppyschool', 'marketing', 'pos'])

describe('tileOrderForRoles', () => {
  it('leads a dog walker with their route and a trainer with their programmes', () => {
    expect(tileOrderForRoles(['walker']).slice(0, 3)).toEqual(['schedule', 'clients', 'route'])
    expect(tileOrderForRoles(['trainer']).slice(0, 4)).toEqual(['schedule', 'clients', 'offerings', 'todo'])
  })

  it('keeps the notes backlog off a groomer\'s first row', () => {
    const groomer = tileOrderForRoles(['groomer']).slice(0, HOME_TILE_COUNT)
    expect(groomer).not.toContain('todo')
    expect(groomer).toContain('schedule')
  })

  it('gives a walker-and-trainer both trades, not six slots of the first', () => {
    const both = tileOrderForRoles(['walker', 'trainer']).slice(0, HOME_TILE_COUNT)
    expect(both).toContain('route')     // the walker's
    expect(both).toContain('offerings') // the trainer's
  })

  it('falls back to the default order for an unknown or empty trade', () => {
    expect(tileOrderForRoles([])).toEqual(tileOrderForRoles(['nonsense-trade']))
    expect(tileOrderForRoles([]).length).toBeGreaterThanOrEqual(HOME_TILE_COUNT)
  })
})

describe('resolveHomeTiles', () => {
  it('always returns a full grid, whoever the trainer is', () => {
    for (const roles of [[], ['walker'], ['groomer'], ['trainer'], ['puppyschool'], ['walker', 'groomer']]) {
      const tiles = resolveHomeTiles({ roles, enabledAddons: ALL_ADDONS })
      expect(tiles).toHaveLength(HOME_TILE_COUNT)
      expect(new Set(tiles).size).toBe(HOME_TILE_COUNT) // no duplicates
    }
  })

  it('drops a tile whose add-on is off and pulls the next one up', () => {
    const withRoute = resolveHomeTiles({ roles: ['walker'], enabledAddons: ALL_ADDONS })
    const withoutRoute = resolveHomeTiles({ roles: ['walker'], enabledAddons: new Set(['notes']) })
    expect(withRoute).toContain('route')
    expect(withoutRoute).not.toContain('route')
    // Still a full grid — something took the empty slot.
    expect(withoutRoute).toHaveLength(HOME_TILE_COUNT)
  })

  it('offers Instant sale to every trade that can take payments', () => {
    for (const roles of [[], ['walker'], ['groomer'], ['trainer'], ['petsitter']]) {
      expect(resolveHomeTiles({ roles, enabledAddons: ALL_ADDONS })).toContain('sale')
    }
  })

  it('hides Instant sale when the add-on is off or billing is off-limits', () => {
    expect(resolveHomeTiles({ roles: ['groomer'], enabledAddons: new Set(['notes']) })).not.toContain('sale')
    expect(resolveHomeTiles({
      roles: ['groomer'],
      enabledAddons: ALL_ADDONS,
      hasPermission: (p) => p !== 'billing.view',
    })).not.toContain('sale')
  })

  it('never offers Money to a member who cannot see billing', () => {
    const tiles = resolveHomeTiles({
      roles: ['trainer'],
      enabledAddons: ALL_ADDONS,
      hasPermission: (p) => p !== 'billing.view',
    })
    expect(tiles).not.toContain('money')
    expect(tiles).not.toContain('reports')
  })

  it('lets a trainer\'s own choice win — but still gates it', () => {
    const custom = resolveHomeTiles({
      roles: ['walker'],
      enabledAddons: ALL_ADDONS,
      custom: ['messages', 'money', 'clients'],
    })
    expect(custom).toEqual(['messages', 'money', 'clients'])

    // A tile they picked before losing the add-on doesn't render a dead button.
    const stale = resolveHomeTiles({
      roles: ['walker'],
      enabledAddons: new Set([]),
      custom: ['route', 'clients'],
    })
    expect(stale).toEqual(['clients'])
  })
})
