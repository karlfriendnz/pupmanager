import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Two things that were quietly never being set.
//
//   · A household's PRIMARY dog. Neither dog-create route set it, so any dog
//     added after the client existed was only ever an "additional" one — hence
//     a client with four dogs and no primary.
//   · A trainer's COUNTRY. /register and /signup read it from the geo header,
//     but an OAuth sign-up creates its profile in a NextAuth event with no
//     request to read one from, so it arrived null — and with it, no currency
//     and nothing for Stripe onboarding to start from.

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

test.describe('a household always has a primary dog', () => {
  test('the first dog a client adds becomes their primary', async ({ page }) => {
    const prisma = await makePrisma()
    const first = `E2E First Dog ${Date.now()}`
    const second = `E2E Second Dog ${Date.now()}`
    // Captured out here so the restore can live in `finally`. The seeded client
    // is shared with every other spec — leaving them without a primary dog
    // breaks the multi-dog tests further down the suite, which is exactly what
    // happened when this restore sat inside the try.
    const before = await prisma.clientProfile.findUnique({
      where: { id: SEED.assignedClientId }, select: { dogId: true },
    })
    try {
      await prisma.clientProfile.update({ where: { id: SEED.assignedClientId }, data: { dogId: null } })

      await login(page, SEED.client.email, SEED.client.password)

      const a = await page.request.post('/api/my/dogs', { data: { name: first } })
      expect(a.status()).toBe(201)
      const dogA = await a.json() as { id: string }

      const afterFirst = await prisma.clientProfile.findUnique({
        where: { id: SEED.assignedClientId }, select: { dogId: true },
      })
      expect(afterFirst?.dogId, 'the first dog should become the primary').toBe(dogA.id)

      // A second dog does NOT steal the spot.
      const b = await page.request.post('/api/my/dogs', { data: { name: second } })
      expect(b.status()).toBe(201)
      const dogB = await b.json() as { id: string }

      const afterSecond = await prisma.clientProfile.findUnique({
        where: { id: SEED.assignedClientId }, select: { dogId: true },
      })
      expect(afterSecond?.dogId, 'a later dog must not take over as primary').toBe(dogA.id)
      expect(afterSecond?.dogId).not.toBe(dogB.id)

      // What the list makes of it is covered by client-record-completeness;
      // this test is about the rule itself.
    } finally {
      // Put the primary back BEFORE removing the dogs, so the profile never
      // points at a dog that's gone.
      await prisma.clientProfile.update({
        where: { id: SEED.assignedClientId }, data: { dogId: before?.dogId ?? null },
      }).catch(() => {})
      await prisma.dog.deleteMany({ where: { name: { in: [first, second] } } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('a dog the trainer adds also becomes the primary when there is none', async ({ page }) => {
    const prisma = await makePrisma()
    const name = `E2E Trainer First Dog ${Date.now()}`
    let clientId: string | null = null
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName }, select: { id: true },
      })
      const user = await prisma.user.create({
        data: { email: `e2e-primary-${Date.now()}@e2e.test`, name: 'Primary Dog Client', role: 'CLIENT' },
      })
      const client = await prisma.clientProfile.create({
        data: { userId: user.id, trainerId: trainer!.id, status: 'ACTIVE' },
      })
      clientId = client.id

      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post(`/api/clients/${client.id}/dogs`, { data: { name } })
      expect([200, 201], await res.text()).toContain(res.status())

      const after = await prisma.clientProfile.findUnique({
        where: { id: client.id }, select: { dogId: true, dogs: { select: { id: true } } },
      })
      expect(after?.dogId, 'a trainer-added first dog should become the primary too').toBe(after?.dogs[0]?.id)
    } finally {
      if (clientId) {
        await prisma.clientProfile.update({ where: { id: clientId }, data: { dogId: null } }).catch(() => {})
        await prisma.dog.deleteMany({ where: { clientProfileId: clientId } }).catch(() => {})
        const c = await prisma.clientProfile.findUnique({ where: { id: clientId }, select: { userId: true } })
        await prisma.clientProfile.delete({ where: { id: clientId } }).catch(() => {})
        if (c?.userId) await prisma.user.delete({ where: { id: c.userId } }).catch(() => {})
      }
      await prisma.$disconnect()
    }
  })
})

test.describe('a trainer always ends up with a country', () => {
  test('the profile-completion gate stamps the country from the network', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName },
        select: { id: true, signupCountry: true, businessName: true, phone: true, showPhoneToClients: true },
      })
      // The state an OAuth sign-up is in: no country at all.
      await prisma.trainerProfile.update({ where: { id: trainer!.id }, data: { signupCountry: null } })

      await login(page, SEED.owner.email, SEED.owner.password)
      const res = await page.request.post('/api/trainer/complete-profile', {
        // The header a request through Vercel's edge carries.
        headers: { 'x-vercel-ip-country': 'gb' },
        data: {
          name: SEED.owner.name,
          businessName: trainer!.businessName,
          phone: trainer!.phone ?? '021 555 0000',
          showPhoneToClients: trainer!.showPhoneToClients,
        },
      })
      expect(res.status(), await res.text()).toBe(200)

      const after = await prisma.trainerProfile.findUnique({
        where: { id: trainer!.id }, select: { signupCountry: true },
      })
      expect(after?.signupCountry, 'the gate should have captured the country').toBe('GB')

      await prisma.trainerProfile.update({
        where: { id: trainer!.id }, data: { signupCountry: trainer!.signupCountry },
      })
    } finally {
      await prisma.$disconnect()
    }
  })

  test('an existing country is never overwritten by the network', async ({ page }) => {
    const prisma = await makePrisma()
    try {
      const trainer = await prisma.trainerProfile.findFirst({
        where: { businessName: SEED.owner.businessName },
        select: { id: true, signupCountry: true, businessName: true, phone: true, showPhoneToClients: true },
      })
      await prisma.trainerProfile.update({ where: { id: trainer!.id }, data: { signupCountry: 'NZ' } })

      await login(page, SEED.owner.email, SEED.owner.password)
      await page.request.post('/api/trainer/complete-profile', {
        // Travelling, on a VPN, whatever — their country doesn't change.
        headers: { 'x-vercel-ip-country': 'US' },
        data: {
          name: SEED.owner.name,
          businessName: trainer!.businessName,
          phone: trainer!.phone ?? '021 555 0000',
          showPhoneToClients: trainer!.showPhoneToClients,
        },
      })

      const after = await prisma.trainerProfile.findUnique({
        where: { id: trainer!.id }, select: { signupCountry: true },
      })
      expect(after?.signupCountry, 'a country we already hold must win over an IP guess').toBe('NZ')

      await prisma.trainerProfile.update({
        where: { id: trainer!.id }, data: { signupCountry: trainer!.signupCountry },
      })
    } finally {
      await prisma.$disconnect()
    }
  })
})
