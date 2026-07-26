import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'
import { ADDONS } from '../../src/lib/pricing'

// Setting up a new business means turning add-ons on, one after another, and
// then actually using the thing you just paid for. This drives that: every
// add-on in the catalog gets toggled through the real endpoint, and every
// add-on that owns a page has that page opened afterwards.
//
// It exists because of a production bug this shape of test would have caught:
// TrainerAddon.itemId is an FK to BillingItem, so an add-on in the catalog with
// no BillingItem row 500s the moment anyone toggles it — Events and Doggy
// Daycare shipped that way and looked like they simply weren't add-ons.

const PHONE = { width: 390, height: 844 }
test.use({ viewport: PHONE })

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

async function loginOwner(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

// Add-ons that own a page, and what proves that page rendered rather than
// bouncing to the Add-ons tab.
const ADDON_PAGES: { id: string; path: string; heading: RegExp }[] = [
  { id: 'events', path: '/events', heading: /Events/ },
  { id: 'puppyschool', path: '/doggy-daycare', heading: /Doggy Daycare/i },
  { id: 'memberships', path: '/memberships', heading: /Packages/ },
  { id: 'timesheets', path: '/timesheets', heading: /Timesheets/i },
  // Paid add-ons need a live subscription to switch on, so their pages can't be
  // reached from a trial account — they're covered by the refusal test instead.
  { id: 'library', path: '/library', heading: /Librar/i },
  { id: 'classes', path: '/classes', heading: /Class/i },
  { id: 'dropins', path: '/casual-classes', heading: /Casual/i },
]

// Not a normal toggle: 'payments' is a link to Stripe onboarding, and
// coming-soon ones can't be enabled at all.
const TOGGLEABLE = ADDONS.filter(a => !a.comingSoon && a.id !== 'payments')
// Free ones switch on there and then. PAID ones can't — they need a live
// subscription, and the seeded trainer is on a trial with no Stripe sub, which
// is exactly the state a real trialist is in.
const FREE = TOGGLEABLE.filter(a => a.free)
const PAID = TOGGLEABLE.filter(a => !a.free)

test.describe('setting up every add-on', () => {
  test('every add-on toggles on and off through the real endpoint', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await loginOwner(page)
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })

      const broken: string[] = []
      for (const addon of FREE) {
        const on = await page.request.post('/api/addons', { data: { itemId: addon.id, active: true } })
        if (!on.ok()) {
          broken.push(`${addon.id}: enable → ${on.status()} ${(await on.text()).slice(0, 120)}`)
          continue
        }
        const row = await prisma.trainerAddon.findFirst({
          where: { trainerId: trainer!.id, itemId: addon.id },
          select: { active: true },
        })
        if (row?.active !== true) broken.push(`${addon.id}: enabled but no active row`)
      }

      expect(broken, `free add-ons that could not be switched on:\n${broken.join('\n')}`).toEqual([])
    } finally {
      await prisma.$disconnect()
    }
  })

  // A trialist clicking a paid add-on should be told to subscribe — not given a
  // crash, and not quietly switched on without ever being billed.
  test('a paid add-on asks a trialist to subscribe rather than failing', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await loginOwner(page)
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true, stripeSubscriptionId: true },
      })
      expect(trainer?.stripeSubscriptionId, 'seeded trainer is meant to have no Stripe sub').toBeFalsy()

      const wrong: string[] = []
      for (const addon of PAID) {
        // Compare against what was there BEFORE: the seed pre-enables marketing
        // for the bulk-email specs, so "is it active" on its own proves nothing.
        const where = { trainerId_itemId: { trainerId: trainer!.id, itemId: addon.id } }
        const before = await prisma.trainerAddon.findUnique({ where, select: { active: true } })

        const res = await page.request.post('/api/addons', { data: { itemId: addon.id, active: true } })
        const body = await res.json().catch(() => ({}))
        if (res.status() !== 409 || !body.needsSubscription) {
          wrong.push(`${addon.id}: ${res.status()} ${JSON.stringify(body).slice(0, 120)}`)
          continue
        }
        const after = await prisma.trainerAddon.findUnique({ where, select: { active: true } })
        if (!before?.active && after?.active) {
          wrong.push(`${addon.id}: refused with 409 but switched itself on anyway`)
        }
      }

      expect(wrong, `paid add-ons that did not refuse cleanly:\n${wrong.join('\n')}`).toEqual([])
    } finally {
      await prisma.$disconnect()
    }
  })

  test('each add-on page opens once its add-on is on', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await loginOwner(page)

      const broken: string[] = []
      for (const entry of ADDON_PAGES) {
        const on = await page.request.post('/api/addons', { data: { itemId: entry.id, active: true } })
        if (!on.ok()) { broken.push(`${entry.id}: could not enable (${on.status()})`); continue }

        await page.goto(entry.path)
        // Landing back on the Add-ons tab means the gate rejected us.
        if (page.url().includes('tab=addons')) {
          broken.push(`${entry.path}: bounced to the Add-ons tab despite ${entry.id} being on`)
          continue
        }
        // The trainer shell renders page titles itself (not as a heading role),
        // and renders BOTH layouts with one hidden by breakpoint — so match on
        // what's actually visible, or .first() picks the hidden desktop copy.
        const title = page.getByText(entry.heading).locator('visible=true').first()
        if (!(await title.isVisible().catch(() => false))) {
          broken.push(`${entry.path}: nothing matching ${entry.heading} on the page (url ${page.url()})`)
        }
      }

      expect(broken, `add-on pages that did not open:\n${broken.join('\n')}`).toEqual([])
    } finally {
      await prisma.$disconnect()
    }
  })

  test('turning an add-on off closes its page again', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      await loginOwner(page)

      // Events is off-by-default and owns a page — the clean case to prove the
      // gate actually bites, not just that it lets people through.
      await page.request.post('/api/addons', { data: { itemId: 'events', active: false } })
      await page.goto('/events')
      expect(page.url(), 'a switched-off add-on must not leave its page reachable').toContain('tab=addons')

      // Put it back so the rest of the suite sees the seeded state.
      await page.request.post('/api/addons', { data: { itemId: 'events', active: true } })
      await page.goto('/events')
      expect(page.url()).not.toContain('tab=addons')
    } finally {
      await prisma.$disconnect()
    }
  })
})
