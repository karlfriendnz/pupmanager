import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// /my-dogs is where a dog owner's dogs live — and, since the Dogs tab came off
// My Profile, where they are ADDED and EDITED.
//
// The headline assertion is the round trip (AGENTS.md bug #1): every field the
// add form accepts is typed, saved, and then read back after a full reload. "It
// saved fine" has been wrong three times in this codebase; a reload is the only
// proof.
//
// Matching every other spec in this suite, login() is file-local.
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

// The (client) layout gates the whole app behind intake until every REQUIRED
// field has a value; other specs add required fields to Business A, so fill it
// if it's there rather than depend on spec order.
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

/**
 * Pick a birthday on the shared three-select control
 * (components/shared/date-of-birth-field.tsx). Each select carries its own real
 * <label>, which is what makes this findable — and what the review widget reads.
 */
async function setDateOfBirth(page: Page, parts: { day?: string; month?: string; year?: string }) {
  if (parts.day) await page.getByLabel('Date of birth — day').selectOption(parts.day)
  if (parts.month) await page.getByLabel('Date of birth — month').selectOption({ label: parts.month })
  if (parts.year) await page.getByLabel('Date of birth — year').selectOption(parts.year)
}

async function makePrisma() {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

test.describe('client adds a dog on /my-dogs', () => {
  test('name, breed, weight and date of birth all survive a reload', async ({ page }) => {
    const prisma = await makePrisma()
    const name = `Pippin ${Date.now()}`
    try {
      await login(page, SEED.client.email, SEED.client.password, '/home')
      await page.goto('/my-dogs')
      // No heading to wait on: the client shell owns the page title and only
      // paints it in its PHONE top bar, so at this suite's desktop viewport
      // /my-dogs carries no <h1> at all. The add affordance is the page's own
      // content, and it is there whether or not the client already has dogs.
      const add = page.getByRole('button', { name: /Add (a|another) dog/ })
      await expect(add).toBeVisible({ timeout: 15_000 })
      await add.click()

      // Scoped to the sheet: its own aria-label is "Add a dog — Just a name to
      // start — …", so an unscoped getByLabel('Name') matches the dialog too.
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      await sheet.getByLabel('Name').fill(name)
      await sheet.getByLabel('Breed').fill('Border Collie')
      // The breed combobox drops its list open over the fields below it. Close
      // it by PICKING the breed, which is what a person does — its Escape
      // handler doesn't stopPropagation, so Escape reaches the sheet's own
      // window listener and shuts the whole sheet.
      await sheet.getByRole('option', { name: 'Border Collie', exact: true }).first().click()
      await sheet.getByLabel('Weight (kg)').fill('18.5')
      // Date of BIRTH is three selects — day, month NAME, year — never the
      // native date picker, which makes you page back through the years.
      await setDateOfBirth(page, { day: '2', month: 'April', year: '2021' })
      await page.getByRole('button', { name: 'Add dog', exact: true }).click()

      // Saved — the sheet stays open so a photo can go on straight away.
      await expect(page.getByText(`${name} added.`)).toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: 'Close' }).click()

      // THE PROOF: a full reload, not a client-side refresh.
      await page.reload()
      await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Border Collie').first()).toBeVisible()
      await expect(page.getByText('18.5 kg')).toBeVisible()

      // And it is genuinely one row on the caller's own profile — not a
      // duplicate of the primary, and not on somebody else's account.
      const rows = await prisma.dog.findMany({ where: { name } })
      expect(rows).toHaveLength(1)
      expect(rows[0].clientProfileId).toBe(SEED.assignedClientId)
      expect(rows[0].breed).toBe('Border Collie')
      expect(rows[0].weight).toBe(18.5)
      expect(rows[0].dob?.toISOString().slice(0, 10)).toBe('2021-04-02')
      // The list de-dupes the primary/household double-link, so exactly one card.
      await expect(page.getByText(name)).toHaveCount(1)
    } finally {
      await prisma.dog.deleteMany({ where: { name } })
      await prisma.$disconnect()
    }
  })

  test('an edit made on /my-dogs survives a reload too', async ({ page }) => {
    const prisma = await makePrisma()
    const name = `Rosie ${Date.now()}`
    let dogId: string | null = null
    try {
      const dog = await prisma.dog.create({ data: { name, clientProfileId: SEED.assignedClientId } })
      dogId = dog.id

      await login(page, SEED.client.email, SEED.client.password, '/home')
      await page.goto('/my-dogs')
      await page.getByRole('button', { name: `Edit ${name}` }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByLabel('Weight (kg)').fill('9.4')
      await setDateOfBirth(page, { day: '15', month: 'June', year: '2023' })
      await page.getByRole('button', { name: 'Save changes' }).click()

      await page.reload()
      await expect(page.getByText('9.4 kg')).toBeVisible({ timeout: 15_000 })
      const after = await prisma.dog.findUnique({ where: { id: dog.id } })
      expect(after?.weight).toBe(9.4)
      expect(after?.dob?.toISOString().slice(0, 10)).toBe('2023-06-15')
    } finally {
      if (dogId) await prisma.dog.deleteMany({ where: { id: dogId } })
      await prisma.$disconnect()
    }
  })

  test('date of birth is three dropdowns: no native picker, no half-picked date, no 29 February in a common year', async ({ page }) => {
    const prisma = await makePrisma()
    const name = `Feb ${Date.now()}`
    try {
      await login(page, SEED.client.email, SEED.client.password, '/home')
      await page.goto('/my-dogs')
      await page.getByRole('button', { name: /Add (a|another) dog/ }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()

      // 1 · The thing Karl asked for: the native date picker is gone.
      await expect(sheet.locator('input[type="date"]')).toHaveCount(0)
      await expect(page.getByLabel('Date of birth — day')).toBeVisible()
      await expect(page.getByLabel('Date of birth — month')).toBeVisible()
      await expect(page.getByLabel('Date of birth — year')).toBeVisible()

      // Scoped: the sheet's aria-label contains "name", so page-level
      // getByLabel('Name') is a strict-mode violation.
      await sheet.getByLabel('Name').fill(name)

      // 2 · A day and a month with no year is REFUSED, not quietly saved as
      //     "no birthday" (AGENTS.md bugs #1 and #3). 29 February is offered
      //     while the year is unknown, because it is a real birthday.
      await setDateOfBirth(page, { day: '29', month: 'February' })
      await page.getByRole('button', { name: 'Add dog', exact: true }).click()
      await expect(page.getByText('Finish the date of birth — pick a day, a month and a year.')).toBeVisible()
      expect(await prisma.dog.count({ where: { name } })).toBe(0)

      // 3 · Choosing a common year clamps the 29th back to the 28th ON SCREEN,
      //     so an impossible date can never be submitted.
      await setDateOfBirth(page, { year: '2023' })
      await expect(page.getByLabel('Date of birth — day')).toHaveValue('28')
      await page.getByRole('button', { name: 'Add dog', exact: true }).click()
      await expect(page.getByText(`${name} added.`)).toBeVisible({ timeout: 15_000 })

      const rows = await prisma.dog.findMany({ where: { name } })
      expect(rows).toHaveLength(1)
      expect(rows[0].dob?.toISOString().slice(0, 10)).toBe('2023-02-28')
    } finally {
      await prisma.dog.deleteMany({ where: { name } })
      await prisma.$disconnect()
    }
  })

  test('a forged clientProfileId cannot plant a dog on another tenant, and another tenant’s dog cannot be edited', async ({ page }) => {
    const prisma = await makePrisma()
    const planted = `Forged ${Date.now()}`
    let victimDogId: string | null = null
    try {
      // A dog that belongs to Business B's client — the cross-tenant target.
      const victim = await prisma.dog.create({
        data: { name: `Rival ${Date.now()}`, clientProfileId: SEED.businessB.clientId },
      })
      victimDogId = victim.id

      await login(page, SEED.client.email, SEED.client.password, '/home')

      // 1 · The create route takes the owning profile from the session, never
      //     from the body.
      const created = await page.evaluate(async ([dogName, otherProfile]) => {
        const res = await fetch('/api/my/dogs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: dogName, clientProfileId: otherProfile }),
        })
        return { status: res.status, body: await res.json().catch(() => null) }
      }, [planted, SEED.businessB.clientId] as const)
      expect(created.status).toBe(201)
      const plantedRow = await prisma.dog.findFirst({ where: { name: planted } })
      expect(plantedRow?.clientProfileId).toBe(SEED.assignedClientId)

      // 2 · Editing / deleting somebody else's dog is a 404, not a 200.
      const attack = await page.evaluate(async (id) => {
        const patch = await fetch(`/api/dogs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Owned' }),
        })
        const del = await fetch(`/api/dogs/${id}`, { method: 'DELETE' })
        return { patch: patch.status, del: del.status }
      }, victim.id)
      expect(attack.patch).toBe(404)
      expect(attack.del).toBe(404)
      const stillThere = await prisma.dog.findUnique({ where: { id: victim.id } })
      expect(stillThere?.name).toBe(victim.name)
    } finally {
      await prisma.dog.deleteMany({ where: { name: planted } })
      if (victimDogId) await prisma.dog.deleteMany({ where: { id: victimDogId } })
      await prisma.$disconnect()
    }
  })
})

test.describe('My Profile is just the person now', () => {
  test('no Dogs or Notifications tabs, and the old deep links forward', async ({ page }) => {
    await login(page, SEED.client.email, SEED.client.password, '/home')

    await page.goto('/my-profile')
    await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'My details' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dogs', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toHaveCount(0)

    // Old deep links land on the real pages rather than a blank tab.
    await page.goto('/my-profile?tab=notifications')
    await page.waitForURL('**/my-notifications?tab=settings', { timeout: 15_000 })
    await expect(page.getByText('Notify me')).toBeVisible({ timeout: 15_000 })

    await page.goto('/my-profile?tab=dogs')
    await page.waitForURL('**/my-dogs', { timeout: 15_000 })
    await expect(page.getByRole('button', { name: /Add (a|another) dog/ })).toBeVisible()
  })
})
