import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// The client profile, after Karl's review on 2026-08-06.
//
// What changed, and therefore what this locks down:
//   · the nine bare section labels became TILES that carry a fact each, and a
//     zero reads as words rather than "0"
//   · each tile is a LINK to its own page — as tabs, tapping one swapped
//     content below the fold and nothing appeared to happen on a phone
//   · the five client actions collapsed to one visible Assign button and a ⋯
//   · destructive actions still confirm
//   · the phone's bottom tab bar stands down on the profile AND on every
//     section page, while the top bar (back + title) survives
//   · a section page carries NO hero — back, a title, and whose record it is
//   · the old ?tab= deep links still land somewhere sensible
//   · permission-gated sections 404 rather than relying on a tab not being drawn

const PHONE = { width: 394, height: 800 }

const SECTIONS = [
  ['sessions', 'Sessions'],
  ['training', 'Training log'],
  ['dogs', 'Dogs'],
  ['products', 'Products'],
  ['communication', 'Comms'],
  ['notes', 'Notes'],
  ['invoices', 'Invoices'],
  ['achievements', 'Achievements'],
  ['details', 'Details'],
] as const

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

// Scoped to <main>: the trainer shell's left nav carries its own "Products" and
// "Achievements" links, and an unscoped getByRole('link') picks THOSE up first —
// clicking the Products tile navigated to the shop, not to the client's page.
function tile(page: Page, label: string) {
  return page.getByRole('main').getByRole('link', { name: new RegExp(`^${label}`) }).first()
}

// "Add product" is gated on the trainer HAVING a shop to pick from
// (client-products-section.tsx: `if (!canEdit || !hasProducts) return body`), and
// global-setup seeds no Product rows. One throwaway product, removed again, so
// no other spec's counts move.
const SHOP_PRODUCT_ID = 'e2etilesshopprod00000000'

test.beforeAll(async () => {
  const prisma = await makePrisma()
  try {
    const trainer = await prisma.trainerProfile.findFirst({
      where: { user: { email: SEED.owner.email } }, select: { id: true },
    })
    await prisma.product.upsert({
      where: { id: SHOP_PRODUCT_ID },
      update: {},
      create: {
        id: SHOP_PRODUCT_ID, trainerId: trainer!.id,
        name: 'E2E Long Line', kind: 'PHYSICAL', priceCents: 4500, active: true,
      },
    })
  } finally {
    await prisma.$disconnect()
  }
})

test.afterAll(async () => {
  const prisma = await makePrisma()
  try {
    await prisma.productRequest.deleteMany({ where: { productId: SHOP_PRODUCT_ID } })
    await prisma.product.deleteMany({ where: { id: SHOP_PRODUCT_ID } })
  } finally {
    await prisma.$disconnect()
  }
})

