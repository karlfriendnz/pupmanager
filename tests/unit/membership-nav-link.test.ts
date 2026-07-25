import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Regression guard for "there is currently no way to purchase a membership":
// the storefront page (/my-memberships) and buy route were fully built, but
// nothing linked to the page. These pin the nav entry + its gating so the
// entry point can't silently disappear again.
const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8')

describe('membership storefront is reachable', () => {
  it('client nav includes a Memberships link to /my-memberships', () => {
    const shell = read('src/components/shared/app-shell.tsx')
    expect(shell).toMatch(/href:\s*'\/my-memberships'/)
  })

  it('the buy route and storefront page exist', () => {
    expect(read('src/app/api/my/memberships/[membershipId]/buy/route.ts')).toContain('export async function POST')
    expect(read('src/app/(client)/my-memberships/page.tsx')).toContain('published: true')
  })

  it('the nav link is gated on the trainer having a published one-off membership', () => {
    const layout = read('src/app/(client)/layout.tsx')
    expect(layout).toContain('/my-memberships')
    expect(layout).toMatch(/published:\s*true/)
    expect(layout).toContain("cadence: 'ONE_OFF'")
  })
})
