import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { countItems } from '@/app/(trainer)/library/library-shape'

/**
 * A library item may sit directly in its category, with no theme.
 *
 * The library used to be three required levels — category → theme → item — so
 * adding one exercise meant inventing a theme for it. The change makes a theme
 * optional GROUPING, and the two ways that goes wrong are both silent:
 *
 *   • a count that walks `themes[].tasks` alone reports 0 over an item the
 *     trainer just created;
 *   • a query that scopes ownership through the theme (`theme.type.trainerId`)
 *     stops being a tenant check at all for a theme-less item — it matches
 *     nothing rather than failing, which is how a hole opens.
 *
 * The schema assertions read `schema.prisma` as TEXT, the same way
 * schema-integrity.test.ts does: they are about DECLARATIONS, and unit tests
 * here never touch a database.
 */

const SCHEMA = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')

function model(name: string): string {
  const m = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(SCHEMA)
  if (!m) throw new Error(`model ${name} not found in schema.prisma`)
  return m[1]!
}

describe('LibraryTask says where it lives', () => {
  const task = model('LibraryTask')

  it('carries its CATEGORY directly, and required', () => {
    // Not derived through the theme: a theme-less item has nothing to walk up
    // through, and every ownership filter in the app is `type.trainerId`.
    expect(task).toMatch(/^\s*typeId\s+String\s*$/m)
    expect(task).toMatch(/type\s+LibraryType\s+@relation\(fields: \[typeId\]/)
  })

  it('makes the THEME optional', () => {
    expect(task).toMatch(/^\s*themeId\s+String\?\s*$/m)
    expect(task).toMatch(/theme\s+LibraryTheme\?\s+@relation\(fields: \[themeId\]/)
  })

  it('keeps the item when its theme is deleted, and loses it with its category', () => {
    // The whole point: deleting a theme is a rename-shaped action and must not
    // destroy work. Deleting the CATEGORY is not — that is deleting the folder.
    expect(task).toMatch(/theme\s+LibraryTheme\?[^\n]*onDelete: SetNull/)
    expect(task).toMatch(/type\s+LibraryType[^\n]*onDelete: Cascade/)
  })

  it('indexes the category column, so the tenant filter can use it', () => {
    expect(task).toMatch(/@@index\(\[typeId\]\)/)
  })
})

describe('counting what is in a category', () => {
  const item = (id: string) => ({ id, title: id })

  it('adds the themed items and the loose ones', () => {
    expect(countItems({
      id: 't', name: 'Obedience',
      themes: [
        { id: 'th1', name: 'Loose lead', items: [item('a'), item('b')] },
        { id: 'th2', name: 'Recall', items: [item('c')] },
      ],
      items: [item('d'), item('e')],
    })).toBe(5)
  })

  it('counts a category that is nothing BUT loose items', () => {
    // The shape a trainer gets the first time they add an exercise without
    // inventing a theme for it. Walking `themes[].tasks` alone returns 0 here,
    // which is the count bug this exists to stop.
    expect(countItems({ id: 't', name: 'Obedience', themes: [], items: [item('a')] })).toBe(1)
  })

  it('is 0 for an empty category', () => {
    expect(countItems({ id: 't', name: 'Obedience', themes: [], items: [] })).toBe(0)
  })
})

describe('no route scopes a library item through its theme any more', () => {
  it('has no `theme: { type: { trainerId` left in src/', () => {
    // A dead chain for a theme-less item. Grepped rather than asserted per
    // route because the failure mode is a route nobody remembered to change.
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const hits = execSync(
      `grep -rn "theme: { type: {" src --include="*.ts" --include="*.tsx" | grep -v generated || true`,
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim()
    expect(hits, `these still walk item → theme → type for ownership:\n${hits}`).toBe('')
  })
})
