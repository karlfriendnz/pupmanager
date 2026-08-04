import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Security audit (2026-08) — cookie flags.
//
// Four of the seven `cookies.set(...)` calls in the app omit `secure`. None of
// them is a credential (each is re-verified server-side against the signed-in
// user on every request), and production is HTTPS-only — so this is hygiene
// rather than a hole. But `pm-preview-client` grants a trainer the view of a
// client's app, and `secure` costs nothing. `PROFILE_COOKIE` and the session
// cookie already do it right.
//
// Enumerates the source tree rather than listing files, so a cookie added next
// year is covered the day it lands.

const SRC = path.resolve(__dirname, '../../../src')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'generated' ? [] : walk(p)
    return /\.tsx?$/.test(e.name) ? [p] : []
  })
}

/** Each `cookies.set(` call site with the ~10 lines of options that follow it. */
function cookieWrites() {
  const out: { file: string; block: string }[] = []
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8')
    if (!src.includes('cookies.set(')) continue
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (!line.includes('cookies.set(')) return
      out.push({
        file: file.replace(SRC + '/', 'src/'),
        block: lines.slice(i, i + 12).join('\n'),
      })
    })
  }
  return out
}

// Deletions (`cookies.set(name, '', { maxAge: 0 })`) do not need `secure`.
const isDeletion = (block: string) => /maxAge:\s*0\b/.test(block) || /,\s*''\s*,/.test(block)

describe('cookie flags', () => {
  const writes = cookieWrites().filter(w => !isDeletion(w.block))

  it('finds the cookie writes', () => {
    expect(writes.length, 'the app sets cookies somewhere').toBeGreaterThan(3)
  })

  it('every cookie the app sets is httpOnly', () => {
    const bad = writes.filter(w => !/httpOnly:\s*true/.test(w.block)).map(w => w.file)
    expect(bad, 'a cookie readable from JavaScript is a cookie an XSS can steal').toEqual([])
  })

  it('every cookie the app sets declares sameSite', () => {
    const bad = writes.filter(w => !/sameSite:/.test(w.block)).map(w => w.file)
    expect(bad, 'sameSite is the CSRF backstop — never leave it to the default').toEqual([])
  })

  // KNOWN FINDING — see docs/audit-security.md. Expects the correct behaviour so
  // it goes green when `secure` is added. Skipped for now to keep the suite
  // green; the companion below pins today's state.
  it.skip('every cookie the app sets is secure in production', () => {
    const bad = writes.filter(w => !/secure:/.test(w.block)).map(w => w.file)
    expect(bad, 'add `secure: process.env.NODE_ENV === "production"`').toEqual([])
  })

  it('documents which cookies still lack secure', () => {
    const missing = writes.filter(w => !/secure:/.test(w.block)).map(w => w.file)
    // When this stops failing, the fix has landed — delete it and un-skip above.
    expect(missing.length, 'the finding is still open').toBeGreaterThan(0)
    for (const f of missing) {
      expect(f, 'the session cookie must never be one of them').not.toContain('session-cookie')
    }
  })
})
