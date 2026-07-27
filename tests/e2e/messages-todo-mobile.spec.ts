import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Three phone reports, all on screens a trainer lives in:
//
//   1. a band of dead space between the message composer and the bottom tab
//      bar (the page reserved 5rem for a 58px bar, and another 69px for a
//      PageHeader that renders nothing on the trainer phone);
//   2. /messages told you nothing about a thread — no unread indicator you
//      could scan for, and no sign of whether what you sent had been read;
//   3. /sessions/needs-notes stacked three unrelated lists (sessions, to-dos,
//      brain dump) one under another instead of giving each a tab.
//
// Geometry is measured against the real rendered page, so it fails again if
// the offsets drift.

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

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

// Seeds a thread on Business A's assigned client:
//   • one message FROM the client, unread  → the list's unread indicator
//   • one message FROM the trainer, read   → "Read"
//   • one message FROM the trainer, unread → "Sent"
// Returns a cleanup that removes exactly what it made.
async function seedThread(bodyTag: string, clientId: string) {
  const prisma = await makePrisma()
  const client = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: { id: true, userId: true, trainer: { select: { userId: true } } },
  })
  if (!client) throw new Error('seed client missing')
  const trainerUserId = client.trainer.userId
  const base = Date.now()
  const rows = [
    { body: `${bodyTag} read-by-client`, senderId: trainerUserId, readAt: new Date(), createdAt: new Date(base - 3000) },
    { body: `${bodyTag} not-read-yet`, senderId: trainerUserId, readAt: null, createdAt: new Date(base - 2000) },
    { body: `${bodyTag} from-the-client`, senderId: client.userId, readAt: null, createdAt: new Date(base - 1000) },
  ]
  const made: string[] = []
  for (const r of rows) {
    const m = await prisma.message.create({
      data: { clientId: client.id, channel: 'TRAINER_CLIENT', ...r },
      select: { id: true },
    })
    made.push(m.id)
  }
  return {
    clientId: client.id,
    async cleanup() {
      await prisma.message.deleteMany({ where: { id: { in: made } } }).catch(() => {})
      await prisma.$disconnect().catch(() => {})
    },
    prisma,
  }
}

