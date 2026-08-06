import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// Layout guards from the UX audit (docs/audit-ux.md). These pin the MECHANICAL
// house rules — the ones that are cheap to assert and rot silently:
//
//   1. Nothing overflows horizontally, at 390 (phone), 760 (narrow desktop
//      window — the width where globals.css's below-md scrollbar rule has
//      already stopped applying) or 1440.
//   2. An open overlay leaves exactly ONE scrollbar. Karl's standing rule: a
//      panel that scrolls while the page scrolls behind it is two, and it
//      reads as a broken window.
//   3. Keyboard focus is visible on the first control of a form screen.
//
// Taste is NOT tested here — that is what the written audit is for. Everything
// below fails on geometry, so it stays honest without anybody re-reading it.

const PHONE = { width: 390, height: 844 }
const NARROW = { width: 760, height: 560 }
const DESKTOP = { width: 1440, height: 900 }

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

/** How far the document scrolls sideways, and what is sticking out. */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const over = document.documentElement.scrollWidth - vw
    const offenders = (Array.from(document.querySelectorAll('body *')) as HTMLElement[])
      .filter(e => {
        const r = e.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return false
        if (getComputedStyle(e).visibility === 'hidden') return false
        return r.right > vw + 1
      })
      // report only the outermost element of each overflowing chain
      .filter(e => {
        const p = e.parentElement
        return !p || p.getBoundingClientRect().right <= vw + 1
      })
      .slice(0, 6)
      .map(e => {
        const cls = typeof e.className === 'string' ? e.className.split(/\s+/).slice(0, 5).join('.') : ''
        return `${e.tagName.toLowerCase()}${cls ? '.' + cls : ''} → ${Math.round(e.getBoundingClientRect().right)}px`
      })
    return { over, offenders }
  })
}

// The trainer screens a trainer actually lives on, plus the client app's home.
// Not every route in the app — enough that a regression in the shell, the page
// header, a list row or a table shows up here.
const TRAINER_ROUTES = [
  '/dashboard', '/schedule', '/clients', '/enquiries', '/messages',
  '/packages', '/classes', '/products', '/library',
  '/finances', '/reports', '/settings', '/notifications',
]
const CLIENT_ROUTES = ['/home', '/my-sessions', '/my-invoices', '/my-dogs', '/my-profile']

for (const [label, viewport] of [['390', PHONE], ['760', NARROW], ['1440', DESKTOP]] as const) {
  test(`no horizontal overflow on trainer screens at ${label}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await login(page, SEED.owner.email, SEED.owner.password)
    const bad: string[] = []
    for (const route of TRAINER_ROUTES) {
      await page.goto(route)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(400)
      const { over, offenders } = await horizontalOverflow(page)
      if (over > 0) bad.push(`${route} overflows by ${over}px — ${offenders.join(' | ')}`)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })
}

for (const [label, viewport] of [['390', PHONE], ['1440', DESKTOP]] as const) {
  test(`no horizontal overflow on client screens at ${label}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await login(page, SEED.client.email, SEED.client.password)
    const bad: string[] = []
    for (const route of CLIENT_ROUTES) {
      await page.goto(route)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(400)
      const { over, offenders } = await horizontalOverflow(page)
      if (over > 0) bad.push(`${route} overflows by ${over}px — ${offenders.join(' | ')}`)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })
}

test('the phone create sheet leaves one scrollbar, not two', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await login(page, SEED.owner.email, SEED.owner.password)
  // The dashboard, because that is the only screen the "+" is on now (Karl,
  // 2026-08-06: "the plus circle should only be on the home page" — it used to
  // float over every screen, including forms and colour pickers). This test is
  // about the SHEET it opens, so it opens it where it lives.
  await page.goto('/dashboard')
  await page.waitForTimeout(600)

  // The global "+" — React here often ignores Playwright's synthetic clicks,
  // so go through the DOM.
  const opened = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Create"]') as HTMLElement | null
    if (!btn) return false
    btn.click()
    return true
  })
  expect(opened, 'the phone create button should exist at 390px').toBe(true)
  await page.waitForTimeout(700)
  await expect(page.getByRole('dialog', { name: 'Create' })).toBeVisible()

  const scroll = await page.evaluate(() => {
    const bodyLocked = getComputedStyle(document.body).overflow === 'hidden'
      || getComputedStyle(document.documentElement).overflow === 'hidden'
    const pageWouldScroll = document.documentElement.scrollHeight > document.documentElement.clientHeight + 4
    return { bodyLocked, pageWouldScroll }
  })
  // Either the page can't scroll at all behind the sheet, or it is locked.
  expect(scroll.bodyLocked || !scroll.pageWouldScroll,
    'body scroll must be locked while a full-screen overlay is open').toBe(true)
})

