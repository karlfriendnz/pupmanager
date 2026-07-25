import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Regression guard for "there is currently no way to purchase a membership":
// the storefront page (/my-memberships) and buy route were fully built, but
// nothing linked to the page. The entry point has since MOVED — memberships are
// now a type inside the client Offerings flow rather than their own nav entry —
// so these pin the new path from Offerings → membership cards → buy route.
const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8')

describe('membership storefront is reachable', () => {
  it('the Offerings flow offers Memberships as a type and renders the cards', () => {
    const wizard = read('src/app/(client)/my-availability/booking-wizard.tsx')
    expect(wizard).toContain("setCategory('memberships')")
    expect(wizard).toContain('<MembershipCards')
    expect(wizard).toContain("from '@/components/shared/membership-cards'")
  })

  it('the Offerings page loads published memberships and passes them to the wizard', () => {
    const page = read('src/app/(client)/my-availability/page.tsx')
    expect(page).toContain('loadPublishedMemberships')
    expect(page).toContain('memberships={memberships}')
  })

  it('the cards buy through the buy route, which still exists alongside the storefront page', () => {
    expect(read('src/components/shared/membership-cards.tsx')).toContain('/api/my/memberships/${id}/buy')
    expect(read('src/app/api/my/memberships/[membershipId]/buy/route.ts')).toContain('export async function POST')
    expect(read('src/app/(client)/my-memberships/page.tsx')).toContain('loadPublishedMemberships')
  })

  it('only published, buyable (one-off) memberships are offered', () => {
    const lib = read('src/lib/client-memberships.ts')
    expect(lib).toMatch(/published:\s*true/)
    expect(lib).toContain("cadence: 'ONE_OFF'")
  })

  it('memberships no longer take a client nav entry of their own', () => {
    const layout = read('src/app/(client)/layout.tsx')
    expect(layout).toMatch(/hiddenClientNav\.push\('\/my-memberships'\)/)
  })
})
