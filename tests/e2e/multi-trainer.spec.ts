import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// End-to-end coverage of the multi-trainer feature against an isolated embedded
// Postgres (see playwright.e2e.config.ts + global-setup.ts). Logs in as the
// seeded owner, builds out a team of 5 trainers, sets permissions, and assigns
// a client to a trainer.

async function loginAsOwner(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

async function openTeamTab(page: Page) {
  await page.goto('/settings?tab=team')
  await expect(page.getByRole('heading', { name: 'Your team' })).toBeVisible()
}

test.describe('multi-trainer business', () => {
  test('owner can sign in and reach the Team tab', async ({ page }) => {
    await loginAsOwner(page)
    await openTeamTab(page)
    // The seeded owner is the sole member to start.
    await expect(page.getByText(SEED.owner.email)).toBeVisible()
    await expect(page.getByText(/of 10 seats used/)).toBeVisible()
  })

  test('owner invites a team of 5 trainers', async ({ page }) => {
    await loginAsOwner(page)
    await openTeamTab(page)

    for (const invitee of SEED.invitees) {
      await page.getByRole('button', { name: 'Invite trainer' }).click()
      const form = page.getByTestId('invite-form')
      await form.getByPlaceholder('Jess Carter').fill(invitee.name)
      await form.getByPlaceholder('jess@example.com').fill(invitee.email)
      await form.getByRole('combobox').selectOption(invitee.role)
      await form.getByRole('button', { name: 'Send invite' }).click()
      // The roster reloads and the new member shows in their own row.
      await expect(page.getByTestId(`member-${invitee.email}`)).toBeVisible({ timeout: 15_000 })
    }

    // Seed has owner + manager + staff (3); +5 invited = 8 of 10 seats used.
    await expect(page.getByText(/8 of 10 seats used/)).toBeVisible()
    for (const invitee of SEED.invitees) {
      await expect(page.getByText(invitee.email)).toBeVisible()
    }
  })

  test('a staff member sees a focused permission set, and edits persist', async ({ page }) => {
    await loginAsOwner(page)
    await openTeamTab(page)

    // Find Stan (staff) row and open its editor.
    const row = page.getByTestId('member-stan@e2e.test')
    await row.getByTitle('Edit').click()

    // Staff start without "See all clients"; tick it on and save.
    const seeAll = row.getByRole('checkbox', { name: /See all clients/ })
    await expect(seeAll).not.toBeChecked()
    await seeAll.check()
    await row.getByRole('button', { name: 'Save' }).click()

    // Reload, reopen, and confirm the toggle persisted.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Your team' })).toBeVisible()
    const row2 = page.getByTestId('member-stan@e2e.test')
    await row2.getByTitle('Edit').click()
    await expect(row2.getByRole('checkbox', { name: /See all clients/ })).toBeChecked()
  })

  test('owner can assign a client to a trainer', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/clients')
    await page.getByRole('link', { name: /Sarah Client/ }).first().click()
    await page.waitForURL('**/clients/**')

    // The assigned-trainer control shows once the business has >1 member.
    const select = page.getByTestId('assigned-trainer-select')
    await expect(select).toBeVisible({ timeout: 15_000 })
    // Wait for the PATCH to land before reloading, so we assert persisted state.
    await Promise.all([
      page.waitForResponse(r => /\/api\/clients\//.test(r.url()) && r.request().method() === 'PATCH' && r.ok()),
      select.selectOption({ label: 'Manny Manager' }),
    ])
    await page.reload()
    await expect(page.getByTestId('assigned-trainer-select')).toHaveValue(/.+/)
  })
})
