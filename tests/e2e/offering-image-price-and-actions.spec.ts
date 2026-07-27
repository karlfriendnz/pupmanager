import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

/**
 * The offering screens, end to end — the four things Karl reported plus the
 * three layout moves that came with them.
 *
 *  - The cover image on an offering you EDIT. It uploaded fine and then went
 *    nowhere: the form seeded the field from the class run rather than the
 *    offering, never sent the key for a 1:1 offering, and the API read the
 *    missing key as "clear it". Three bugs, one symptom, so the check that
 *    matters is the round trip: set it, save, come back, it's still there.
 *  - The location you picked came back as "Choose location…" every time, which
 *    also meant the picture attached to that location could never be shown.
 *  - A special price above the price is an overcharge wearing a discount's
 *    clothes. Refused in the form AND at the API.
 *  - "Send a follow-up reminder for session notes" is meaningless on a one-off
 *    event; it must not be offered there, and must still be offered on a class.
 *  - Edit/Delete belong on the page, not in the header chrome; the Current/Past
 *    tabs sit right; Discounts is hidden for now.
 */

const PHONE = { width: 390, height: 844 }

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

/** A 1:1 offering of our own to poke at, so no other spec's counts move. */
async function makeOffering(prisma: any, extra: Record<string, unknown> = {}) {
  const trainer = (await prisma.trainerProfile.findFirst({ where: { businessName: SEED.owner.businessName } }))!
  return prisma.package.create({
    data: {
      trainerId: trainer.id,
      name: `E2E Offering ${Date.now()}-${Math.round(Math.random() * 1e5)}`,
      sessionCount: 3,
      weeksBetween: 1,
      durationMins: 45,
      priceCents: 20000,
      isGroup: false,
      ...extra,
    },
  })
}

const IMAGE = 'https://blob.example.com/trainer-images/e2e/cover.jpg'

test.describe('offering — the cover image round-trips', () => {
  test('an image saved on a 1:1 offering is still there next time you edit it', async ({ page }) => {
    const prisma = await makePrisma()
    const pkg = await makeOffering(prisma, { imageUrl: IMAGE })
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/packages/${pkg.id}/edit`)

      // It was seeded from the class run before, so a 1:1 offering's image was
      // simply never on screen.
      await expect(page.locator(`img[src="${IMAGE}"]`)).toBeVisible()

      // …and saving from here used to send no imageUrl at all, which the API
      // read as "clear it".
      await page.getByRole('button', { name: 'Save changes' }).click()
      await page.waitForURL(u => !u.pathname.endsWith('/edit'), { timeout: 30_000 })

      const after = (await prisma.package.findUnique({ where: { id: pkg.id } }))!
      expect(after.imageUrl).toBe(IMAGE)
    } finally {
      await prisma.package.deleteMany({ where: { id: pkg.id } })
      await prisma.$disconnect()
    }
  })

  test('removing the image still clears it', async ({ page }) => {
    const prisma = await makePrisma()
    const pkg = await makeOffering(prisma, { imageUrl: IMAGE })
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/packages/${pkg.id}/edit`)
      await page.getByRole('button', { name: 'Remove image' }).click()
      await page.getByRole('button', { name: 'Save changes' }).click()
      await page.waitForURL(u => !u.pathname.endsWith('/edit'), { timeout: 30_000 })

      const after = (await prisma.package.findUnique({ where: { id: pkg.id } }))!
      expect(after.imageUrl).toBeNull()
    } finally {
      await prisma.package.deleteMany({ where: { id: pkg.id } })
      await prisma.$disconnect()
    }
  })
})

