import { test, expect, type Page, type Browser } from '@playwright/test'
import { SEED } from './test-db'

/**
 * Pictures for the ways in — the round trip, and the save that must not eat one.
 *
 * The client's booking screen opens with rows that are ways in: the offering
 * categories and the trainer's tags. A trainer can now set a picture on each,
 * from Settings. What this spec exists to prove is not that the upload works —
 * that is /api/upload/image's job and it is covered elsewhere — but that the
 * value SURVIVES:
 *
 *   1. set it → reload → still there;
 *   2. set the NAME beside it → reload → the picture is STILL there.
 *
 * (2) is the exact bug this codebase has written twice (AGENTS.md: "a field the
 * user typed must survive a reload"). An offering's cover image was wiped by a
 * patch that simply omitted the key, twice, and each time it looked fine on
 * screen because the save returned 200.
 *
 * URLs rather than real file uploads on purpose: Vercel Blob is not reachable
 * from the test environment, and the thing under test is the column and the
 * render, not the transport. The URLs never load — Playwright asserts the
 * element and its src, which is what the client would receive.
 *
 * Everything created here is removed again at the end, because the suite shares
 * one seeded database.
 */

const COVER = 'https://images.e2e.test/pm-category-cover.jpg'
const TAG_PIC = 'https://images.e2e.test/pm-tag-cover.jpg'

test.describe.configure({ mode: 'serial' })

// Landing is asserted as "anywhere but /login": a trainer lands on /dashboard
// and a client on /home, and this spec drives both.
async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

/** A signed-in page in its own context, so two businesses can be driven at once. */
async function signedIn(browser: Browser, email: string, password: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await login(page, email, password)
  return { context, page }
}

test.describe('a picture on an offering category', () => {
  test('survives a reload, and survives a rename that never mentions it', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // ── set it ──────────────────────────────────────────────────────────────
    const set = await page.request.put('/api/trainer/nav-labels', {
      data: { images: { '/classes': COVER } },
    })
    expect(set.status()).toBe(200)

    // ── reload → still there ────────────────────────────────────────────────
    await page.goto('/settings?tab=naming')
    await expect(page.locator(`img[src="${COVER}"]`)).toBeVisible()

    // ── now save a NAME, and nothing else ───────────────────────────────────
    // This is the shape of the bug: a body that simply doesn't mention the
    // picture. The route must read that as "leave it alone", not "clear it".
    const renamed = await page.request.put('/api/trainer/nav-labels', {
      data: { labels: { '/classes': 'Courses' } },
    })
    expect(renamed.status()).toBe(200)

    // ── reload → the name changed AND the picture is still there ────────────
    await page.goto('/settings?tab=naming')
    await expect(page.getByLabel('Your word for Group Classes')).toHaveValue('Courses')
    await expect(page.locator(`img[src="${COVER}"]`)).toBeVisible()

    // ── clearing works, and is a different thing from not-sent ──────────────
    const cleared = await page.request.put('/api/trainer/nav-labels', { data: { images: {} } })
    expect(cleared.status()).toBe(200)
    await page.goto('/settings?tab=naming')
    await expect(page.locator(`img[src="${COVER}"]`)).toHaveCount(0)
    // The name it was saved beside is untouched by clearing the picture.
    await expect(page.getByLabel('Your word for Group Classes')).toHaveValue('Courses')

    // Put the trainer's own words back for the specs that follow.
    await page.request.put('/api/trainer/nav-labels', { data: { labels: {} } })
  })
})

test.describe('a picture on a tag', () => {
  test('survives a reload, and survives a rename that never mentions it', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // Named and given a face in one go — the create form carries both.
    const created = await page.request.post('/api/tags', {
      data: { name: `Pictured ${Date.now()}`, imageUrl: TAG_PIC },
    })
    expect(created.status()).toBe(201)
    const tag = await created.json() as { id: string; imageUrl: string | null }
    expect(tag.imageUrl).toBe(TAG_PIC)

    // ── reload → still there, as the row's thumbnail ────────────────────────
    await page.goto('/settings?tab=tags')
    await expect(page.locator(`img[src="${TAG_PIC}"]`)).toBeVisible()

    // ── rename only. The control on this screen has always sent { name } ────
    const renamed = await page.request.patch(`/api/tags/${tag.id}`, {
      data: { name: `Renamed ${Date.now()}` },
    })
    expect(renamed.status()).toBe(200)
    expect((await renamed.json()).imageUrl).toBe(TAG_PIC)

    await page.goto('/settings?tab=tags')
    await expect(page.locator(`img[src="${TAG_PIC}"]`)).toBeVisible()

    // ── an explicit null clears it, and only an explicit null ───────────────
    const cleared = await page.request.patch(`/api/tags/${tag.id}`, { data: { imageUrl: null } })
    expect(cleared.status()).toBe(200)
    await page.goto('/settings?tab=tags')
    await expect(page.locator(`img[src="${TAG_PIC}"]`)).toHaveCount(0)

    await page.request.delete(`/api/tags/${tag.id}`)
  })

  // The ownership guard: a trainer must not be able to put a picture on another
  // business's tag, and must not learn that it exists either — 404, not 403.
  test('cannot be set on another business’s tag', async ({ browser }) => {
    const rival = await signedIn(browser, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
    const mine = await signedIn(browser, SEED.owner.email, SEED.owner.password)
    try {
      const theirs = await rival.page.request.post('/api/tags', {
        data: { name: `Rival ${Date.now()}` },
      })
      expect(theirs.status()).toBe(201)
      const tagId = (await theirs.json()).id as string

      const breach = await mine.page.request.patch(`/api/tags/${tagId}`, {
        data: { imageUrl: COVER },
      })
      expect(breach.status()).toBe(404)

      // And it really is untouched, not merely refused at the door.
      const still = await rival.page.request.get('/api/tags')
      const row = ((await still.json()).tags as { id: string; imageUrl: string | null }[])
        .find(t => t.id === tagId)
      expect(row?.imageUrl ?? null).toBeNull()

      await rival.page.request.delete(`/api/tags/${tagId}`)
    } finally {
      await rival.context.close()
      await mine.context.close()
    }
  })
})

test.describe('what the client sees', () => {
  test('shows the trainer’s picture, and goes back to borrowing when it is cleared', async ({ browser }) => {
    const trainer = await signedIn(browser, SEED.owner.email, SEED.owner.password)
    const client = await signedIn(browser, SEED.client.email, SEED.client.password)
    try {
      // Nothing set: the row is drawn from whatever it can BORROW off the first
      // offering inside it. Which is to say the trainer's picture is not there.
      await client.page.goto('/my-availability')
      await expect(client.page.locator(`img[src="${COVER}"]`)).toHaveCount(0)

      await trainer.page.request.put('/api/trainer/nav-labels', {
        data: { images: { '/packages': COVER } },
      })

      // The booking screen is a server component, so this only appears if the
      // save invalidated its cached render as well as writing the column.
      await client.page.goto('/my-availability')
      await expect(client.page.locator(`img[src="${COVER}"]`)).toBeVisible()

      // Cleared → the override is gone and the row borrows again. The fallback
      // was overridden, never deleted.
      await trainer.page.request.put('/api/trainer/nav-labels', { data: { images: {} } })
      await client.page.goto('/my-availability')
      await expect(client.page.locator(`img[src="${COVER}"]`)).toHaveCount(0)
      // The way in is still a way in — clearing a picture must not remove a row.
      await expect(client.page.getByText('What would you like to book?')).toBeVisible()
    } finally {
      await trainer.context.close()
      await client.context.close()
    }
  })
})
