import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

/**
 * Karl: "add a check box to the clients page to allow the ability of selecting
 * them, and when you do an action button shows up to email them or send them a
 * message, and then take them to the relevant step to do that."
 *
 * Three things this pins down, because all three are easy to get subtly wrong:
 *
 *  - There is a way INTO selection on a phone. There was a Select button, but
 *    the whole toolbar it lived in was `hidden md:flex`, so on the layout Karl
 *    uses there was no checkbox anywhere on the page.
 *  - "Message them" is honest about the message model. A thread is one client
 *    (`/messages?client=<id>`) and there is no group conversation in the
 *    schema, so Message hands off only when exactly one person is picked, and
 *    says why when more are. It must never look like it sent to six people.
 *  - The action bar clears the phone's bottom tab bar. The app reserves it with
 *    pb-[calc(5rem+safe-area)]; a fixed bar that ignores that covers the last
 *    client in the list.
 */

const PHONE = { width: 390, height: 844 }

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

// The clients list gained Current / Past / Contacts tabs, and the default
// "Current" only lists people booked onto something still to come — so it is
// empty for seeded data and every row query found nothing. ?tab=never is the
// Contacts view: everyone on the list. Navigating by URL rather than clicking
// the tab keeps this independent of how the tab row is rendered.
/** Enter selection mode from whichever control this width offers. */
async function startSelecting(page: Page) {
  // The button READS "Select", but its aria-label — which is what an
  // accessible-name query matches — is the fuller "Select clients to email".
  // Matching the visible text alone found nothing.
  const select = page.getByRole('button', { name: 'Select clients to email' }).first()
  await expect(select).toBeVisible()
  await select.click()
  // Each row renders a checkbox for both layouts (the desktop grid one is
  // `hidden` at 390px), so wait on the row control, not on `.first()` box.
  await expect(page.getByTestId('client-select-row').first()).toBeVisible()
  expect(await page.getByTestId('client-checkbox').count()).toBeGreaterThan(0)
}

test.describe('clients — pick some, then act on them', () => {
  test.use({ viewport: PHONE })

  test('a phone can select at all, and one pick offers both Email and Message', async ({ page }) => {
    await login(page)
    await page.goto('/clients?tab=never')

    await startSelecting(page)
    const rows = page.getByTestId('client-select-row')
    expect(await rows.count()).toBeGreaterThan(0)

    // Nothing picked: no action bar. The bar is the answer to "you have
    // selected something", so it must not sit there empty.
    await expect(page.getByText(/\d+ selected/)).toHaveCount(0)

    await rows.first().click()
    await expect(page.getByText('1 selected')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Email' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Message' })).toBeEnabled()

    // Message takes you to that client's existing thread — the relevant step,
    // not a new screen of our own.
    await page.getByRole('button', { name: 'Message' }).click()
    await page.waitForURL(/\/messages\?client=/, { timeout: 30_000 })
  })

  test('Message on several clients starts a group with them', async ({ page }) => {
    await login(page)
    await page.goto('/clients?tab=never')
    await startSelecting(page)

    const rows = page.getByTestId('client-select-row')
    if (await rows.count() < 2) test.skip(true, 'needs two clients on the Active tab')

    await rows.nth(0).click()
    await rows.nth(1).click()
    await expect(page.getByText('2 selected')).toBeVisible()

    // Messaging several people used to be refused ("one client at a time").
    // It now starts a GROUP with exactly those people — the selection is
    // handed straight to the composer rather than asking the trainer to tick
    // the same clients again.
    await expect(page.getByRole('button', { name: 'Email' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Message' })).toBeEnabled()
    await expect(page.getByText('Starts a group with these 2')).toBeVisible()

    await page.getByRole('button', { name: 'Message' }).click()
    const composer = page.getByTestId('group-composer')
    await expect(composer).toBeVisible()
    // Straight to the mode question — the audience is already decided.
    await expect(composer.getByTestId('mode-broadcast')).toBeVisible()
    await expect(composer.getByTestId('mode-community')).toBeVisible()
  })

  test('the action bar clears the bottom tab bar instead of covering the last client', async ({ page }) => {
    await login(page)
    await page.goto('/clients?tab=never')
    await startSelecting(page)
    await page.getByTestId('client-select-row').first().click()
    await expect(page.getByText('1 selected')).toBeVisible()

    const gap = await page.evaluate(() => {
      const bar = Array.from(document.querySelectorAll('div'))
        .find(d => getComputedStyle(d).position === 'fixed'
          && !!d.textContent?.includes('selected')
          && d.getBoundingClientRect().bottom >= window.innerHeight - 1)
      if (!bar) return null
      const email = Array.from(bar.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Email')
      if (!email) return null
      // How much room is left under the buttons — it has to cover the 5rem
      // (80px) tab bar the shell reserves, plus the safe-area inset.
      return window.innerHeight - email.getBoundingClientRect().bottom
    })
    expect(gap).not.toBeNull()
    expect(gap!).toBeGreaterThanOrEqual(80)
  })

  test('Select all takes what is on screen, and the selection survives a tab change', async ({ page }) => {
    await login(page)
    await page.goto('/clients?tab=never')
    await startSelecting(page)

    // The control names the number it will take, and that number is the number
    // of rows rendered — never "everyone in the database".
    const selectAll = page.getByRole('button', { name: /^Select all \(\d+\)$/ })
    const label = (await selectAll.textContent())!
    const promised = Number(label.match(/\((\d+)\)/)![1])
    expect(promised).toBe(await page.getByTestId('client-select-row').count())

    await selectAll.click()
    await expect(page.getByText(`${promised} selected`)).toBeVisible()

    // Switching to a tab those clients aren't on keeps them picked and says how
    // many are off screen — the alternative (silently dropping them) sends to
    // five of the six you chose and never tells you.
    // "Past", not "Archived": the Archived tab only renders when something is
    // actually archived, and the seed has nothing. Any tab these clients are
    // NOT on proves the same thing — the picks survive and are still counted.
    await page.getByRole('link', { name: /^Past/ }).click()
    await page.waitForURL(/tab=past/, { timeout: 30_000 })
    await expect(page.getByText(`${promised} selected`)).toBeVisible()
    await expect(page.getByText(/not shown here — still included/)).toBeVisible()

    // Clearing it clears it everywhere, including the stored copy.
    await page.getByRole('button', { name: 'Clear selection' }).click()
    await expect(page.getByText(/\d+ selected/)).toHaveCount(0)
    expect(await page.evaluate(() => window.sessionStorage.getItem('pm.clients.selection'))).toBeNull()
  })

  test('Email opens the bulk composer with the people you picked', async ({ page }) => {
    await login(page)
    await page.goto('/clients?tab=never')
    await startSelecting(page)
    await page.getByTestId('client-select-row').first().click()
    await page.getByRole('button', { name: 'Email' }).click()

    // The existing composer, reached with the selection carried through — not a
    // second sending path built for this button.
    await expect(page.getByRole('dialog', { name: /Email clients/i })).toBeVisible()
  })
})

test.describe('clients — the same selection on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('the toolbar Select reveals checkboxes and the bar offers both actions', async ({ page }) => {
    await login(page)
    await page.goto('/clients?tab=never')

    // Desktop enters selection from the toolbar beside the search field.
    await page.getByRole('button', { name: /Select clients to email/ }).click()
    await page.getByTestId('client-select-row').first().click()

    await expect(page.getByText('1 selected')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Email' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Message' })).toBeEnabled()

    // One way out, not two: the toolbar's Select turns into Done, so the list
    // header's phone-only Done must stay hidden here rather than doubling it.
    await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(1)
  })
})
