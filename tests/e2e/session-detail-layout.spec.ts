import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// The session detail screen, at phone width.
//
// It used to be a stack of floating cards — a 340px dog-photo hero, a card per
// empty section, three coloured action tiles, and two links hidden behind a
// "…" menu in the header. 1375px of scrolling for a session with no notes, no
// time logged and no attachments. These tests pin the shape it was rebuilt
// into: one block of facts, one strip of actions, and every empty section
// costing a single row.
async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

/** An ad-hoc session on Business A's assigned client — no notes, no time, no media. */
async function createSession(page: Page, title = 'E2E Layout Session'): Promise<string> {
  const res = await page.request.post('/api/schedule/sessions', {
    data: {
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      durationMins: 45,
      title,
      location: 'E2E Park',
      attendees: [{ clientId: SEED.assignedClientId }],
    },
  })
  expect(res.status(), await res.text()).toBe(200)
  const { id } = await res.json() as { id: string }
  expect(id).toBeTruthy()
  return id
}

test.use({ viewport: { width: 390, height: 844 } })

test('an empty session fits on a phone — one facts block, collapsed sections, no hero', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const id = await createSession(page)
  await page.goto(`/sessions/${id}`)

  // The facts are a list: when (with duration) and where.
  await expect(page.getByText('45 min', { exact: false })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('E2E Park')).toBeVisible()

  // Every empty section costs ONE row that says what's in it — no card, no
  // heading, no "nothing here yet" paragraph inside a bordered box.
  await expect(page.getByText('No photos or videos')).toBeVisible()
  await expect(page.getByText('None set')).toBeVisible()
  await expect(page.getByText('Nothing logged')).toBeVisible()

  // Collapsed means collapsed: the uploader only exists once the row is opened.
  const addPhoto = page.getByRole('button', { name: 'Add photo' })
  await expect(addPhoto).toBeHidden()
  await page.getByText('Photos & video', { exact: true }).click()
  await expect(addPhoto).toBeVisible()
  await page.getByText('Photos & video', { exact: true }).click()

  // The whole screen, closed, has to stay in the same order of magnitude as a
  // couple of phone screens. It was 1375px before the rebuild; this guard trips
  // long before it could creep back there.
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  expect(height).toBeLessThan(1200)
})

test('every action stays reachable on the page itself — nothing hides in a "…" menu', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const id = await createSession(page, 'E2E Actions Session')
  await page.goto(`/sessions/${id}`)

  // The header's overflow menu is gone — its two items live on the page now.
  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Preview report/ })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /Delete session/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Client profile/ })).toBeVisible()

  // Complete and invoice are inline, and they still write through.
  await page.getByRole('button', { name: 'Complete' }).click()
  await expect(page.getByRole('button', { name: 'Completed' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Invoice', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Invoiced' })).toBeVisible({ timeout: 20_000 })

  await page.reload()
  await expect(page.getByRole('button', { name: 'Completed' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Invoiced' })).toBeVisible()
})

test('delete asks first, and only then deletes', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const id = await createSession(page, 'E2E Delete Session')
  await page.goto(`/sessions/${id}`)

  // One tap must never destroy a session.
  await page.getByRole('button', { name: /Delete session/ }).click()
  const confirm = page.getByText('Delete this session?').locator('..')
  await expect(confirm).toBeVisible({ timeout: 20_000 })
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Delete this session?')).toHaveCount(0)
  expect((await page.request.get(`/sessions/${id}`)).status()).toBe(200)

  // Confirming does.
  await page.getByRole('button', { name: /Delete session/ }).click()
  await page.getByText('Delete this session?').locator('..')
    .getByRole('button', { name: 'Delete', exact: true }).click()
  await page.waitForURL(url => !url.pathname.includes(`/sessions/${id}`), { timeout: 20_000 })
  expect((await page.request.get(`/sessions/${id}`)).status()).toBe(404)
})

test('another tenant cannot open the session', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const id = await createSession(page, 'E2E Tenant Session')

  await page.context().clearCookies()
  await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
  expect((await page.request.get(`/sessions/${id}`)).status()).toBe(404)
})
