import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// Karl: "no remove the message icon — the whole row should go to the client."
//
// The /clients row used to carry a message button. Two ways that regressed
// before, both guarded here:
//
//   · an anchor (or any button) INSIDE the row's anchor is invalid HTML, and
//     the browser hands the tap to the inner element — the row silently stops
//     navigating for the part of its width the icon sits under.
//   · a bare <a> is inline, so the tap area hugs the text runs. On a phone the
//     padding either side of the name became dead space and the row only
//     worked if you hit the letters.
//
// So: no interactive descendant, and a tap 3px in from each edge must land on
// the client's profile. Read-only — this spec creates and mutates nothing.

// `a[href^="/clients/"]` also matches the nav's own /clients/waitlist and
// /clients/invite entries (hidden inside the phone menu), so every query goes
// through this filter rather than a bare locator.
const ROW_HREF = /^\/clients\/[^/]+$/
const NOT_A_CLIENT = ['invite', 'import', 'waitlist', 'new']

/** Visible client-row links with their on-screen boxes. */
async function rowBoxes(page: Page) {
  return page.$$eval('a[href^="/clients/"]', els =>
    els
      .filter(e => {
        const h = e.getAttribute('href') ?? ''
        return /^\/clients\/[^/]+$/.test(h)
          && !['invite', 'import', 'waitlist', 'new'].includes(h.split('/')[2])
      })
      .map(e => {
        const r = e.getBoundingClientRect()
        return { href: e.getAttribute('href')!, x: r.x, y: r.y, w: r.width, h: r.height }
      })
      .filter(r => r.w > 0 && r.h > 0),
  )
}

// The clients list gained Current / Past / Contacts tabs, and the default
// "Current" only lists people booked onto something still to come — so it is
// empty for seeded data and every row query found nothing. ?tab=never is the
// Contacts view: everyone on the list. Navigating by URL rather than clicking
// the tab keeps this independent of how the tab row is rendered.
async function gotoClients(page: Page) {
  await page.goto('/clients?tab=never')
  await expect
    .poll(async () => (await rowBoxes(page)).length, { timeout: 30_000 })
    .toBeGreaterThan(0)
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

test.describe('the clients list row opens the client', () => {
  test('at 390px the whole row is the target, edges included', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page, SEED.owner.email, SEED.owner.password)
    await gotoClients(page)

    const [first] = await rowBoxes(page)
    // A row is a real row, not a link wrapped around a word.
    expect(first.w, 'the row link spans the list width').toBeGreaterThan(300)
    expect(first.h, 'the row link is full height, not just the text line').toBeGreaterThanOrEqual(40)

    // Tap 3px in from each edge. The centre passing proves nothing — the icon
    // regression only ever ate the right-hand end.
    const edges = ['left', 'right', 'top', 'bottom'] as const
    for (const edge of edges) {
      await gotoClients(page)
      // Re-measure each time: the list can reflow between loads.
      const [row] = await rowBoxes(page)
      const point =
        edge === 'left' ? { x: row.x + 3, y: row.y + row.h / 2 }
          : edge === 'right' ? { x: row.x + row.w - 3, y: row.y + row.h / 2 }
            : edge === 'top' ? { x: row.x + row.w / 2, y: row.y + 2 }
              : { x: row.x + row.w / 2, y: row.y + row.h - 2 }

      await page.mouse.click(point.x, point.y)
      await page.waitForURL(u => u.pathname === row.href, { timeout: 20_000 })
      expect(new URL(page.url()).pathname, `${edge} edge navigates`).toBe(row.href)
    }
  })

  test('no message icon, and nothing interactive nested inside the row link', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page, SEED.owner.email, SEED.owner.password)
    await gotoClients(page)

    // An <a>/<button>/[role=button] inside the row anchor is the bug. Any
    // action added back must be a SIBLING of the row link.
    const nested = await page.$$eval('a[href^="/clients/"]', els =>
      els
        .filter(e => {
          const h = e.getAttribute('href') ?? ''
          return /^\/clients\/[^/]+$/.test(h)
            && !['invite', 'import', 'waitlist', 'new'].includes(h.split('/')[2])
        })
        .flatMap(e =>
          Array.from(e.querySelectorAll('a, button, [role="button"]')).map(
            n => `${n.tagName}:${(n.textContent ?? '').trim().slice(0, 40)}`,
          ),
        ),
    )
    expect(nested, 'row links contain no nested interactive elements').toEqual([])

    // And specifically no message affordance: messaging lives on the client's
    // own page now.
    const rowIcons = await page.$$eval('a[href^="/clients/"]', els =>
      els
        .filter(e => {
          const h = e.getAttribute('href') ?? ''
          return /^\/clients\/[^/]+$/.test(h)
            && !['invite', 'import', 'waitlist', 'new'].includes(h.split('/')[2])
        })
        .flatMap(e => Array.from(e.querySelectorAll('svg')).map(s => s.getAttribute('class') ?? '')),
    )
    expect(
      rowIcons.filter(c => /lucide-(mail|message)/.test(c)),
      'no mail/message icon survives in a client row',
    ).toEqual([])
  })

  test('desktop keeps the same single-target row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page, SEED.owner.email, SEED.owner.password)
    await gotoClients(page)

    const [row] = await rowBoxes(page)
    expect(row.w, 'the desktop card is one wide link').toBeGreaterThan(600)

    await page.mouse.click(row.x + row.w - 6, row.y + row.h / 2)
    await page.waitForURL(u => u.pathname === row.href, { timeout: 20_000 })
    expect(new URL(page.url()).pathname).toBe(row.href)
  })
})

// Keeps the filter honest — it is the thing deciding which anchors are rows.
test('the row filter only matches a client profile link', () => {
  const isRow = (h: string) => ROW_HREF.test(h) && !NOT_A_CLIENT.includes(h.split('/')[2])
  expect(isRow('/clients/abc-123')).toBe(true)
  expect(isRow('/clients/invite')).toBe(false)
  expect(isRow('/clients/import')).toBe(false)
  expect(isRow('/clients/waitlist')).toBe(false)
  expect(isRow('/clients/abc-123/packages')).toBe(false)
  expect(isRow('/schedule')).toBe(false)
})
