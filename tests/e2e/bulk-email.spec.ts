import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// E2E for bulk client email (POST /api/clients/email-bulk). API-driven, matching
// notifications-email.spec.ts. The actual send can't succeed in e2e (no real
// Resend), so the happy path lives in the unit suite; here we prove the guards
// that fire BEFORE any send: the verified-sending-domain gate, cross-tenant
// isolation, and auth. Seed trainers have no verified sending domain.
const B = SEED.businessB

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test.describe('bulk email — guards', () => {
  test('blocks sending until the trainer has verified a sending domain', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.request.post('/api/clients/email-bulk', {
      data: { clientIds: [SEED.assignedClientId], subject: 'Hello', body: '<p>Hi {{clientName}}</p>' },
    })
    expect(res.status()).toBe(403)
    expect((await res.json()).code).toBe('DOMAIN_NOT_VERIFIED')
  })

  test('Owner A cannot bulk-email a Business B client (no cross-tenant send)', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.request.post('/api/clients/email-bulk', {
      data: { clientIds: [B.clientId], subject: 'cross-tenant', body: '<p>hi</p>' },
    })
    // Domain gate (403) fires first for the seed owner; either way it must never
    // 201/200 a send to another tenant's client.
    expect([401, 403, 404, 422]).toContain(res.status())
  })

  test('an unauthenticated request is denied', async ({ request }) => {
    const res = await request.post('/api/clients/email-bulk', {
      data: { clientIds: ['whatever'], subject: 's', body: '<p>b</p>' },
      maxRedirects: 0,
    })
    expect([401, 403, 307]).toContain(res.status())
  })
})

test.describe('bulk email — clients-list selection UI', () => {
  test('owner can enter select mode and reveal the email action bar', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/clients?tab=never')
    await page.getByRole('button', { name: 'Select clients to email' }).click()
    // Select-all appears, and selecting all reveals the "{n} selected" bar + Email action.
    await page.getByRole('button', { name: /select all/i }).click()
    await expect(page.getByText(/\d+ selected/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Email/ })).toBeVisible()
  })
})

test.describe('marketing page', () => {
  test('owner sees the Marketing page with the domain-setup prompt and empty state', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/marketing')
    await expect(page.getByRole('heading', { name: 'Marketing' })).toBeVisible()
    // Seed owner has no verified sending domain → the domain setup panel shows
    // inline (moved here from Settings), with the empty broadcast list below.
    await expect(page.getByText(/set up email sending/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /set up/i })).toBeVisible()
    await expect(page.getByText(/no emails sent yet/i)).toBeVisible()
  })

  test('owner can open the full-page composer at /marketing/new', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/marketing/new')
    // The 3-step composer renders (step 1 = Create email) with a subject field.
    await expect(page.getByText(/create email/i).first()).toBeVisible()
    await expect(page.getByPlaceholder(/subject of your email/i)).toBeVisible()
  })

  // Placeholders are labelled in plain language; the token is still what gets
  // typed and what the server substitutes per recipient.
  test('placeholder buttons read as words and insert the raw token', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/marketing/new')
    await expect(page.getByText('Insert a placeholder')).toBeVisible()

    for (const label of ['Client name', 'Your name', 'Business name', 'Dog name']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
    // No raw tokens on the buttons.
    await expect(page.getByRole('button', { name: '{{clientName}}' })).toHaveCount(0)

    const subject = page.getByPlaceholder(/subject of your email/i)
    await subject.click()
    await page.getByRole('button', { name: 'Client name', exact: true }).click()
    await expect(subject).toHaveValue('{{clientName}}')

    // …and the live preview still fills it in, so preview == what is sent.
    await expect(page.getByText('Aria').first()).toBeVisible()
  })

  // Blocks reorder by dragging (@dnd-kit, the repo standard), with dnd-kit's
  // keyboard path as the non-pointer equivalent of the old up/down arrows.
  test('email blocks reorder by drag handle, including from the keyboard', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/marketing/new')

    const blocks = page.getByTestId('email-block')
    await expect(blocks).toHaveCount(1)
    await page.getByRole('button', { name: 'Add image' }).click()
    await expect(blocks).toHaveCount(2)
    await expect(blocks.nth(0)).toHaveAttribute('data-block-type', 'text')
    await expect(blocks.nth(1)).toHaveAttribute('data-block-type', 'image')

    // The click-to-order arrows are gone, replaced by a grip on every block.
    await expect(page.getByRole('button', { name: /move block/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /drag to reorder/i })).toHaveCount(2)

    // Keyboard: space picks the block up, arrow moves it, space drops it.
    // dnd-kit's live region is the sync point — it stays empty until a lift.
    const live = page.locator('[role="status"]')
    await blocks.nth(1).getByRole('button', { name: /drag to reorder/i }).focus()
    await page.keyboard.press('Space')
    await expect(live).toContainText(/moved over droppable area/i)
    // dnd-kit announces EVERY move, so the announcement changing is the real
    // sync point. This used to be a flat 250ms wait, which was plenty on an idle
    // machine and not enough with the rest of the suite running beside it: the
    // ArrowUp had not registered when Space dropped, so the block landed back
    // where it started and only the full-suite run ever saw it.
    const afterLift = (await live.textContent()) ?? ''
    await page.keyboard.press('ArrowUp')
    await expect
      .poll(async () => (await live.textContent()) ?? '', { timeout: 15_000 })
      .not.toBe(afterLift)

    await page.keyboard.press('Space')
    await expect(live).toContainText(/was dropped/i)
    await expect(blocks.nth(0)).toHaveAttribute('data-block-type', 'image', { timeout: 15_000 })
    await expect(blocks.nth(1)).toHaveAttribute('data-block-type', 'text', { timeout: 15_000 })
  })

  test('the preview no longer tells clients to hit reply', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/marketing/new')
    await expect(page.getByText('Live preview')).toBeVisible()
    await expect(page.getByText(/hit reply/i)).toHaveCount(0)
  })

  test('a broadcast detail that is not the trainer’s 404s (tenant scope)', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const res = await page.goto('/marketing/nonexistent-broadcast-id')
    expect(res?.status()).toBe(404)
  })
})

test.describe('bulk email — unsubscribe page', () => {
  test('an invalid unsubscribe token shows the not-valid state, not an error', async ({ page }) => {
    await page.goto('/unsubscribe/not-a-real-token')
    await expect(page.getByText(/link not valid/i)).toBeVisible()
  })
})
