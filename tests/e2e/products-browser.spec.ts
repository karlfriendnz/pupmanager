import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// The shop's browse screen: shelves on the left, what is on the shelf on the
// right, and a drag between the two that MOVES a product.
//
// Worth a test of its own because the move is the one action here with no
// button behind it — there is no other way to file a product from this screen,
// so if the drop stops landing nothing on the page says so.

test.describe.configure({ mode: 'serial' })

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  await page.setViewportSize({ width: 1500, height: 800 })
}

test('a product dragged onto a category stays there', async ({ page }) => {
  await signIn(page)

  const shelf = await page.request
    .post('/api/products/categories', { data: { name: 'Drag Target' } })
    .then(r => r.json())
  expect(shelf.id).toBeTruthy()
  await page.request.post('/api/products', {
    data: { name: 'Draggable widget', kind: 'PHYSICAL', priceCents: 1234 },
  })

  await page.goto('/products')
  const row = page.getByTestId('product-row').filter({ hasText: 'Draggable widget' })
  await expect(row).toBeVisible()

  const grip = row.getByRole('button', { name: 'Drag to reorder' })
  const target = page.getByRole('button', { name: /^Drag Target/ })
  const from = await grip.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('drag handle or shelf not laid out')

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // Past the 6px activation threshold first, then onto the shelf.
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 8 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 })
  await page.mouse.up()

  // The count on the rail is the optimistic half; the reload is the real one.
  await expect(target).toContainText('1')
  await page.reload()
  await page.getByRole('button', { name: /^Drag Target/ }).click()
  await expect(page.getByTestId('product-row').filter({ hasText: 'Draggable widget' })).toBeVisible()
})

test('a new category appears on the rail without leaving the page', async ({ page }) => {
  await signIn(page)
  await page.goto('/products')

  await page.getByRole('button', { name: 'New category' }).click()
  await page.getByPlaceholder('Category name').fill('Made Inline')
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  await expect(page.getByRole('button', { name: /^Made Inline/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: /^Made Inline/ })).toBeVisible()
})
