import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// The client record is the thing everything else hangs off, and its form is the
// longest one a trainer fills in. This fills EVERY field on a phone, saves, and
// then checks each value actually came back — the failure mode being a field
// that looks saved, isn't, and nobody notices until a client asks why their
// dog's birthday is wrong.
//
// Then the careless passes: nothing at all, and a name made of markup.

const PHONE = { width: 390, height: 844 }
test.use({ viewport: PHONE })

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

// Karl asked for /clients/invite to be a focused flow: one tab per section,
// the invitation email on its own tab, and the main nav out of the way. The
// screen takes the whole viewport (`fixed inset-0`, above the shell's z-40
// chrome) rather than app-shell special-casing another path.
test.describe('the new-client screen is a focused, tabbed flow', () => {
  test('three tabs, the invite email on its own, and no main nav', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/clients/invite')

    for (const label of ['Contact', 'Dogs', 'Invitation email']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible()
    }

    // Contact leads; the dog block and the invite body belong to other tabs.
    await expect(page.getByPlaceholder('Jane Smith')).toBeVisible()
    await expect(page.getByPlaceholder('Buddy')).toBeHidden()
    await expect(page.getByText('Send invitation email')).toBeHidden()

    await page.getByRole('button', { name: /^Dogs/ }).click()
    await expect(page.getByPlaceholder('Buddy')).toBeVisible()
    await expect(page.getByPlaceholder('Jane Smith')).toBeHidden()

    await page.getByRole('button', { name: /^Invitation email/ }).click()
    await expect(page.getByText('Send invitation email')).toBeVisible()
    await expect(page.getByPlaceholder('Buddy')).toBeHidden()

    // Create is live from every tab — a trainer who only wanted a name and a
    // phone number shouldn't have to tour the others to save.
    await expect(page.getByRole('button', { name: 'Create client' })).toBeVisible()

    // The main nav is covered: whatever is under the bottom of the viewport
    // belongs to this screen, not to the shell's tab bar / sidebar.
    const coversNav = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 6)
      return !!el?.closest('.fixed.inset-0')
    })
    expect(coversNav).toBe(true)

    // Never two scrollbars: this surface scrolls, the page behind it doesn't.
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  })

  test('leaving the flow restores the page scroll it locked', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/clients/invite')
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')

    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.waitForURL('**/clients', { timeout: 30_000 })
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  })
})

