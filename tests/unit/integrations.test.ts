import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { INTEGRATIONS, integrationState, stateLabel } from '@/lib/integrations'
import { ADDONS } from '@/lib/pricing'

const tabsSource = () => readFileSync(
  resolve(__dirname, '../../src/app/(trainer)/settings/settings-tabs.tsx'), 'utf8')

describe('where an integration stands', () => {
  // The state the whole screen exists for: switched on, not connected, doing
  // nothing, and silent about it.
  it('separates "on but not connected" from both other answers', () => {
    expect(integrationState(true, false)).toBe('needs_setup')
    expect(integrationState(true, true)).toBe('connected')
  })

  // Asking "connected?" of something nobody enabled would report a fault where
  // there is only a feature they don't use.
  it('reads as not set up when it isn’t switched on', () => {
    expect(integrationState(false, false)).toBe('off')
    expect(integrationState(false, true)).toBe('off')
  })

  it('says the next action rather than naming a fault', () => {
    expect(stateLabel('needs_setup')).toBe('Finish connecting')
    expect(stateLabel('connected')).toBe('Connected')
    expect(stateLabel('off')).toBe('Not set up')
  })
})

describe('the integrations catalogue', () => {
  it('has no duplicate cards', () => {
    const ids = INTEGRATIONS.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every card leads somewhere real', () => {
    for (const i of INTEGRATIONS) {
      expect(i.manageHref, i.id).toMatch(/^\/settings\?tab=[a-z]+$/)
      expect(i.name.length, i.id).toBeGreaterThan(0)
      expect(i.blurb.length, i.id).toBeGreaterThan(40)
    }
  })

  // A card gated by an add-on id we don't have would sit permanently at "Not set
  // up" with no switch anywhere that could change it.
  it('every gate names a real add-on', () => {
    const known = new Set(ADDONS.map(a => a.id))
    for (const i of INTEGRATIONS) {
      if (i.addonId) expect(known.has(i.addonId as never), `${i.id} → ${i.addonId}`).toBe(true)
    }
  })

  it('the Manage link points at a tab that exists', () => {
    const src = tabsSource()
    for (const i of INTEGRATIONS) {
      const tabId = i.manageHref.split('tab=')[1]
      expect(src, `${i.id} → ${tabId}`).toContain(`id: '${tabId}'`)
    }
  })
})

describe('taking a tab out of the Settings menu never orphans it', () => {
  /** Tab ids marked menuHidden — no longer offered in the rail. */
  function hiddenTabIds(): string[] {
    return [...tabsSource().matchAll(/id: '([a-z]+)'[^\n]*menuHidden: true/g)].map(m => m[1])
  }

  it('finds the hidden tabs it is meant to check', () => {
    // If this fails the parser broke and the assertion below proves nothing.
    expect(hiddenTabIds().length).toBeGreaterThan(0)
  })

  // The whole risk of hiding a menu row: a page nobody can reach. Every hidden
  // tab has to be fronted by an integration card whose Manage link opens it.
  it('every hidden tab is reachable from an integration card', () => {
    const reachable = new Set(INTEGRATIONS.map(i => i.manageHref.split('tab=')[1]))
    const orphans = hiddenTabIds().filter(id => !reachable.has(id))
    expect(orphans).toEqual([])
  })
})
