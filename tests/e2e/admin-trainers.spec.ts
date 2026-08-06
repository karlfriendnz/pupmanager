import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// /admin is the ONE Super Admin businesses screen (platform totals + recurring
// revenue + lifecycle tabs + the table). It must list one row per COMPANY
// (account owners), not every individual trainer: invited team members are
// TRAINER users with no profile of their own and must NOT appear as separate
// rows.
//
// The page renders BOTH layouts and hides one by breakpoint — mobile cards
// (md:hidden) come first in the DOM, then the desktop table (hidden md:block).
// So `.first()` on a plain text match grabs the hidden card at desktop width.
// Every locator here filters to what's actually visible.

async function loginAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.admin.email)
  await page.getByLabel('Password').fill(SEED.admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

test.describe('admin /admin — companies, not individual trainers', () => {
  test('lists businesses and hides invited team members', async ({ page }) => {
    await loginAdmin(page)
    // Search rather than a tab: the seeded businesses are ACTIVE with no Stripe
    // subscription, so they sit in no lifecycle bucket, and search is what
    // reaches them now that "All" is gone. "Dog" matches both seeded business
    // names ("E2E Dog School", "Rival Dog Co") and no team member's name — so
    // the absence assertions below still mean something.
    await page.goto('/admin?q=Dog')

    await expect(page.getByRole('heading', { name: 'Businesses' })).toBeVisible()

    // Both companies appear (the owner's business + business B).
    await expect(page.getByText(SEED.owner.businessName).locator('visible=true').first()).toBeVisible()
    await expect(page.getByText(SEED.businessB.businessName).locator('visible=true').first()).toBeVisible()

    // Invited members (no company of their own) are NOT separate rows.
    await expect(page.getByText(SEED.manager.name)).toHaveCount(0)
    await expect(page.getByText(SEED.staff.name)).toHaveCount(0)
  })

  test('a row opens the trainer full view with detail + actions', async ({ page }) => {
    await loginAdmin(page)
    await page.goto(`/admin?q=${encodeURIComponent(SEED.owner.businessName)}`)

    // Each row links into that trainer's full view. The desktop table links the
    // OWNER'S NAME while the mobile card links the business name, so match on the
    // href rather than the label — the destination is what this test is about.
    await page
      .locator('table a[href^="/admin/trainers/"]')
      .filter({ hasText: SEED.owner.name })
      .first()
      .click()
    await page.waitForURL(/\/admin\/trainers\/.+/, { timeout: 30_000 })

    // The full view shows the business as a heading plus the controls that used
    // to be crammed into the table row.
    await expect(page.getByRole('heading', { name: SEED.owner.businessName })).toBeVisible()
    await expect(page.getByText('Subscription & access')).toBeVisible()
    await expect(page.getByText('Danger zone')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Log in as' })).toBeVisible()

    // Back link returns to the merged list.
    await page.getByRole('link', { name: 'Businesses' }).first().click()
    await expect(page.getByRole('heading', { name: 'Businesses' })).toBeVisible()
  })

  // The lifecycle tabs (including the internal "Ours" and soft-deleted
  // "Inactive" ones) moved onto /admin wholesale and must still filter + count.
  test('lifecycle tabs still filter and carry their counts', async ({ page }) => {
    await loginAdmin(page)
    await page.goto(`/admin?q=${encodeURIComponent(SEED.owner.businessName)}`)

    for (const label of ['In Trial', 'Paying customer', 'Churned', 'Ours', 'Inactive']) {
      await expect(page.getByRole('link', { name: new RegExp(`^${label} \\d+$`) })).toBeVisible()
    }

    // "Ours" shows only internal accounts — the seeded businesses aren't, so
    // switching tabs must drop them.
    await page.getByRole('link', { name: /^Ours \d+$/ }).click()
    await page.waitForURL(/tab=ours/, { timeout: 30_000 })
    await expect(page.getByText(SEED.owner.businessName)).toHaveCount(0)

    // Search keeps the active tab rather than bouncing back to the default.
    await page.getByPlaceholder('Search by name or email...').fill('zzz-no-such-trainer')
    await page.getByPlaceholder('Search by name or email...').press('Enter')
    await page.waitForURL(/tab=ours/, { timeout: 30_000 })
    await expect(page.getByText('No trainers found')).toBeVisible()
  })

  // Bookmarks and older links point at the old list URL.
  test('/admin/trainers redirects to /admin, keeping the tab', async ({ page }) => {
    await loginAdmin(page)

    await page.goto('/admin/trainers')
    await expect(page).toHaveURL(/\/admin(\?|$)/)
    await expect(page.getByRole('heading', { name: 'Businesses' })).toBeVisible()

    await page.goto('/admin/trainers?tab=paying')
    await expect(page).toHaveURL(/\/admin\?tab=paying/)
    // Assert the TAB survived the redirect, not that a particular business is
    // on it: the seeded owner is ACTIVE with no Stripe subscription, so it sits
    // in no lifecycle bucket and is reachable by search rather than by tab.
    await expect(page.getByRole('link', { name: /Paying customer/ })).toBeVisible()
  })

  // Column sorting is URL-driven (?sort=&dir=) so it survives a refresh and can
  // be shared — the same way tab and q already work. The two seeded businesses
  // are "E2E Dog School" (owner, seeded first) and "Rival Dog Co" (seeded
  // second), so alphabetical and newest-first are opposite orders — which is
  // what makes these assertions mean something.
  const firstBusiness = (page: Page) =>
    page.locator('table tbody tr').first().locator('td').nth(1)
  // BOTH layouts are in the DOM at every width (one is hidden by breakpoint), so
  // every locator must say which one it means or it matches two elements.
  const header = (page: Page, name: string) =>
    page.locator('table thead').getByRole('link', { name, exact: true })

  // In Trial answers "who just signed up", so it leads with the newest join
  // without anyone clicking Joined first (Karl, 2026-08-06). The tab now names
  // its sorted column instead of arriving in an unnamed order.
  test('In Trial defaults to newest joined, and says so', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin?q=Dog')
    // Newest-first either way, so the business seeded second still leads.
    await expect(firstBusiness(page)).toContainText(SEED.businessB.businessName)
    // Exactly one column claims the sort, and it is Joined.
    const sorted = page.locator('table th[aria-sort="ascending"], table th[aria-sort="descending"]')
    await expect(sorted).toHaveCount(1)
    await expect(sorted).toHaveAttribute('aria-sort', 'descending')
    await expect(sorted).toContainText('Joined')
  })

  test('clicking a column header sorts, and clicking it again reverses', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin?q=Dog')

    await header(page, 'Business').click()
    await page.waitForURL(/sort=business&dir=asc/, { timeout: 30_000 })
    await expect(firstBusiness(page)).toContainText(SEED.owner.businessName)
    await expect(page.locator('table th[aria-sort="ascending"]')).toHaveCount(1)

    await header(page, 'Business').click()
    await page.waitForURL(/sort=business&dir=desc/, { timeout: 30_000 })
    await expect(firstBusiness(page)).toContainText(SEED.businessB.businessName)
    await expect(page.locator('table th[aria-sort="descending"]')).toHaveCount(1)
  })

  test('sorting keeps the active tab and the search, and searching keeps the sort', async ({ page }) => {
    await loginAdmin(page)
    await page.goto('/admin?tab=paying&q=Dog')

    await header(page, 'Business').click()
    await page.waitForURL(/sort=business/, { timeout: 30_000 })
    // Losing your tab or your filter because you sorted is the obvious failure.
    await expect(page).toHaveURL(/tab=paying/)
    await expect(page).toHaveURL(/q=Dog/)
    await expect(firstBusiness(page)).toContainText(SEED.owner.businessName)

    // …and the GET search form carries the sort back out again.
    await page.getByPlaceholder('Search by name or email...').fill('Dog')
    await page.getByPlaceholder('Search by name or email...').press('Enter')
    await page.waitForURL(/sort=business/, { timeout: 30_000 })
    await expect(page).toHaveURL(/tab=paying/)
    await expect(firstBusiness(page)).toContainText(SEED.owner.businessName)
  })

  // Columns that can never say anything on a tab are hidden there rather than
  // printed as a column of dashes.
  test('each tab only shows the columns that can say something', async ({ page }) => {
    await loginAdmin(page)
    const header = (name: string) => page.locator('table thead th').filter({ hasText: new RegExp(`^${name}$`) })

    await page.goto('/admin?tab=trial&q=Dog')
    await expect(header('Value')).toHaveCount(0)          // trialists have no plan value
    await expect(header('Trial ends')).toHaveCount(1)

    await page.goto('/admin?tab=paying&q=Dog')
    await expect(header('Likely')).toHaveCount(0)         // they already converted
    await expect(header('Trial ends')).toHaveCount(0)
    await expect(header('Onboarding')).toHaveCount(0)
    await expect(header('Value')).toHaveCount(1)

    // Churned drops Value for the same reason (a cancelled account can't be
    // paying) but keeps everything that still describes how they went.
    await page.goto('/admin?tab=churned&q=Dog')
    await expect(header('Value')).toHaveCount(0)
    await expect(header('Likely')).toHaveCount(1)
    await expect(header('Onboarding')).toHaveCount(1)
    await expect(header('Trial ends')).toHaveCount(1)
  })

  // The non-obvious interaction between the two features.
  test('a sort on a column the tab hides falls back to the default order', async ({ page }) => {
    await loginAdmin(page)
    // Value sorts fine on Paying, the tab where it always has something to say…
    await page.goto('/admin?tab=paying&q=Dog&sort=value&dir=desc')
    await expect(page.locator('table th[aria-sort="descending"]')).toHaveCount(1)

    // …but In Trial hides Value, so the same URL must not sort by an invisible
    // column (which reads as a random order). It falls back to that tab's own
    // default — Joined, newest first — rather than to no sort at all.
    await page.goto('/admin?tab=trial&q=Dog&sort=value&dir=desc')
    const fallback = page.locator('table th[aria-sort="ascending"], table th[aria-sort="descending"]')
    await expect(fallback).toHaveCount(1)
    await expect(fallback).toContainText('Joined')
    await expect(firstBusiness(page)).toContainText(SEED.businessB.businessName)

    // Switching tabs doesn't carry a sort into a tab that can't show it.
    await page.goto('/admin?tab=paying&q=Dog&sort=value&dir=desc')
    await page.getByRole('link', { name: /^In Trial \d+$/ }).click()
    await page.waitForURL(/tab=trial/, { timeout: 30_000 })
    await expect(page).not.toHaveURL(/sort=value/)
  })

  // Phones get the same URL sort as a chip strip — the card list has no header
  // row to click, and leaving it silently in a different order is not an option.
  test('mobile cards carry the same sort, changeable from the sort strip', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAdmin(page)
    await page.goto('/admin?q=Dog')

    const strip = page.getByTestId('mobile-sort')
    await expect(strip).toBeVisible()
    const cards = page.locator('ul li a[href^="/admin/trainers/"]')
    await expect(cards.first()).toContainText(SEED.businessB.businessName)

    // The strip lists the sortable columns; picking one reorders the cards.
    await strip.getByRole('link', { name: 'Business', exact: true }).click()
    await page.waitForURL(/sort=business&dir=asc/, { timeout: 30_000 })
    await expect(cards.first()).toContainText(SEED.owner.businessName)

    // "Default" clears it again.
    await strip.getByRole('link', { name: 'Default' }).click()
    await page.waitForURL(u => !u.searchParams.has('sort'), { timeout: 30_000 })
    await expect(cards.first()).toContainText(SEED.businessB.businessName)
  })

  // The admin guard lives in (admin)/layout.tsx and must still hold for the
  // merged screen — a trainer signing in has no business seeing the platform.
  test('a non-admin cannot reach /admin', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email address').fill(SEED.owner.email)
    await page.getByLabel('Password').fill(SEED.owner.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })

    await page.goto('/admin')
    await expect(page).not.toHaveURL(/\/admin(\?|$)/)
    await expect(page.getByRole('heading', { name: 'Businesses' })).toHaveCount(0)
  })
})
