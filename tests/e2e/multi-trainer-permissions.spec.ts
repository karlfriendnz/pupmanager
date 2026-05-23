import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// Verifies the permission system actually enforces server-side: a STAFF member
// is blocked from management areas (nav + API) and only sees assigned clients,
// while a MANAGER has full operational access. Runs against the isolated DB.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test.describe('permission enforcement', () => {
  test('staff: management nav hidden, management API blocked, only assigned clients', async ({ page }) => {
    await login(page, SEED.staff.email, SEED.staff.password)

    // Nav: Packages hidden, Clients visible.
    await expect(page.getByRole('link', { name: 'Packages' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Clients' }).first()).toBeVisible()

    // API: creating a package is forbidden.
    const res = await page.request.post('/api/packages', {
      data: { name: 'Sneaky package', sessionCount: 3, weeksBetween: 1, durationMins: 60 },
    })
    expect(res.status()).toBe(403)

    // API: inviting a client is forbidden (clients.invite is manager-level).
    const inviteRes = await page.request.post('/api/clients/invite', {
      data: { clientName: 'Nope Client', dogNames: ['Rex'], clientEmail: 'nope@e2e.test', sendInvite: false },
    })
    expect(inviteRes.status()).toBe(403)

    // Clients list: sees the assigned client, not the unassigned one.
    await page.goto('/clients')
    await expect(page.getByText('Sarah Client').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Unassigned Client')).toHaveCount(0)
  })

  test('manager: management nav visible, can create a package', async ({ page }) => {
    await login(page, SEED.manager.email, SEED.manager.password)

    await expect(page.getByRole('link', { name: 'Packages' }).first()).toBeVisible()

    const res = await page.request.post('/api/packages', {
      data: { name: 'Manager package', sessionCount: 3, weeksBetween: 1, durationMins: 60 },
    })
    expect([200, 201]).toContain(res.status())

    // Manager can save business settings (resolves by company id, settings.edit).
    const settingsRes = await page.request.patch('/api/trainer/profile', {
      data: { phone: '021 555 0100' },
    })
    expect(settingsRes.status()).toBe(200)
  })

  test('staff: cannot save business settings', async ({ page }) => {
    await login(page, SEED.staff.email, SEED.staff.password)
    const res = await page.request.patch('/api/trainer/profile', { data: { phone: '021 000 0000' } })
    expect(res.status()).toBe(403)
  })
})
