import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Settings on a phone, reported from an actual phone:
//
//  1. Inside a settings sub-page the top bar still showed the app hamburger,
//     so there was no back — you had to find an in-page "All settings" link.
//     Every other detail screen swaps the menu for a back arrow; settings now
//     does too (and must NOT grow one on desktop, where the rail never leaves).
//  2. The Xero tab was built for a desktop column and squeezed onto 390px.
//  3. "Open Stripe dashboard" navigated in place, losing the settings page.
//
// Runs against the isolated embedded Postgres (see global-setup.ts).

const PHONE = { width: 390, height: 844 }

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

// Anything wider than the viewport means a sideways scroll on a phone.
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }))
}

test.describe('settings chrome on a phone', () => {
  test.use({ viewport: PHONE })

  test('a sub-page swaps the app menu for a back arrow to all settings', async ({ page }) => {
    await loginOwner(page)

    // The settings landing screen IS a top-level page: menu stays, no back.
    await page.goto('/settings')
    const menu = page.locator('header button[aria-label="Menu"]')
    const back = page.locator('header a[aria-label="All settings"]')
    await expect(menu).toBeVisible()
    await expect(back).toHaveCount(0)

    // Open a setting — from here "back" is what you reach for.
    await page.getByRole('link', { name: 'Notifications' }).click()
    await page.waitForURL('**/settings?tab=notifications')
    await expect(back).toBeVisible()
    await expect(menu).toHaveCount(0)
    // The old in-page duplicate is gone — the bar says it once.
    await expect(page.getByRole('link', { name: 'All settings' })).toHaveCount(1)

    // And it goes back to the menu grid, not out of settings entirely.
    await back.click()
    await page.waitForURL(url => url.pathname === '/settings' && !url.search)
    await expect(page.getByRole('link', { name: 'Notifications' })).toBeVisible()
    await expect(page.locator('header button[aria-label="Menu"]')).toBeVisible()
  })

  test('the Xero tab fits 390px — no sideways scroll, no thumb-sized-miss controls', async ({ page }) => {
    const prisma = await makePrisma()
    const trainer = await prisma.trainerProfile.findFirst({
      where: { businessName: SEED.owner.businessName }, select: { id: true },
    })
    const before = await prisma.trainerAddon.findUnique({
      where: { trainerId_itemId: { trainerId: trainer!.id, itemId: 'xero' } },
      select: { active: true },
    })
    try {
      await loginOwner(page)
      // Xero is a free add-on but not default-on, so the tab only exists once
      // it's switched on. Enable through the real endpoint.
      const on = await page.request.post('/api/addons', { data: { itemId: 'xero', active: true } })
      expect(on.ok(), 'could not switch the Xero add-on on').toBeTruthy()

      await page.goto('/settings?tab=xero')
      await expect(page.getByRole('heading', { name: 'Xero accounting' })).toBeVisible()

      const { doc, win } = await horizontalOverflow(page)
      expect(doc, `page is ${doc}px wide in a ${win}px viewport`).toBeLessThanOrEqual(win)

      // The connect CTA is the one thing to tap here — when this environment
      // has Xero credentials it must be a real target, full width on a phone
      // rather than a lonely 120px pill. (Without credentials the card shows
      // the "not configured here" note instead, and there's nothing to tap.)
      const connect = page.getByRole('link', { name: /Connect Xero/i })
      if (await connect.count()) {
        const box = await connect.boundingBox()
        expect(box!.height).toBeGreaterThanOrEqual(40)
        expect(box!.width).toBeGreaterThan(200)
      }
    } finally {
      // Put the add-on back exactly as it was — one seeded DB, shared by every spec.
      if (before?.active !== true) {
        await page.request.post('/api/addons', { data: { itemId: 'xero', active: false } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  test('"Open Stripe dashboard" opens a new tab and leaves settings behind', async ({ page }) => {
    const prisma = await makePrisma()
    const trainer = await prisma.trainerProfile.findFirst({
      where: { businessName: SEED.owner.businessName },
      select: {
        id: true, connectAccountId: true, connectChargesEnabled: true,
        connectPayoutsEnabled: true, connectDetailsSubmitted: true,
      },
    })
    const { id, ...before } = trainer!
    try {
      // Pretend Stripe onboarding finished. All three flags true, so the panel
      // renders the active state WITHOUT calling Stripe to re-sync.
      await prisma.trainerProfile.update({
        where: { id },
        data: {
          connectAccountId: 'acct_e2e_dashboard',
          connectChargesEnabled: true,
          connectPayoutsEnabled: true,
          connectDetailsSubmitted: true,
        },
      })

      await loginOwner(page)
      await page.goto('/settings?tab=payments')

      const link = page.getByRole('link', { name: /Open Stripe dashboard/i })
      await expect(link).toBeVisible()
      // A new tab on the web: Stripe is somewhere you come back from, and the
      // settings page should still be sitting there when you do.
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(link).toHaveAttribute('rel', /noopener/)
      // The href is our own route — it mints a single-use login link server-side
      // and redirects — so the new tab carries the session.
      await expect(link).toHaveAttribute('href', '/api/connect/login-link')

      // Same route, json mode: what the native shell fetches so it can hand the
      // real Stripe URL to the OS browser (which has no app session).
      const res = await page.request.get('/api/connect/login-link?json=1')
      // Stripe isn't reachable from the test env, so a 502 is the honest answer —
      // what matters is that it answers in JSON and never redirects into HTML.
      expect([200, 502]).toContain(res.status())
      expect(res.headers()['content-type']).toContain('application/json')
    } finally {
      // Restore the seeded Connect state.
      await prisma.trainerProfile.update({ where: { id }, data: before })
      await prisma.$disconnect()
    }
  })
})

test.describe('settings chrome on desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('no back arrow in the desktop top bar — the rail never leaves', async ({ page }) => {
    await loginOwner(page)
    await page.goto('/settings?tab=notifications')
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
    // The desktop bar's back slot stays empty: on desktop a tab is always
    // showing, so "back" would just silently reset you to the first one.
    await expect(page.locator('#pm-topbar-back > *')).toHaveCount(0)
  })
})