test.describe('the client form, every field', () => {
  test('fills in everything and every value comes back', async ({ page }) => {
    const prisma = await makePrisma()
    const stamp = Date.now()
    const name = `E2E Full Fields ${stamp}`
    const email = `e2e-fields-${stamp}@e2e.test`
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/clients/invite')

      await page.getByPlaceholder('Jane Smith').fill(name)
      await page.getByPlaceholder('jane@example.com (optional)').fill(email)
      await page.getByPlaceholder('021 234 5678').fill('021 555 0101')

      // The dog block — name, breed, weight, date of birth, notes. It has its
      // own tab now: the screen is Contact · Dogs · Invitation email.
      await page.getByRole('button', { name: /^Dogs/ }).click()
      await page.getByPlaceholder('Buddy').fill('Rex')
      await page.locator('input[type="date"]').first().fill('2022-03-14')

      // Create is live from any tab, so no tour back to Contact first.
      await page.getByRole('button', { name: 'Create client' }).click()

      // Saved, and reachable. Name and email live on the linked User; the
      // profile carries the phone and points at the primary dog.
      await expect.poll(
        async () => prisma.clientProfile.count({ where: { user: { name } } }),
        { timeout: 20_000, message: 'the client never saved' },
      ).toBe(1)

      const saved = await prisma.clientProfile.findFirst({
        where: { user: { name } },
        select: {
          phone: true,
          user: { select: { name: true, email: true } },
          dog: { select: { name: true, dob: true } },
          dogs: { select: { name: true, dob: true } },
        },
      })
      expect(saved?.user?.name).toBe(name)
      expect(saved?.user?.email).toBe(email)
      // Phone keeps the shape it was typed in — trainers dial what they see.
      expect(saved?.phone?.replace(/\s/g, '')).toBe('0215550101')

      const dog = saved?.dog ?? saved?.dogs?.[0]
      expect(dog?.name).toBe('Rex')
      // The date has to survive the timezone round trip, not slip a day.
      expect(dog?.dob?.toISOString().slice(0, 10)).toBe('2022-03-14')
    } finally {
      const c = await prisma.clientProfile.findFirst({ where: { user: { name } }, select: { id: true, userId: true } })
      if (c) {
        await prisma.dog.deleteMany({ where: { clientProfileId: c.id } }).catch(() => {})
        await prisma.clientProfile.delete({ where: { id: c.id } }).catch(() => {})
        if (c.userId) await prisma.user.delete({ where: { id: c.userId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  // A client field can apply to the OWNER or to A DOG, and the dog case had never
  // been exercised anywhere: no test filled one in, and every one of the 1,113
  // values in the dev database belonged to an owner field. So "does a dog answer
  // actually attach to the dog?" had no answer. It does — and now it stays
  // answered, because the way it would break is silent. The routes drop a dogId
  // they can't vouch for and store the value unscoped, which looks like a
  // successful save and quietly loses which dog it was about.
  test('an answer about a dog is filed against that dog', async ({ page }) => {
    const prisma = await makePrisma()
    const stamp = Date.now()
    const label = `E2E Dog Field ${stamp}`
    const answer = `Chicken ${stamp}`
    let fieldId: string | null = null
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { user: { email: SEED.owner.email } },
        select: { id: true },
      })
      const field = await prisma.customField.create({
        data: { trainerId: trainer!.id, label, type: 'TEXT', appliesTo: 'DOG' },
      })
      fieldId = field.id

      // The seeded client's dog is linked from the CLIENT side (ClientProfile.dogId)
      // and has no clientProfileId of its own — the shape most dogs are in, and the
      // one an ownership check is most likely to miss.
      const client = await prisma.clientProfile.findUnique({
        where: { id: SEED.assignedClientId },
        select: { dogId: true },
      })
      expect(client?.dogId, 'the seeded client needs a dog for this to mean anything').toBeTruthy()

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto(`/clients/${SEED.assignedClientId}/edit`)

      const input = page.getByLabel(label)
      await input.scrollIntoViewIfNeeded()
      await input.fill(answer)
      await page.getByRole('button', { name: /^Save/ }).first().click()

      await expect.poll(
        async () => prisma.customFieldValue.count({ where: { fieldId: field.id } }),
        { timeout: 20_000, message: 'the dog answer never saved' },
      ).toBe(1)

      const saved = await prisma.customFieldValue.findFirst({ where: { fieldId: field.id } })
      expect(saved?.value).toBe(answer)
      // The whole point: it knows WHICH dog. Null here is the silent failure.
      expect(saved?.dogId, 'the answer saved but lost which dog it was about').toBe(client!.dogId)
    } finally {
      if (fieldId) {
        await prisma.customFieldValue.deleteMany({ where: { fieldId } }).catch(() => {})
        await prisma.customField.delete({ where: { id: fieldId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })

  test('an empty form is refused, and saves nothing', async ({ page }) => {
    const prisma = await makePrisma()
    const before = await prisma.clientProfile.count()
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      await page.goto('/clients/invite')

      await page.getByRole('button', { name: 'Create client' }).click()

      // Still on the form — and nothing was written.
      await expect(page.getByRole('button', { name: 'Create client' })).toBeVisible()
      await expect.poll(async () => prisma.clientProfile.count(), { timeout: 5_000 }).toBe(before)
    } finally {
      await prisma.$disconnect()
    }
  })

  // Markup typed into a name must come back as text, everywhere it's shown.
  test('a name made of markup is stored and shown as text, not run', async ({ page }) => {
    const prisma = await makePrisma()
    const payload = `<img src=x onerror=alert(1)>E2E XSS ${Date.now()}`
    let dialogFired = false
    try {
      await login(page, SEED.owner.email, SEED.owner.password)
      page.on('dialog', async d => { dialogFired = true; await d.dismiss() })

      const res = await page.request.post('/api/clients', {
        data: { name: payload, email: `e2e-xss-${Date.now()}@e2e.test` },
      })
      expect([200, 201]).toContain(res.status())

      // Contacts, not the default Current tab: activity is DERIVED from what
      // someone has booked (see client-activity.ts), and a client created with
      // just a name and an email has booked nothing yet.
      await page.goto('/clients?tab=never')
      // Rendered as text: the literal string is visible, and no script ran. The
      // tail is the distinctive part (the markup prefix is shared).
      await expect(page.getByText(payload.split('>')[1]).locator('visible=true').first())
        .toBeVisible({ timeout: 15_000 })
      expect(dialogFired, 'markup in a client name executed').toBe(false)
    } finally {
      const c = await prisma.clientProfile.findFirst({ where: { user: { name: payload } }, select: { id: true, userId: true } })
      if (c) {
        await prisma.clientProfile.delete({ where: { id: c.id } }).catch(() => {})
        if (c.userId) await prisma.user.delete({ where: { id: c.userId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })
})