test('an open overlay still leaves one scrollbar in a NARROW DESKTOP window', async ({ page }) => {
  // 760×560 is the trap: globals.css hides every scrollbar below md by
  // VIEWPORT width, so a bug that is invisible at 390 shows its rail here.
  await page.setViewportSize(NARROW)
  await login(page, SEED.owner.email, SEED.owner.password)
  // The "+" lives on the home screen only now — see the note above.
  await page.goto('/dashboard')
  await page.waitForTimeout(600)
  const opened = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Create"]') as HTMLElement | null
    if (!btn) return false
    btn.click()
    return true
  })
  expect(opened, 'the create button should exist at 760px').toBe(true)
  await page.waitForTimeout(700)

  const state = await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"][aria-modal="true"], .pm-overlay')
    const bodyLocked = getComputedStyle(document.body).overflow === 'hidden'
      || getComputedStyle(document.documentElement).overflow === 'hidden'
    const pageWouldScroll = document.documentElement.scrollHeight > document.documentElement.clientHeight + 4
    const rails = root
      ? (Array.from(root.querySelectorAll('*')) as HTMLElement[])
          .filter(e => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)
            && e.scrollHeight > e.clientHeight + 4
            && e.offsetWidth - e.clientWidth > 0)
          .map(e => e.tagName.toLowerCase())
      : []
    return { marked: !!root, bodyLocked, pageWouldScroll, rails }
  })
  expect(state.marked, 'the overlay must be .pm-overlay or an aria-modal dialog').toBe(true)
  expect(state.bodyLocked || !state.pageWouldScroll,
    'the page must not scroll behind an open overlay').toBe(true)
  expect(state.rails, `overlay showed its own scrollbar: ${state.rails.join(', ')}`).toEqual([])
})

test('every overlay that scrolls opts into the no-scrollbar net', async ({ page }) => {
  // A scrolling region inside an overlay must have its own bar hidden. The
  // stylesheet does this for `.pm-overlay` and `[role=dialog][aria-modal]`
  // subtrees; anything that portals to <body> WITHOUT either marker keeps a
  // second rail. Assert the marker on the sheet the trainer opens most.
  await page.setViewportSize(PHONE)
  await login(page, SEED.owner.email, SEED.owner.password)
  // The "+" lives on the home screen only now — see the note above.
  await page.goto('/dashboard')
  await page.waitForTimeout(600)
  await page.evaluate(() => (document.querySelector('button[aria-label="Create"]') as HTMLElement)?.click())
  await page.waitForTimeout(700)

  const rails = await page.evaluate(() => {
    const overlay = document.querySelector('[role="dialog"][aria-modal="true"], .pm-overlay')
    if (!overlay) return { found: false, visibleRails: [] as string[] }
    const visibleRails = (Array.from(overlay.querySelectorAll('*')) as HTMLElement[])
      .filter(e => {
        const cs = getComputedStyle(e)
        if (!['auto', 'scroll'].includes(cs.overflowY)) return false
        if (e.scrollHeight <= e.clientHeight + 4) return false
        // offsetWidth - clientWidth is the rail's width; 0 means it's hidden.
        return e.offsetWidth - e.clientWidth > 0
      })
      .map(e => e.tagName.toLowerCase() + '.' + String(e.className).split(/\s+/).slice(0, 4).join('.'))
    return { found: true, visibleRails }
  })
  expect(rails.found, 'the create sheet should be an aria-modal dialog or .pm-overlay').toBe(true)
  expect(rails.visibleRails, rails.visibleRails.join(' | ')).toEqual([])
})

test('keyboard focus is visible on the login form', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto('/login')
  await page.getByLabel('Email address').focus()
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    if (!el) return null
    const cs = getComputedStyle(el)
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
    const ringShadow = cs.boxShadow !== 'none'
    return { outline, ringShadow, tag: el.tagName }
  })
  expect(ring, 'something should hold focus').not.toBeNull()
  expect(ring!.outline || ring!.ringShadow,
    'a focused field must show an outline or a focus ring').toBe(true)
})

test('trainer settings keeps its focus ring on the first control', async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto('/settings')
  await page.waitForTimeout(800)
  const visible = await page.evaluate(() => {
    const field = document.querySelector('main input:not([type=hidden]), main select, main textarea') as HTMLElement | null
    if (!field) return null
    field.focus()
    const cs = getComputedStyle(field)
    return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'
  })
  if (visible === null) test.skip(true, 'no form control on the settings landing tab')
  expect(visible).toBe(true)
})
