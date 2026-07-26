import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TRIGGERS, TRIGGER_META, triggerLine, COLORS, COLOR_BY_KEY, DEFAULT_COLOR } from '@/app/(trainer)/achievements/triggers'

// The trigger catalog used to be copy-pasted into the achievements manager AND
// both API routes. It's now one module for the UI — this asserts it stays in
// step with the two route files, so adding a trigger to one and not the other
// shows up here rather than as a 400 the trainer can't explain.
function routeConst(file: string, name: string): string[] {
  const src = readFileSync(path.resolve(process.cwd(), file), 'utf8')
  const block = src.slice(src.indexOf(name))
  const body = block.slice(block.indexOf('['), block.indexOf(']'))
  return Array.from(body.matchAll(/'([A-Z_]+)'/g)).map(m => m[1])
}

const CREATE_ROUTE = 'src/app/api/achievements/route.ts'
const PATCH_ROUTE = 'src/app/api/achievements/[achievementId]/route.ts'

describe('the trigger catalog agrees with the API routes', () => {
  it('offers exactly the trigger types the create route accepts', () => {
    expect(TRIGGERS.map(t => t.type).sort()).toEqual(routeConst(CREATE_ROUTE, 'TRIGGER_TYPES').sort())
  })

  it('offers exactly the trigger types the patch route accepts', () => {
    expect(TRIGGERS.map(t => t.type).sort()).toEqual(routeConst(PATCH_ROUTE, 'TRIGGER_TYPES').sort())
  })

  it('asks for a threshold on exactly the triggers the server requires one for', () => {
    const uiNeedsValue = TRIGGERS.filter(t => t.needsValue).map(t => t.type).sort()
    expect(uiNeedsValue).toEqual(routeConst(CREATE_ROUTE, 'TRIGGERS_NEEDING_VALUE').sort())
    expect(uiNeedsValue).toEqual(routeConst(PATCH_ROUTE, 'TRIGGERS_NEEDING_VALUE').sort())
  })

  it('gives every threshold trigger a label for the number box', () => {
    for (const t of TRIGGERS.filter(t => t.needsValue)) {
      expect(t.valueLabel, t.type).toBeTruthy()
    }
  })
})

// "Packages" was renamed: a Package is now the bundled offering, and the 1:1
// thing these two triggers count became a "consult". The trigger TYPES are
// stored on every existing achievement row and must never move — only the
// words the trainer reads.
describe('the 1:1 triggers say consult, not package', () => {
  const renamed = TRIGGERS.filter(t => t.type === 'FIRST_PACKAGE_ASSIGNED' || t.type === 'PACKAGES_COMPLETED')

  it('still stores the original trigger types', () => {
    expect(renamed.map(t => t.type)).toEqual(['FIRST_PACKAGE_ASSIGNED', 'PACKAGES_COMPLETED'])
  })

  it('reads as consults everywhere the trainer sees it', () => {
    for (const t of renamed) {
      expect(t.label.toLowerCase(), t.type).not.toContain('package')
      expect(t.label.toLowerCase(), t.type).toContain('consult')
      expect(t.group).toBe('1:1 Consults')
      expect(t.preview(2).toLowerCase(), t.type).not.toContain('package')
      expect(t.preview(2).toLowerCase(), t.type).toContain('consult')
      if (t.valueLabel) expect(t.valueLabel.toLowerCase(), t.type).not.toContain('package')
    }
  })

  it('no trigger anywhere in the catalog still says "package"', () => {
    for (const t of TRIGGERS) {
      const words = [t.label, t.group, t.valueLabel ?? '', t.preview(3)].join(' ').toLowerCase()
      expect(words, t.type).not.toContain('package')
    }
  })
})

describe('triggerLine', () => {
  it('says "Manual" for a hand-awarded badge', () => {
    expect(triggerLine({ triggerType: 'MANUAL', triggerValue: null })).toBe('Manual')
  })

  it('reads back the threshold, pluralised', () => {
    expect(triggerLine({ triggerType: 'SESSIONS_COMPLETED', triggerValue: 1 }))
      .toBe('Awarded after 1 completed session')
    expect(triggerLine({ triggerType: 'SESSIONS_COMPLETED', triggerValue: 5 }))
      .toBe('Awarded after 5 completed sessions')
  })

  it('never throws on a trigger with a missing value', () => {
    expect(() => triggerLine({ triggerType: 'PERFECT_WEEK', triggerValue: null })).not.toThrow()
  })

  it('every trigger has a preview that renders', () => {
    for (const t of TRIGGERS) expect(TRIGGER_META[t.type].preview(3), t.type).toBeTruthy()
  })
})

describe('badge colours', () => {
  it('the default colour is a real one', () => {
    expect(COLOR_BY_KEY[DEFAULT_COLOR]).toBeDefined()
  })

  it('every colour is indexed by its key', () => {
    for (const c of COLORS) expect(COLOR_BY_KEY[c.key]).toBe(c)
  })
})
