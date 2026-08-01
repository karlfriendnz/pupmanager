import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// Four defects reported from a real phone. Every test here runs at 390px with
// touch emulation on — a mouse click would have passed against all four.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

// Every element on the page that is its own scrolling box right now.
async function scrollers(page: Page) {
  return page.evaluate(() => {
    const found: string[] = []
    document.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el)
      const canY = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2
      if (canY) found.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 60))
    })
    return found
  })
}

// ── 3. Enquiry rows open on a tap ──────────────────────────────────────────
test('tapping an enquiry row on a phone opens that enquiry', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto('/enquiries')

  const row = page.getByRole('link', { name: new RegExp(SEED.enquiryName) })
  await expect(row).toBeVisible({ timeout: 20_000 })

  // The hit area must be a real target, not a hairline.
  const box = await row.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThanOrEqual(44)

  // Nothing may sit on top of the row: whatever is under the middle of it has
  // to belong to the row itself.
  const covered = await page.evaluate((name) => {
    const a = [...document.querySelectorAll('a[href^="/enquiries/"]')]
      .find(el => (el.textContent ?? '').includes(name))
    if (!a) return 'row not found'
    const r = a.getBoundingClientRect()
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return el && a.contains(el) ? null : 'covered by ' + (el ? el.tagName : 'nothing')
  }, SEED.enquiryName)
  expect(covered).toBeNull()

  await row.tap()
  await expect(page).toHaveURL(new RegExp(`/enquiries/${SEED.enquiryId}$`), { timeout: 20_000 })
  await expect(page.getByText(SEED.enquiryName).first()).toBeVisible()
})

// ── 1. The booking-request card reads properly on a phone ──────────────────
test('the booking-request preview card is readable at 390px', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto(`/schedule?previewRequest=${SEED.previewRequestId}`)

  const card = page.getByTestId('booking-request-preview')
  await expect(card).toBeVisible({ timeout: 20_000 })

  // The sentence that used to render one word per line.
  const line = card.getByText(/proposed sessions, shown as dashed blocks/)
  await expect(line).toBeVisible()

  // It must have most of the screen to itself, not ~20px beside the buttons.
  const lineBox = (await line.boundingBox())!
  expect(lineBox.width).toBeGreaterThan(240)

  // …and therefore not be a tall thin column of single words.
  expect(lineBox.height).toBeLessThan(80)

  // Both actions are on screen and a real touch target.
  for (const name of ['Decline', 'Approve']) {
    const btn = card.getByRole('button', { name })
    await expect(btn).toBeVisible()
    const b = (await btn.boundingBox())!
    expect(b.height).toBeGreaterThanOrEqual(44)
    expect(b.x + b.width).toBeLessThanOrEqual(390)
  }

  // House style: one flat block, no tinted banner.
  await expect(card).toHaveClass(/border-slate-200/)
  await expect(card).not.toHaveClass(/bg-indigo/)
})

// Picking a layout is REMEMBERED per device class (savedMobileView), so a spec
// that switches to Week must put the phone default back or every later spec
// that expects the day view starts on a grid.
// The four layouts the View panel offers. "Agenda" is the one-day LIST (the
// only one with a day-swipe target); "Day" is the hour grid.
async function setLayout(page: Page, layout: 'Agenda' | 'Day' | '3 days' | 'Week') {
  await page.getByRole('button', { name: 'Schedule view options' }).click()
  await page.getByRole('button', { name: layout, exact: true }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
}

// ── 2. The calendar scrolls, and only one thing scrolls ────────────────────
test('the week calendar scrolls with the page, not in a box of its own', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto('/schedule')

  // Switch to Week so the hour grid renders on a phone.
  await setLayout(page, 'Week')

  const grid = page.getByTestId('schedule-scroll')
  await expect(grid).toBeVisible({ timeout: 20_000 })

  // The grid must NOT be a scroll box on a phone — that was the second
  // scrollbar, and the reason a drag inside it stopped dead after ~100px.
  await expect
    .poll(() => grid.evaluate((el) => getComputedStyle(el).overflowY), { timeout: 10_000 })
    .toBe('visible')

  // At most one scrolling region on screen (Karl's standing rule). The page
  // itself scrolls the document, which is not an element, so this must be [].
  expect(await scrollers(page)).toEqual([])

  // And the page really does scroll: the grid is taller than the viewport.
  const canScroll = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 10,
  )
  expect(canScroll).toBe(true)

  await page.evaluate(() => window.scrollTo(0, 400))
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 }).toBeGreaterThan(100)

  // Hand the phone default back to the next spec. AGENDA, not "Day": the
  // layout is saved on the trainer's PROFILE, so whatever this leaves behind is
  // what every later schedule spec opens on — and `day-swipe` only exists on
  // the agenda list. "Day" is the hour grid, which has no swipe target, so this
  // line both failed here and left the swipe specs looking at the wrong screen.
  await page.evaluate(() => window.scrollTo(0, 0))
  await setLayout(page, 'Agenda')
  await expect(page.getByTestId('day-swipe')).toBeVisible({ timeout: 15_000 })
})

// ── 4. No chip/pill controls left on the schedule ──────────────────────────
test('schedule view options use flat rows, not chips', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto('/schedule')
  await page.getByRole('button', { name: 'Schedule view options' }).click()

  // Layout is a list of named rows you tick, not a segmented pill group.
  await expect(page.getByRole('button', { name: 'Day', exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Week', exact: true })).toBeVisible()

  // Days are spelled out in a hairline-split block, not seven filled pills.
  await expect(page.getByRole('button', { name: 'Monday', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sunday', exact: true })).toBeVisible()

  // The old chip markup: a slate pill track holding the layout buttons, and
  // seven blue filled day pills.
  const chipTracks = await page.locator('.rounded-xl.bg-slate-100.p-1').count()
  expect(chipTracks).toBe(0)
  const filledDayPills = await page.locator('button.bg-blue-600.border-blue-600').count()
  expect(filledDayPills).toBe(0)

  // Toggling still works — a day row ticks off and on.
  const monday = page.getByRole('button', { name: 'Monday', exact: true })
  const before = await monday.getAttribute('aria-pressed')
  await monday.tap()
  await expect.poll(() => monday.getAttribute('aria-pressed'), { timeout: 5_000 }).not.toBe(before)
})