test.describe('offering — the location, and its picture', () => {
  test('the picker remembers the saved location and shows its image', async ({ page }) => {
    const prisma = await makePrisma()
    const trainer = (await prisma.trainerProfile.findFirst({ where: { businessName: SEED.owner.businessName } }))!
    const loc = await prisma.location.create({
      data: {
        trainerId: trainer.id,
        name: `E2E Park ${Date.now()}`,
        address: `12 E2E Road, Testville ${Date.now()}`,
        imageUrl: 'https://blob.example.com/trainer-images/e2e/park.jpg',
      },
    })
    // A class offering — the Location field is class/event only. It also needs
    // to be SCHEDULED: the venue is stored on the class run, so an offering
    // that isn't in the diary yet has nowhere to keep one.
    const pkg = await makeOffering(prisma, { isGroup: true, sessionCount: 4 })
    const run = await prisma.classRun.create({
      data: { trainerId: trainer.id, packageId: pkg.id, name: pkg.name, startDate: new Date(Date.now() + 7 * 864e5) },
    })
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/packages/${pkg.id}/edit`)

      const picker = page.locator('select').filter({ hasText: 'Choose location' }).first()
      await picker.selectOption({ label: loc.name })

      // The picture you gave the location, where it's of some use.
      await expect(page.locator(`img[src="${loc.imageUrl}"]`)).toBeVisible()

      await page.getByRole('button', { name: 'Save changes' }).click()
      await page.waitForURL(u => !u.pathname.endsWith('/edit'), { timeout: 30_000 })

      // Coming back, the choice is still made — it used to reset to
      // "Choose location…" however many times you set it.
      await page.goto(`/packages/${pkg.id}/edit`)
      await expect(page.locator('select').filter({ hasText: 'Choose location' }).first())
        .toHaveValue(loc.id)
      await expect(page.locator(`img[src="${loc.imageUrl}"]`)).toBeVisible()
    } finally {
      await prisma.classRun.deleteMany({ where: { id: run.id } })
      await prisma.package.deleteMany({ where: { id: pkg.id } })
      await prisma.location.deleteMany({ where: { id: loc.id } })
      await prisma.$disconnect()
    }
  })
})

test.describe('offering — a special price is a discount', () => {
  test('the form refuses a special price above the price, and says why', async ({ page }) => {
    const prisma = await makePrisma()
    const pkg = await makeOffering(prisma)
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/packages/${pkg.id}/edit`)

      await page.getByLabel('Price', { exact: true }).fill('100')
      await page.getByLabel('Special price (optional)').fill('250')
      await page.getByRole('button', { name: 'Save changes' }).click()

      await expect(page.getByText(/discount, not a surcharge/i).first()).toBeVisible()
      // Still on the form — the save was refused, not merely complained about.
      expect(new URL(page.url()).pathname).toContain('/edit')
      const after = (await prisma.package.findUnique({ where: { id: pkg.id } }))!
      expect(after.specialPriceCents).toBeNull()

      // A real discount goes through.
      await page.getByLabel('Special price (optional)').fill('80')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await page.waitForURL(u => !u.pathname.endsWith('/edit'), { timeout: 30_000 })
      const saved = (await prisma.package.findUnique({ where: { id: pkg.id } }))!
      expect(saved.specialPriceCents).toBe(8000)
      expect(saved.priceCents).toBe(10000)
    } finally {
      await prisma.package.deleteMany({ where: { id: pkg.id } })
      await prisma.$disconnect()
    }
  })

  // A client-only check is not a validation — anything that can reach the API
  // can post the nonsense straight past the form.
  test('the API refuses it too, even with the form bypassed', async ({ page }) => {
    const prisma = await makePrisma()
    const pkg = await makeOffering(prisma)
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.evaluate(async (id) => {
        const r = await fetch(`/api/packages/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priceCents: 10000, specialPriceCents: 25000 }),
        })
        return { status: r.status, body: await r.text() }
      }, pkg.id)
      expect(res.status).toBe(400)
      expect(res.body).toMatch(/discount/i)

      const after = (await prisma.package.findUnique({ where: { id: pkg.id } }))!
      expect(after.specialPriceCents).toBeNull()
    } finally {
      await prisma.package.deleteMany({ where: { id: pkg.id } })
      await prisma.$disconnect()
    }
  })
})

test.describe('offering — the session-notes reminder is not an event thing', () => {
  const LABEL = 'Send a follow-up reminder for session notes'

  test('an event never offers it; a class still does', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // The wizard shows one card at a time, so walk to Settings on each kind.
    async function walkToSettings(kind: string) {
      await page.goto(`/offerings/new?kind=${kind}`)
      await page.getByLabel(/^Name/).first().fill(`E2E ${kind} ${Date.now()}`)
      for (let i = 0; i < 4; i++) {
        const next = page.getByRole('button', { name: 'Next', exact: true })
        if (!(await next.count())) break
        await next.click()
      }
      await expect(page.getByRole('button', { name: 'Create offering' })).toBeVisible()
    }

    await walkToSettings('oneoff')
    await expect(page.getByText(LABEL)).toHaveCount(0)

    await walkToSettings('group')
    await expect(page.getByText(LABEL)).toBeVisible()
  })

  // Hiding the question isn't enough — an event that already had the flag on
  // would keep nudging the trainer to write notes on a single occasion.
  test('saving an event turns the nudge off, not just the question', async ({ page }) => {
    const prisma = await makePrisma()
    // A one-off event: group, one session, no recurrence — with the flag on.
    const pkg = await makeOffering(prisma, {
      isGroup: true, isEvent: true, sessionCount: 1, recurrenceRule: null, requireSessionNotes: true,
    })
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/packages/${pkg.id}/edit`)
      await expect(page.getByText('Send a follow-up reminder for session notes')).toHaveCount(0)

      const saved = page.waitForResponse(r =>
        r.request().method() === 'PATCH' && r.url().includes(`/api/packages/${pkg.id}`))
      await page.getByRole('button', { name: 'Save changes' }).click()
      expect((await saved).status()).toBe(200)

      const after = (await prisma.package.findUnique({ where: { id: pkg.id } }))!
      expect(after.requireSessionNotes).toBe(false)
    } finally {
      await prisma.package.deleteMany({ where: { id: pkg.id } })
      await prisma.$disconnect()
    }
  })
})