test.describe('the message composer sits on the tab bar, not above a gap', () => {
  test.use({ viewport: PHONE })

  test('at 390px there is no dead band between the composer and the tabs', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/messages?client=${SEED.assignedClientId}`)
    await expect(page.getByPlaceholder('Type a message…')).toBeVisible({ timeout: 20_000 })

    const geometry = await page.evaluate(() => {
      // An open thread is IMMERSIVE — the shell hides the bottom tab bar,
      // because the composer already owns the bottom of the phone and five
      // tabs beneath it just read as clutter. So the thing the composer has to
      // meet is the viewport, not a tab bar. (This assertion used to measure
      // against the tab bar; that predates the immersive thread, and measuring
      // against a bar that is deliberately absent is what made it fail.)
      const fixedNavs = [...document.querySelectorAll('nav')]
        .filter(n => getComputedStyle(n).position === 'fixed')
      const composer = document.querySelector('input[placeholder="Type a message…"]')!.closest('div')!
      return {
        tabBarCount: fixedNavs.filter(n => n.className.includes('bottom-0')).length,
        composerBottom: Math.round(composer.getBoundingClientRect().bottom),
        viewportBottom: Math.round(window.innerHeight),
        // The panes scroll internally — the PAGE must never scroll, or the
        // gap comes back as a scrollbar instead.
        pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
      }
    })
    expect(geometry.tabBarCount, 'an open thread hides the tab bar').toBe(0)
    expect(
      Math.abs(geometry.composerBottom - geometry.viewportBottom),
      'the composer must reach the bottom of the screen — no dead band',
    ).toBeLessThanOrEqual(1)
    expect(geometry.pageOverflow, 'the page itself must not scroll').toBeLessThanOrEqual(0)
  })

  test('the thread list still scrolls inside its own pane', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/messages')
    await expect(page.getByRole('link', { name: /Active/ })).toBeVisible({ timeout: 20_000 })
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    expect(pageOverflow, 'never two scrollbars').toBeLessThanOrEqual(0)
  })
})

test.describe('/messages shows unread threads and whether a message was read', () => {
  test.use({ viewport: PHONE })

  test('an unread thread is badged, and our own messages say Sent or Read', async ({ page }) => {
    const tag = `E2E-THREAD-${Date.now()}`
    const seeded = await seedThread(tag, SEED.assignedClientId)
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/messages')

      // The row for this client carries the unread badge — the client's
      // message is the one nobody on our side has opened.
      const row = page.locator('a[href*="client="]').filter({ hasText: tag }).first()
      await expect(row).toBeVisible({ timeout: 20_000 })
      await expect(row.getByTestId('thread-unread')).toBeVisible()
      await expect(row.getByTestId('thread-unread')).toHaveText(/^[1-9]/)

      // Opening the thread clears it and shows the per-message status. The
      // page marks incoming messages read server-side on load.
      await row.click()
      await expect(page.getByText(`${tag} from-the-client`)).toBeVisible({ timeout: 20_000 })

      // Asserted per message, not by counting the thread — other specs share
      // this seeded client and write their own messages into it.
      const bubble = (text: string) => page.getByTestId('message-bubble').filter({ hasText: text })
      await expect(bubble(`${tag} read-by-client`).getByTestId('message-tick')).toHaveText('Read')
      await expect(bubble(`${tag} not-read-yet`).getByTestId('message-tick')).toHaveText('Sent')
      // Nothing claims a status for the CLIENT's message — readAt on an
      // incoming message only means WE opened the thread, which is not news.
      await expect(bubble(`${tag} from-the-client`).getByTestId('message-tick')).toHaveCount(0)

      // Back on the list the badge is gone, and the last word being the
      // client's means no delivery tick on that row either.
      await page.goto('/messages')
      const cleared = page.locator('a[href*="client="]').filter({ hasText: tag }).first()
      await expect(cleared).toBeVisible({ timeout: 20_000 })
      await expect(cleared.getByTestId('thread-unread')).toHaveCount(0)
      await expect(cleared.getByTestId('delivery-tick')).toHaveCount(0)
    } finally {
      await seeded.cleanup()
    }
  })

  test('a row whose last word was ours carries the delivery tick', async ({ page }) => {
    const tag = `E2E-OUTGOING-${Date.now()}`
    const prisma = await makePrisma()
    let id: string | null = null
    try {
      // A different client from the test above — specs in this file run in
      // parallel, and both assert on the same list.
      const client = await prisma.clientProfile.findUnique({
        where: { id: SEED.unassignedClientId },
        select: { id: true, trainer: { select: { userId: true } } },
      })
      const made = await prisma.message.create({
        data: {
          clientId: client!.id,
          channel: 'TRAINER_CLIENT',
          senderId: client!.trainer.userId,
          body: `${tag} latest`,
          readAt: new Date(),
        },
        select: { id: true },
      })
      id = made.id

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/messages')
      const row = page.locator('a[href*="client="]').filter({ hasText: tag }).first()
      await expect(row).toBeVisible({ timeout: 20_000 })
      const tick = row.getByTestId('delivery-tick')
      await expect(tick).toHaveCount(1)
      await expect(tick).toHaveAttribute('data-read', 'true')
    } finally {
      if (id) await prisma.message.deleteMany({ where: { id } }).catch(() => {})
      await prisma.$disconnect().catch(() => {})
    }
  })

  test('another trainer never sees this thread', async ({ page }) => {
    const tag = `E2E-TENANT-${Date.now()}`
    const seeded = await seedThread(tag, SEED.unassignedClientId)
    try {
      await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
      await page.goto('/messages')
      await expect(page.getByText(tag)).toHaveCount(0)
      // …and the thread can't be reached by guessing the client id either.
      await page.goto(`/messages?client=${seeded.clientId}`)
      await expect(page.getByText(tag)).toHaveCount(0)
    } finally {
      await seeded.cleanup()
    }
  })
})

test.describe('the To do screen is three tabs, not three stacked lists', () => {
  test('at 390px Notes, To do and Brain dump each get a tab', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/sessions/needs-notes')

    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveCount(3, { timeout: 20_000 })
    await expect(tabs.nth(0)).toContainText('Notes')
    await expect(tabs.nth(1)).toContainText('To do')
    await expect(tabs.nth(2)).toContainText('Brain dump')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')

    // Only one panel's content is on screen at a time — the to-do composer and
    // the scratchpad used to sit above the sessions on the same scroll.
    await expect(page.getByPlaceholder('Add a to-do…')).toBeHidden()
    await expect(page.getByPlaceholder(/^Brain dump/)).toBeHidden()

    await tabs.nth(1).click()
    await expect(page.getByPlaceholder('Add a to-do…')).toBeVisible()
    await expect(page.getByPlaceholder(/^Brain dump/)).toBeHidden()

    await tabs.nth(2).click()
    await expect(page.getByPlaceholder(/^Brain dump/)).toBeVisible()
    await expect(page.getByPlaceholder('Add a to-do…')).toBeHidden()

    // The tab is in the URL, so a refresh (or coming back from a session)
    // lands where the trainer left off.
    expect(page.url()).toContain('tab=braindump')
    await page.reload()
    await expect(page.getByPlaceholder(/^Brain dump/)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('tab', { name: /Brain dump/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('at 1440px the same three tabs are there', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/sessions/needs-notes')
    await expect(page.getByRole('tab')).toHaveCount(3, { timeout: 20_000 })
    await expect(page.getByRole('tab', { name: /Notes/ })).toHaveAttribute('aria-selected', 'true')
  })
})
