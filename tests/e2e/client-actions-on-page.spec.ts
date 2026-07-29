import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// The client profile's "Actions" dropdown is gone. Every per-client action now
// renders as a row at the HEAD of the Overview tab (client-actions-panel.tsx),
// so nothing is hidden behind a trigger and nothing has to be scrolled to.
//
// What matters, and what this locks down:
//   · the header no longer carries an Actions button
//   · the block leads the tab — above "Upcoming sessions", not below everything
//   · all six actions are reachable, and their modals still open
//   · Delete is last, separated, and still confirms before deleting
//   · a read-only co-manager gets ONLY "View as client" — sharing, editing
//     and deleting must not appear for someone who can't perform them

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function openSeededClient(page: Page) {
  await page.goto(`/clients/${SEED.assignedClientId}`)
  // Overview is the default tab.
  await expect(page.getByRole('heading', { name: 'Upcoming sessions' })).toBeVisible({ timeout: 20_000 })
}

test.describe('client actions live on the page, not in a dropdown', () => {
  test('the header has no Actions button and every action is a row on Overview', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await openSeededClient(page)

    // Gone: the trigger and its menu.
    await expect(page.getByRole('button', { name: 'Actions', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Client actions' })).toHaveCount(0)
    await expect(page.getByRole('menu')).toHaveCount(0)

    // Present: all six, without opening anything.
    const panel = page.getByRole('region', { name: 'Client actions' }).first()
    await expect(panel.getByRole('link', { name: 'Edit details' })).toBeVisible()
    await expect(panel.getByRole('link', { name: 'View as client' })).toBeVisible()
    await expect(panel.getByRole('button', { name: /Re-invite client|Re-send sign-in link/ })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Assign 1:1 session' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Share with another trainer' })).toBeVisible()

    // Delete sits in its own block below the rest — last thing on the tab.
    await expect(page.getByRole('button', { name: 'Delete client' })).toBeVisible()

    // Edit still points at the edit screen.
    await expect(panel.getByRole('link', { name: 'Edit details' }))
      .toHaveAttribute('href', `/clients/${SEED.assignedClientId}/edit`)
  })

  // Karl: "move client actions to the top of the column please." They were at
  // the foot, which meant scrolling past everything to reach them.
  test('the actions lead the column, above the first content card', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await openSeededClient(page)

    const panel = page.getByRole('region', { name: 'Client actions' }).first()
    const heading = page.getByRole('heading', { name: 'Upcoming sessions' })
    const panelTop = (await panel.boundingBox())!.y
    const headingTop = (await heading.boundingBox())!.y
    expect(panelTop).toBeLessThan(headingTop)

    // …and it doesn't own the screen doing it. Two-up rather than six stacked
    // rows: the whole block (grid + the separate Delete row) stays well under
    // half a 844px-tall phone.
    const deleteBox = (await page.getByRole('button', { name: 'Delete client' }).boundingBox())!
    expect(deleteBox.y + deleteBox.height - panelTop).toBeLessThan(300)
  })

  test('the actions belong to Overview only', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await openSeededClient(page)
    await expect(page.getByRole('button', { name: 'Delete client' })).toBeVisible()

    // Switch to Details — the actions block doesn't follow it around.
    await page.getByRole('button', { name: 'Details' }).first().click()
    await expect(page.getByRole('heading', { name: 'Contact' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete client' })).toHaveCount(0)
  })

  test('delete still confirms first, and locks the page behind it', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await openSeededClient(page)

    await page.getByRole('button', { name: 'Delete client' }).click()
    const dialog = page.locator('div.fixed.inset-0.z-50')
      .filter({ hasText: `Delete ${SEED.client.name}?` })
    await expect(dialog.getByRole('heading', { name: `Delete ${SEED.client.name}?` })).toBeVisible()

    // Never two scrollbars — the page behind a confirm dialog must not scroll.
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: `Delete ${SEED.client.name}?` })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
    // Still there — cancelling deleted nothing.
    await expect(page.getByRole('button', { name: 'Delete client' })).toBeVisible()
  })

  test('re-invite names the recipient before sending', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await openSeededClient(page)

    await page.getByRole('button', { name: /Re-invite client|Re-send sign-in link/ }).click()
    // The confirm dialog surfaces the address so a typo is catchable. Scoped
    // to the overlay — the desktop summary sidebar also shows the email.
    const dialog = page.locator('div.fixed.inset-0.z-50').filter({ hasText: SEED.client.email })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', {
      name: new RegExp(`(Re-send invite to|Send a fresh sign-in link to) ${SEED.client.name}\\?`),
    })).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
  })

  test('share and assign modals still open from their rows', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await openSeededClient(page)

    await page.getByRole('button', { name: 'Share with another trainer' }).click()
    await expect(page.getByRole('heading', { name: `Share ${SEED.client.name}` })).toBeVisible()
    // Reload rather than asserting how that modal closes — this change didn't
    // touch its dismiss behaviour.
    await openSeededClient(page)

    await page.getByRole('button', { name: 'Assign 1:1 session' }).click()
    await expect(page.getByRole('heading', { name: 'Assign 1:1 session' })).toBeVisible()
  })
})

test.describe('read-only co-manager', () => {
  // A READ_ONLY share gives another business visibility of the client but no
  // edit rights (canEdit === false). They must see the preview link and
  // NOTHING else — no Edit, no Share, no Delete.
  test('sees View as client and nothing else', async ({ page }) => {
    const prisma = await makePrisma()
    let shareId: string | null = null
    try {
      const businessB = await prisma.trainerProfile.findFirst({
        where: { user: { email: SEED.businessB.ownerEmail } },
        select: { id: true },
      })
      const client = await prisma.clientProfile.findUnique({
        where: { id: SEED.assignedClientId },
        select: { trainerId: true },
      })
      expect(businessB).not.toBeNull()
      expect(client).not.toBeNull()
      const share = await prisma.clientShare.create({
        data: {
          clientId: SEED.assignedClientId,
          sharedById: client!.trainerId,
          sharedWithId: businessB!.id,
          shareType: 'READ_ONLY',
          acceptedAt: new Date(),
        },
        select: { id: true },
      })
      shareId = share.id

      await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
      await page.goto(`/clients/${SEED.assignedClientId}`)
      await expect(page.getByRole('heading', { name: 'Upcoming sessions' })).toBeVisible({ timeout: 20_000 })

      const panel = page.getByRole('region', { name: 'Client actions' }).first()
      await expect(panel.getByRole('link', { name: 'View as client' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Edit details' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Share with another trainer' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Delete client' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Re-invite client|Re-send sign-in link/ })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Assign 1:1 session' })).toHaveCount(0)
    } finally {
      // The seeded client is shared with every other spec — leave no trace.
      if (shareId) await prisma.clientShare.delete({ where: { id: shareId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })
})