test.describe('offering details page — actions on the page', () => {
  test.use({ viewport: PHONE })

  // Karl: "it's simply a UX change I'm wanting, so edit is easier to find, and
  // then More you can (clone the package or other offering, delete it, or
  // convert the type of offering)". Edit used to be at the FOOT of the details
  // card, a scroll below the card heading — and on classes and events it was in
  // the page header as well, so the same action appeared twice on one screen.
  // Now: Edit is a button in the card heading, everything occasional is behind
  // More, and each of them exists exactly once.
  test('Edit is in the details card heading, once, with More beside it', async ({ page }) => {
    const prisma = await makePrisma()
    const pkg = await makeOffering(prisma)
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/packages/${pkg.id}`)

      const edit = page.getByRole('link', { name: 'Edit', exact: true })
      await expect(edit).toHaveCount(1)
      await expect(edit).toHaveAttribute('href', `/packages/${pkg.id}/edit`)

      // The old duplicate rows at the foot of the card are gone.
      await expect(page.getByRole('link', { name: 'Edit this package' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Delete this package' })).toHaveCount(0)

      // Edit sits at the TOP of the details card, not below its rows — that's
      // the whole point of the move, so measure it rather than trust it.
      const above = await page.evaluate(() => {
        const link = Array.from(document.querySelectorAll('a'))
          .find(a => a.textContent?.trim() === 'Edit')!
        const firstRow = Array.from(document.querySelectorAll('div'))
          .find(d => d.textContent?.trim().startsWith('Sessions'))!
        return link.getBoundingClientRect().top < firstRow.getBoundingClientRect().top
      })
      expect(above).toBe(true)

      // More opens the house-style sheet with the three occasional actions.
      await page.getByRole('button', { name: /More actions/ }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet.getByRole('button', { name: /Duplicate this/ })).toBeVisible()
      await expect(sheet.getByRole('button', { name: /Delete this/ })).toBeVisible()
      // NOT Convert. A 1:1 consult has nowhere to convert TO: flipping isGroup
      // stranded the offering on neither list, because /packages filters
      // isGroup: false and /classes lists ClassRun rows that the conversion
      // never created. Convert is offered on run-backed offerings only, in the
      // direction that has a route behind it.
      await expect(sheet.getByRole('button', { name: /Convert/ })).toHaveCount(0)

      // Escape closes it and the body scroll lock is released — never two
      // scrollbars, and never a page you can't scroll after closing a sheet.
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
    } finally {
      await prisma.package.deleteMany({ where: { id: pkg.id } })
      await prisma.$disconnect()
    }
  })

  test('Delete lives in More, still asks first, and still deletes', async ({ page }) => {
    const prisma = await makePrisma()
    const pkg = await makeOffering(prisma)
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/packages/${pkg.id}`)

      // It asks, and backing out leaves the offering alone.
      await page.getByRole('button', { name: /More actions/ }).click()
      await page.getByRole('button', { name: /Delete this/ }).click()
      await expect(page.getByText(/can’t be undone/)).toBeVisible()
      await page.getByRole('button', { name: 'Keep it' }).click()
      expect(await prisma.package.count({ where: { id: pkg.id } })).toBe(1)

      // …and confirming actually deletes it.
      await page.getByRole('button', { name: /More actions/ }).click()
      await page.getByRole('button', { name: /Delete this/ }).click()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.waitForURL('**/packages', { timeout: 30_000 })
      expect(await prisma.package.count({ where: { id: pkg.id } })).toBe(0)
    } finally {
      await prisma.package.deleteMany({ where: { id: pkg.id } })
      await prisma.$disconnect()
    }
  })

  test('no Discounts tab, and the Current/Past rule runs into a real data table', async ({ page }) => {
    const prisma = await makePrisma()
    const pkg = await makeOffering(prisma)
    // The Current/Past tabs only render once somebody is on the offering.
    const client = (await prisma.clientProfile.findFirst({ where: { id: SEED.assignedClientId } }))!
    const assignment = await prisma.clientPackage.create({
      data: { packageId: pkg.id, clientId: client.id, startDate: new Date() },
    })
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/packages/${pkg.id}`)

      // The discount engine is built but not shown to trainers yet.
      await expect(page.getByRole('button', { name: /Discounts/ })).toHaveCount(0)

      await page.getByRole('button', { name: /^Clients/ }).first().click()
      const current = page.getByRole('button', { name: /^Current/ })
      await expect(current).toBeVisible()

      // Karl marked the empty space beside the Current/Past pill and asked for
      // a data table. Pinning the pill to the right just moved the dead band to
      // the other end, so the pill is gone: flat text tabs sitting on ONE
      // hairline that runs the full width of the row, straight into the table.
      //
      // So: the tab strip spans its row (no short island), and it carries a
      // bottom border to do it.
      const geom = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent?.trim().startsWith('Current'))!
        const strip = btn.parentElement!
        const table = document.querySelector('table')!.parentElement!
        const r = strip.getBoundingClientRect()
        const t = table.getBoundingClientRect()
        return {
          stripLeft: r.left, stripRight: r.right,
          tableLeft: t.left, tableRight: t.right,
          borderBottom: getComputedStyle(strip).borderBottomWidth,
          bg: getComputedStyle(strip).backgroundColor,
        }
      })
      // The rule under the tabs is exactly as wide as the table it introduces —
      // no short island with a band of nothing beside it.
      expect(Math.abs(geom.stripLeft - geom.tableLeft)).toBeLessThan(2)
      expect(Math.abs(geom.stripRight - geom.tableRight)).toBeLessThan(2)
      expect(parseFloat(geom.borderBottom)).toBeGreaterThan(0)
      // …and no pill track behind it.
      expect(geom.bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)

      // A real data table underneath — every fact in its own column, under a
      // header band, not a list of stacked lines.
      const headers = await page.locator('table thead th').allInnerTexts()
      expect(headers.map(h => h.trim().toLowerCase())).toEqual(
        expect.arrayContaining(['client', 'dog', 'status', 'sessions', 'started']),
      )
      const headerBg = await page.locator('table thead tr').first()
        .evaluate(el => getComputedStyle(el).backgroundColor)
      expect(headerBg).not.toMatch(/rgba\(0, 0, 0, 0\)/)
    } finally {
      await prisma.clientPackage.deleteMany({ where: { id: assignment.id } })
      await prisma.package.deleteMany({ where: { id: pkg.id } })
      await prisma.$disconnect()
    }
  })
})
