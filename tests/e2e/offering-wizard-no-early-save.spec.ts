import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

/**
 * /offerings/new — the wizard must not save until the trainer says so.
 *
 * Regression for: "when i go to the last step it saves and exits". Stepping
 * onto the FINAL step fired POST /api/packages and bounced the trainer to
 * /packages, so the last step (and any review of it) was never seen.
 *
 * Cause: the footer's primary action is ONE element that swaps from
 * `type="button"` (Next) to `type="submit"` (Create offering) when the last
 * step is reached. React flushes that state change synchronously inside the
 * click dispatch, and per the HTML spec a button's activation behaviour is run
 * AFTER dispatch using the element's state at that moment — so the browser saw
 * a submit button and submitted the form. `event.submitter` was the node that
 * had been "Next".
 *
 * The contract this locks in is behavioural, not cosmetic: walking to the last
 * step creates NOTHING, and only the explicit save action does.
 */

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

/** Every POST/PATCH the page fires at the packages API, in order. */
function recordPackageWrites(page: Page) {
  const writes: string[] = []
  page.on('request', r => {
    if (r.method() === 'GET') return
    if (/\/api\/packages(\/|\?|$)/.test(new URL(r.url()).pathname + '?')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`)
  })
  return writes
}

// A phone-width and a desktop-width pass: the footer is a fixed bar below md
// and an inline row above it, so the two render different chrome around the
// same button.
const VIEWPORTS = [
  { label: 'phone 390px', width: 390, height: 844 },
  { label: 'desktop 1440px', width: 1440, height: 900 },
] as const

test.describe('offering wizard — no save until asked', () => {
  for (const vp of VIEWPORTS) {
    test(`walks to the last step without creating anything (${vp.label})`, async ({ page }) => {
      const prisma = await makePrisma()
      const name = `E2E Wizard Probe ${vp.width} ${Date.now()}`
      try {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        const writes = recordPackageWrites(page)

        await login(page, SEED.owner.email, SEED.owner.password)
        await page.goto('/offerings/new?kind=onetoone')
        await expect(page.getByText('What are you setting up?')).toBeVisible()

        await page.getByLabel('Name').fill(name)

        // Step forward until the wizard runs out of Next buttons. After EVERY
        // click we must still be on the wizard with nothing written.
        const next = page.getByRole('button', { name: 'Next', exact: true })
        let steps = 0
        while (await next.count()) {
          await next.click()
          steps++
          await page.waitForTimeout(250)
          expect(page.url(), `left the wizard after Next #${steps}`).toContain('/offerings/new')
          expect(writes, `saved on Next #${steps} — the trainer never got to review`).toEqual([])
          expect(steps, 'wizard did not advance').toBeLessThan(10)
        }

        // We are on the final step: the explicit save action is offered, and
        // the trainer is still here to see it.
        expect(steps, 'expected the 1:1 wizard to have more than one step').toBeGreaterThan(0)
        await expect(page.getByRole('button', { name: 'Create offering' })).toBeVisible()
        expect(page.url()).toContain('/offerings/new')
        expect(writes, 'reaching the last step must not save').toEqual([])

        // Nothing exists yet, as far as the database is concerned.
        expect(
          await prisma.package.count({ where: { name } }),
          'the wizard created a package before the trainer saved',
        ).toBe(0)

        // Now save on purpose — that, and only that, creates it.
        await page.getByRole('button', { name: 'Create offering' }).click()
        await page.waitForURL('**/packages**', { timeout: 30_000 })
        expect(writes).toEqual(['POST /api/packages'])

        const saved = await prisma.package.findFirst({ where: { name }, select: { id: true, isGroup: true } })
        expect(saved, 'saving from the last step must create the offering').toBeTruthy()
        expect(saved!.isGroup).toBe(false)
      } finally {
        await prisma.package.deleteMany({ where: { name } }).catch(() => {})
        await prisma.$disconnect()
      }
    })
  }

  // A casual class drops the pricing step, so the last-step transition happens
  // one click earlier — the same footer swap, a different step index.
  test('casual class (one step fewer) also holds the save', async ({ page }) => {
    const prisma = await makePrisma()
    const name = `E2E Wizard Dropin ${Date.now()}`
    try {
      const writes = recordPackageWrites(page)
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/offerings/new?kind=dropin')
      await expect(page.getByText('What are you setting up?')).toBeVisible()
      await page.getByLabel('Name').fill(name)

      // A casual class is saved from writing junk only by its own slot-times
      // check — so the tell that it submitted is that red sentence appearing
      // unbidden, not a POST. Assert on both.
      const slotError = page.getByText('Give every session a start and finish time.')
      const next = page.getByRole('button', { name: 'Next', exact: true })
      while (await next.count()) {
        await next.click()
        await page.waitForTimeout(250)
        expect(page.url()).toContain('/offerings/new')
        expect(writes, 'a casual class saved itself on the way to the last step').toEqual([])
        expect(await slotError.count(), 'the form submitted on a step change — it rejected itself').toBe(0)
      }

      await expect(page.getByRole('button', { name: 'Create offering' })).toBeVisible()
      expect(await prisma.package.count({ where: { name } })).toBe(0)
    } finally {
      await prisma.package.deleteMany({ where: { name } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  // Guard: the create page is trainer-only.
  test('signed-out visitors are sent to login, not the wizard', async ({ page, context }) => {
    await context.clearCookies()
    await page.goto('/offerings/new?kind=onetoone')
    await page.waitForURL(/\/login/, { timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })
})
