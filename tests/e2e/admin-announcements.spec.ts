import { test, expect, type Page } from '@playwright/test'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Platform announcements: a super-admin authors one in the (admin) area and
// broadcasts it, and it lands in every trainer's notification bell. Also guards
// that a normal trainer can't reach the admin authoring page.

void TEST_DATABASE_URL

async function loginAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.admin.email)
  await page.getByLabel('Password').fill(SEED.admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function loginTrainer(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test.describe('Platform announcements', () => {
  test('admin sends an announcement and a trainer sees it in their bell', async ({ page }) => {
    const title = `New feature ${Date.now()}`
    const body = 'You can now type any address, even if it is not in the list.'

    await loginAdmin(page)
    await page.goto('/admin/announcements')
    await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible()

    await page.getByPlaceholder("Adding a client's address is easier").fill(title)
    await page.getByPlaceholder(/You can now type any address/).fill(body)

    await page.getByRole('button', { name: 'Send to all trainers' }).click()
    // Wait for the broadcast to complete before asserting.
    const sent = page.waitForResponse(
      (r) => /\/api\/admin\/announcements\/[^/]+\/send$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 15_000 },
    )
    await page.getByRole('button', { name: 'Yes, send' }).click()
    expect((await sent).ok()).toBe(true)

    // It moves into the Sent history (router.refresh re-reads the DB).
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 })

    // Now a trainer (the owner) must see it in their notifications feed.
    await page.context().clearCookies()
    await loginTrainer(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/notifications')
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(body).first()).toBeVisible()
  })

  test('a normal trainer cannot open the admin announcements page', async ({ page }) => {
    await loginTrainer(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/admin/announcements')
    // A non-admin is bounced off the admin area (to their dashboard) and never
    // sees the authoring page.
    await page.waitForURL((u) => !u.pathname.startsWith('/admin'), { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Announcements' })).toHaveCount(0)
  })
})
