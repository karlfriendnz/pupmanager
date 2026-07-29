import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

/**
 * Karl, with a screenshot of /classes: the Current / Past tab pills were sitting
 * ON TOP of the page's description, so the sentence under the title was half
 * hidden behind an opaque `bg-slate-100` track. "Make it so you can always read
 * the text on all the offering pages."
 *
 * The cause was `md:-mt-12` on OfferingListBar: it was there to lift the
 * list/grid TOGGLE up beside the description, into the empty space on the
 * right — but the bar is one justify-between row, so it dragged the
 * left-aligned tabs up by the same 48px, straight over the words. Every list
 * that has both a description and tabs had it, and it fired even with page
 * descriptions turned off, because the offset was unconditional.
 *
 * These tests are geometric on purpose. "Nudge the padding until it looks
 * right at one width" is exactly the fix that regresses, so what's asserted is
 * the invariant: the description's box and the tab strip's box must not
 * intersect, at 390px and at desktop, on every offering list.
 */

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 900 }

function db() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

/** The four lists that carry BOTH a description and a Current/Past strip. */
const LISTS = [
  { path: '/classes',        firstTab: /^Current/,  words: 'Clients enrol into one shared timetable' },
  { path: '/packages',       firstTab: /^Current/,  words: 'Bundles of 1:1 sessions' },
  { path: '/casual-classes', firstTab: /^Current/,  words: 'one session at a time' },
  { path: '/events',         firstTab: /^Upcoming/, words: 'One-off events' },
] as const

/**
 * One offering of every kind, so all four lists have something in them and
 * therefore render their tab strip rather than an empty state. Named with a
 * unique suffix so no other spec's counts move.
 */
async function seedOne(prisma: PrismaClient) {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e5)}`
  const trainer = (await prisma.trainerProfile.findFirst({ where: { businessName: SEED.owner.businessName } }))!
  const base = {
    trainerId: trainer.id,
    sessionCount: 1,
    weeksBetween: 1,
    durationMins: 45,
    priceCents: 5000,
  }
  const consult = await prisma.package.create({
    data: { ...base, name: `E2E Readable 1:1 session ${stamp}`, isGroup: false },
  })
  const group = await prisma.package.create({
    data: { ...base, name: `E2E Readable class ${stamp}`, isGroup: true, capacity: 6 },
  })
  const dropIn = await prisma.package.create({
    data: { ...base, name: `E2E Readable drop-in ${stamp}`, isGroup: true, allowDropIn: true, dropInPriceCents: 3000 },
  })
  const event = await prisma.package.create({
    data: { ...base, name: `E2E Readable event ${stamp}`, isGroup: true, isEvent: true, capacity: 20 },
  })
  const runs = await Promise.all([group, dropIn, event].map(p =>
    prisma.classRun.create({
      data: {
        trainerId: trainer.id,
        packageId: p.id,
        name: p.name,
        // Ahead of today so it lands on Current / Upcoming, not Past.
        startDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    })))
  return {
    packageIds: [consult.id, group.id, dropIn.id, event.id],
    runIds: runs.map(r => r.id),
  }
}

/**
 * The description's box and the tab strip's box, in viewport coordinates. Both
 * are read from the live layout — the whole point is that no amount of markup
 * shuffling can fake this.
 */
async function boxes(page: Page, words: string, firstTab: RegExp) {
  const description = page.getByText(words, { exact: false }).first()
  const tab = page.getByRole('button', { name: firstTab }).first()
  await expect(description).toBeVisible()
  await expect(tab).toBeVisible()
  const strip = await tab.evaluate(el => {
    const r = el.parentElement!.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
  })
  const text = (await description.boundingBox())!
  return { text, strip }
}

for (const width of [PHONE, DESKTOP]) {
  test.describe(`offering lists stay readable at ${width.width}px`, () => {
    test.use({ viewport: width })

    test('the description is never under the Current/Past tabs', async ({ page }) => {
      const prisma = db()
      const made = await seedOne(prisma)
      try {
        await login(page)
        for (const list of LISTS) {
          await page.goto(list.path)
          const { text, strip } = await boxes(page, list.words, list.firstTab)

          // The tab strip must start at or below the last line of the
          // description. A single pixel of overlap is the bug.
          expect(
            strip.top,
            `${list.path} at ${width.width}px: the tab strip starts ${Math.round(text.y + text.height - strip.top)}px above the end of the description`,
          ).toBeGreaterThanOrEqual(text.y + text.height - 1)

          // And the words are actually paintable — nothing is sitting on top of
          // the middle of the sentence. elementFromPoint returns whatever the
          // user's finger would hit there.
          const hitsTheText = await page.evaluate(({ x, y, h, w }) => {
            const el = document.elementFromPoint(x + Math.min(w / 2, 60), y + h / 2)
            return !!el && (el.tagName === 'P' || !!el.closest('p'))
          }, { x: text.x, y: text.y, h: text.height, w: text.width })
          expect(hitsTheText, `${list.path} at ${width.width}px: something is covering the description`).toBe(true)
        }
      } finally {
        await prisma.classRun.deleteMany({ where: { id: { in: made.runIds } } })
        await prisma.package.deleteMany({ where: { id: { in: made.packageIds } } })
        await prisma.$disconnect()
      }
    })
  })
}

test.describe('offering list tabs follow the house style', () => {
  test.use({ viewport: PHONE })

  test('flat underline tabs, no pill track', async ({ page }) => {
    const prisma = db()
    const made = await seedOne(prisma)
    try {
      await login(page)
      await page.goto('/classes')
      const tab = page.getByRole('button', { name: /^Current/ }).first()
      await expect(tab).toBeVisible()

      const style = await tab.evaluate(el => {
        const own = getComputedStyle(el)
        const track = getComputedStyle(el.parentElement!)
        return {
          ownBg: own.backgroundColor,
          trackBg: track.backgroundColor,
          underline: own.borderBottomWidth,
          // The negative pull that caused the overlap must be gone for good.
          barTop: getComputedStyle(el.parentElement!.parentElement!).marginTop,
        }
      })
      // No chip: neither the active tab nor its track paints a filled surface.
      expect(style.ownBg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
      expect(style.trackBg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
      // It marks itself with a rule underneath instead.
      expect(parseFloat(style.underline)).toBeGreaterThan(0)
      // And the bar is in normal flow — no negative top margin dragging it up
      // over whatever happens to be above it.
      expect(parseFloat(style.barTop)).toBeGreaterThanOrEqual(0)
    } finally {
      await prisma.classRun.deleteMany({ where: { id: { in: made.runIds } } })
      await prisma.package.deleteMany({ where: { id: { in: made.packageIds } } })
      await prisma.$disconnect()
    }
  })
})