test.describe('the profile summarises the client', () => {
  test('every tile carries a line, and a zero reads as words', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}`)

    // The one that must never be a bare "0" — a client with nothing on file is
    // the commonest state there is.
    await expect(tile(page, 'Sessions')).toBeVisible({ timeout: 20_000 })
    for (const [, label] of SECTIONS) {
      // Achievements/Invoices are add-on/permission gated; the ones that always
      // render are asserted individually below.
      void label
    }
    // Each of these has a second line, and none of them is the digit 0 alone.
    for (const label of ['Sessions', 'Training log', 'Notes', 'Products', 'Details']) {
      const text = (await tile(page, label).innerText()).split('\n')
      expect(text.length, `${label} tile has a second line`).toBeGreaterThan(1)
      expect(text[1].trim()).not.toBe('0')
      expect(text[1].trim().length).toBeGreaterThan(0)
    }
    await expect(tile(page, 'Sessions')).toContainText(/No sessions yet|Last |[A-Z][a-z]{2} \d/)
    await expect(tile(page, 'Training log')).toContainText(/No practice logged|entr/)
    // \s* not \n: toContainText matches against textContent, which has no line
    // break between the tile's two <p>s ("DetailsSince 7 Aug 2026"). That the
    // second line EXISTS is already proved above, off innerText, which does see
    // the break — this assertion is only about what that line says.
    await expect(tile(page, 'Details')).toContainText(/^Details\s*Since /)
    await expect(tile(page, 'Products')).toContainText(/Nothing to bring|to bring/)
  })

  test('a tile opens its own page — not a swap below the fold', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}`)
    await expect(tile(page, 'Notes')).toBeVisible({ timeout: 20_000 })

    await tile(page, 'Notes').click()
    await page.waitForURL(`**/clients/${SEED.assignedClientId}/notes`)
    // Whose notes these are is INSIDE the header, not a strip under it.
    const header = page.locator('header:visible').first()
    await expect(header).toContainText('Notes')
    await expect(header).toContainText(SEED.client.name)
    // And no hero: a section page opens straight into its content.
    await expect(page.locator('section.bg-accent-soft')).toHaveCount(0)
  })

  test('every section has a page of its own, and rubbish 404s', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    for (const [slug, title] of SECTIONS) {
      const res = await page.goto(`/clients/${SEED.assignedClientId}/${slug}`)
      expect(res?.status(), `${slug} responded`).toBe(200)
      await expect(page.locator('header:visible h1').first()).toHaveText(title)
      // One band, one hairline — the client line lives inside it.
      await expect(page.locator('header:visible')).toHaveCount(1)
    }
    const bogus = await page.goto(`/clients/${SEED.assignedClientId}/not-a-section`)
    expect(bogus?.status()).toBe(404)
  })

  test('the old ?tab= links land on the pages that replaced them', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}?tab=sessions`)
    await page.waitForURL(`**/clients/${SEED.assignedClientId}/sessions`)
    await page.goto(`/clients/${SEED.assignedClientId}?tab=details`)
    await page.waitForURL(`**/clients/${SEED.assignedClientId}/details`)
    // A session deep link keeps its id through the redirect — it opens a modal
    // on the far side, and losing it would open the wrong thing.
    await page.goto(`/clients/${SEED.assignedClientId}?sessionId=abc123`)
    await page.waitForURL(/\/sessions\?sessionId=abc123$/)
  })
})

test.describe('the phone chrome', () => {
  test.use({ viewport: PHONE })

  test('the bottom tab bar stands down; the top bar survives', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // It IS there on a normal screen — otherwise this test proves nothing.
    await page.goto('/clients')
    await expect(page.locator('nav.fixed.bottom-0')).toBeVisible()

    await page.goto(`/clients/${SEED.assignedClientId}`)
    await expect(tile(page, 'Sessions')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('nav.fixed.bottom-0')).toHaveCount(0)
    // …but the way out is still there: exactly one header, carrying the name.
    const headers = page.locator('header:visible')
    await expect(headers).toHaveCount(1)
    await expect(headers.first()).toContainText(SEED.client.name)
    // And the page still scrolls — the shell's reserved 5rem for the missing
    // bar is released rather than left as a band of nothing.
    const pad = await page.evaluate(() => {
      const m = document.querySelector('.pm-main')
      return m ? getComputedStyle(m).paddingBottom : null
    })
    expect(pad).toBe('0px')

    // Same on a section page, with the section's own title in the bar.
    await page.goto(`/clients/${SEED.assignedClientId}/notes`)
    await expect(page.locator('nav.fixed.bottom-0')).toHaveCount(0)
    await expect(page.locator('header:visible')).toHaveCount(1)
    await expect(page.locator('header:visible').first()).toContainText('Notes')
  })

  test('the hero is full-bleed and introduces nothing sideways', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}`)
    await expect(tile(page, 'Sessions')).toBeVisible({ timeout: 20_000 })

    const box = await page.locator('section.bg-accent-soft').first().boundingBox()
    expect(box!.x).toBe(0)
    expect(Math.round(box!.width)).toBe(PHONE.width)
    // A negative margin that overshoots gives the whole page a sideways slide.
    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }))
    expect(scrollW).toBe(clientW)
  })

  test('the whole summary is readable without scrolling', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}`)
    await expect(tile(page, 'Details')).toBeVisible({ timeout: 20_000 })
    // The point of the tiles is that the screen answers "how is this client
    // doing?" at a glance. A hero that pushed them below the fold would trade
    // one problem for another.
    const last = await tile(page, 'Details').boundingBox()
    expect(last!.y + last!.height).toBeLessThan(PHONE.height)
  })
})

test.describe('the profile is hero + tiles + the action, and nothing else', () => {
  // Karl: "i dont think we should show this - these things should be on the
  // pages". Upcoming sessions, unpaid invoices, the last session, recent
  // communication and bring-to-next-session were each a smaller copy of a page
  // one tap away.
  test('no content cards below the tiles', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}`)
    await expect(tile(page, 'Sessions')).toBeVisible({ timeout: 20_000 })

    for (const heading of ['Upcoming sessions', 'Unpaid invoices', 'Latest session', 'Recent communication', 'Bring to next session']) {
      await expect(page.getByRole('heading', { name: heading })).toHaveCount(0)
    }
  })

  // The one that must not vanish with the card it lived on: "Add product" was
  // the only way to set something aside for a specific client.
  test('Add product survived the card, on the Products page', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}`)
    await tile(page, 'Products').click()
    await page.waitForURL(`**/clients/${SEED.assignedClientId}/products`)
    await expect(page.getByRole('heading', { name: 'Bring to next session' })).toBeVisible()
    // It is a LINK to a screen of its own now, not a sheet (Karl, 2026-08-06:
    // "should be a page") — /clients/<id>/products/add.
    const add = page.getByRole('link', { name: 'Add product' })
    await expect(add).toBeVisible()
    await add.click()
    await page.waitForURL(`**/clients/${SEED.assignedClientId}/products/add`)
    await expect(page.locator('header:visible h1').first()).toHaveText('Add product')
  })
})

test.describe('every section page carries its own action', () => {
  for (const [slug, label] of [
    ['sessions', 'Assign 1:1 session'],
    ['products', 'Add product'],
    ['communication', 'Send a message'],
    ['invoices', 'New invoice'],
    ['dogs', 'Add a dog'],
    ['details', 'Edit details'],
  ] as const) {
    test(`${slug} → ${label}`, async ({ page }) => {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/clients/${SEED.assignedClientId}/${slug}`)
      await expect(page.getByRole('button', { name: label }).or(page.getByRole('link', { name: label })).first())
        .toBeVisible({ timeout: 20_000 })
    })
  }

  test('Comms splits messaging from emails', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}/communication`)
    await expect(page.getByRole('tab', { name: /Messaging/ }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('tab', { name: /Emails/ }).first()).toBeVisible()
  })
})

test.describe('client actions', () => {
  test('Assign stays out; everything occasional is behind the ⋯', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}`)

    const panel = page.getByRole('region', { name: 'Client actions' }).first()
    await expect(panel).toBeVisible({ timeout: 20_000 })
    // The one a trainer comes here to do is a button, not a menu item — and the
    // global "+" is hidden while this screen is open, so burying it would leave
    // the phone with no route to book the client whose record is open.
    await expect(panel.getByRole('button', { name: 'Assign 1:1 session' })).toBeVisible()
    // Nothing else is on the screen…
    await expect(page.getByRole('link', { name: 'Edit details' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete client' })).toHaveCount(0)

    // …until the ⋯ opens, and then all four are there.
    await panel.getByRole('button', { name: new RegExp(`More actions for ${SEED.client.name}`) }).click()
    const sheet = page.getByRole('dialog', { name: SEED.client.name })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Edit details' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'View as client' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: /Re-invite client|Re-send sign-in link/ })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Share with another trainer' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Delete client' })).toBeVisible()
    // Never two scrollbars while a sheet is up.
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  })

  test('delete confirms first, and cancelling deletes nothing', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}`)
    const panel = page.getByRole('region', { name: 'Client actions' }).first()
    await expect(panel).toBeVisible({ timeout: 20_000 })

    await panel.getByRole('button', { name: /More actions/ }).click()
    await page.getByRole('button', { name: 'Delete client' }).click()

    const confirm = page.getByRole('alertdialog', { name: `Delete ${SEED.client.name}?` })
    await expect(confirm).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')

    await confirm.getByRole('button', { name: 'Keep it' }).click()
    await expect(confirm).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
    // Still here — cancelling deleted nothing.
    await page.reload()
    await expect(page.getByRole('region', { name: 'Client actions' }).first()).toBeVisible()
  })

  test('re-invite names the recipient before a real email leaves', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto(`/clients/${SEED.assignedClientId}`)
    const panel = page.getByRole('region', { name: 'Client actions' }).first()
    await expect(panel).toBeVisible({ timeout: 20_000 })

    await panel.getByRole('button', { name: /More actions/ }).click()
    await page.getByRole('button', { name: /Re-invite client|Re-send sign-in link/ }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText(SEED.client.email)
    await confirm.getByRole('button', { name: 'Keep it' }).click()
    await expect(confirm).toHaveCount(0)
  })
})

test.describe('permissions travel with the routes', () => {
  // A tab that isn't drawn is not a guard. The moment a section has a URL,
  // anyone who can reach the client can type it — so every gate is server-side.
  test('a read-only co-manager gets View as client and nothing else', async ({ page }) => {
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
      const panel = page.getByRole('region', { name: 'Client actions' }).first()
      await expect(panel).toBeVisible({ timeout: 20_000 })

      // No Assign — they can't schedule for someone else's client.
      await expect(panel.getByRole('button', { name: 'Assign 1:1 session' })).toHaveCount(0)
      await panel.getByRole('button', { name: /More actions/ }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet.getByRole('button', { name: 'View as client' })).toBeVisible()
      await expect(sheet.getByRole('button', { name: 'Edit details' })).toHaveCount(0)
      await expect(sheet.getByRole('button', { name: 'Share with another trainer' })).toHaveCount(0)
      await expect(sheet.getByRole('button', { name: 'Delete client' })).toHaveCount(0)
    } finally {
      // The seeded client is shared with every other spec — leave no trace.
      if (shareId) await prisma.clientShare.delete({ where: { id: shareId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('a trainer from another business cannot reach any section by URL', async ({ page }) => {
    await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
    for (const [slug] of SECTIONS) {
      const res = await page.goto(`/clients/${SEED.assignedClientId}/${slug}`)
      expect(res?.status(), `${slug} is not reachable cross-tenant`).toBe(404)
    }
  })
})
