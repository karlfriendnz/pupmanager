import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// src/lib/review-core/ is a COPY of the shared review-core package, which
// fm-events reads too. A fix made in the copy is a fix only this app gets — the
// exact drift the package exists to prevent. So the copy has to be provably
// current.
//
// Skipped when review-core isn't checked out beside this repo (CI, a fresh clone):
// there is nothing to compare against, and failing then would just be noise.
const SOURCE = join(process.cwd(), '..', 'review-core', 'src')

describe('the vendored review-core copy', () => {
  it.skipIf(!existsSync(SOURCE))('matches the package it was copied from', () => {
    // The sync script's own --check does the comparison, header and all.
    expect(() => execFileSync('node', ['scripts/sync-review-core.mjs', '--check'], {
      cwd: process.cwd(), stdio: 'pipe',
    })).not.toThrow()
  })

  it('has every module the app imports', () => {
    const files = readdirSync(join(process.cwd(), 'src', 'lib', 'review-core'))
    for (const f of ['index.ts', 'target.ts', 'brief.ts', 'page-key.ts', 'config.ts', 'types.ts', 'resolvers.ts']) {
      expect(files).toContain(f)
    }
  })

  it('marks every copied file as generated, so nobody edits it here', () => {
    const dir = join(process.cwd(), 'src', 'lib', 'review-core')
    for (const f of readdirSync(dir)) {
      const head = require('node:fs').readFileSync(join(dir, f), 'utf8').slice(0, 200)
      expect(head).toContain('GENERATED — do not edit here')
    }
  })
})
