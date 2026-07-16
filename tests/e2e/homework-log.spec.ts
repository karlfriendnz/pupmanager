import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// The client opens a homework task from the home "This week" list and logs a
// practice against it. Fixture: SEED.homework — a task on SEED.client's profile,
// dated at seed time so it lands in the current week. Matching the other client
// specs, login() is file-local.
async function login(page: Page, email: string, password: string, landing: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`**${landing}`, { timeout: 30_000 })
  await passIntakeGate(page)
  const maybeLater = page.getByRole('button', { name: 'Maybe later' })
  if (await maybeLater.isVisible().catch(() => false)) await maybeLater.click()
}

async function passIntakeGate(page: Page) {
  const gate = page.getByRole('heading', { name: 'Before you get started' })
  if (!(await gate.isVisible({ timeout: 5_000 }).catch(() => false))) return
  const required = page.locator('input[placeholder="Required"], select[required]')
  for (let i = 0; i < await required.count(); i++) {
    const field = required.nth(i)
    if ((await field.evaluate(el => el.tagName)) === 'SELECT') await field.selectOption({ index: 1 }).catch(() => {})
    else await field.fill('E2E')
  }
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(gate).toHaveCount(0, { timeout: 20_000 })
}

const HW = SEED.homework

test.describe('homework log — the client can open a task and log their training', () => {
  test('opens the task, sees what the trainer set, and logs a practice', async ({ page }) => {
    await login(page, SEED.client.email, SEED.client.password, '/home')

    // The task shows in "This week"; tapping the label opens its own page.
    await page.getByRole('link', { name: new RegExp(HW.title) }).click()
    await page.waitForURL(`**/my-homework/${HW.taskId}`, { timeout: 15_000 })

    // What the trainer set: title + description (the video embeds via iframe).
    await expect(page.getByRole('heading', { name: HW.title })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('loose-lead walking for 10 minutes', { exact: false })).toBeVisible()

    // Log a session: a rating + a note, then save.
    await page.getByRole('button', { name: /Great/ }).click()
    await page.getByPlaceholder(/How was the practice/).fill('Nailed it on the quiet street today.')
    await page.getByRole('button', { name: 'Save log' }).click()

    // The log lands in the history, and the task now reads as done.
    await expect(page.getByText('Nailed it on the quiet street today.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Your practice log/)).toBeVisible()
    await expect(page.getByText('Done', { exact: true })).toBeVisible()
  })

  test('a client can’t open a task that isn’t theirs (bounced home)', async ({ page }) => {
    await login(page, SEED.client.email, SEED.client.password, '/home')
    // A task id this client doesn't own → the page redirects to /home rather
    // than leaking another client's homework.
    await page.goto(`/my-homework/${SEED.businessB.clientId}`)
    await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 })
  })
})
