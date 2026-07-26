import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// The Library, end to end:
//   • the tree is the navigation spine — the index at phone width IS the tree,
//     and it opens down to an individual item;
//   • a category is renamed from INSIDE it (there is no pencil on its row);
//   • an item lives on its own page, its description is rich text, and the page
//     lists the people who currently have it;
//   • and none of it reaches across tenants.
const LIB = SEED.library

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

function db() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

test('the tree navigates the library from the phone index down to one item', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, SEED.owner.email, SEED.owner.password)

  await page.goto('/templates')
  // Top level only, until you expand it.
  await expect(page.getByRole('link', { name: new RegExp(LIB.typeName) })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(LIB.themeName) })).toHaveCount(0)

  await page.getByRole('button', { name: `Expand ${LIB.typeName}` }).click()
  await expect(page.getByRole('link', { name: new RegExp(LIB.themeName) })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(LIB.themeTwoName) })).toBeVisible()
  // Items are one more level down.
  await expect(page.getByRole('link', { name: new RegExp(LIB.itemTitle) })).toHaveCount(0)

  await page.getByRole('button', { name: `Expand ${LIB.themeName}` }).click()
  await page.getByRole('link', { name: new RegExp(LIB.itemTitle) }).click()

  await page.waitForURL(`**/templates/item/${LIB.itemId}`)
  // The item's own page, opened straight from the tree — no modal in between.
  await expect(page.getByLabel('Name')).toHaveValue(LIB.itemTitle)
})

test('a category is renamed from inside it, not from a pencil on its row', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)

  // The index lists the category but offers no edit affordance on the row.
  await page.goto('/templates')
  await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /rename/i })).toHaveCount(0)

  // You open it, and the name field is in there.
  await page.goto(`/templates/type/${LIB.typeId}`)
  const name = page.getByLabel('Name')
  await expect(name).toHaveValue(LIB.typeName)

  const renamed = `${LIB.typeName} Renamed`
  await name.fill(renamed)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Name saved.')).toBeVisible()

  const prisma = db()
  try {
    const row = await prisma.libraryType.findUnique({ where: { id: LIB.typeId } })
    expect(row?.name).toBe(renamed)
    // Put it back so the tree test above reads the same either way round.
    await prisma.libraryType.update({ where: { id: LIB.typeId }, data: { name: LIB.typeName } })
  } finally {
    await prisma.$disconnect()
  }
})

test('an item is edited on its own page, in rich text, and shows who has it', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto(`/templates/item/${LIB.itemId}`)

  // Its own page — not a modal over the list.
  await expect(page).toHaveURL(new RegExp(`/templates/item/${LIB.itemId}$`))
  await expect(page.getByLabel('Name')).toHaveValue(LIB.itemTitle)

  // The description is a rich-text editor, and the seeded HTML round-trips as
  // real markup (a <strong>, not the literal tag text).
  const editor = page.locator('.tiptap-body[contenteditable="true"]').first()
  await expect(editor).toBeVisible()
  await expect(editor.locator('strong')).toHaveText('sit')

  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Hold for three seconds.')
  await page.getByRole('button', { name: 'Save item' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()

  const prisma = db()
  try {
    const row = await prisma.libraryTask.findUnique({ where: { id: LIB.itemId } })
    expect(row?.description).toContain('Hold for three seconds.')
    // Still HTML, not flattened to text.
    expect(row?.description).toContain('<strong>')
  } finally {
    await prisma.$disconnect()
  }

  // ── Who has this ──────────────────────────────────────────────────────────
  await expect(page.getByText('Nobody has this yet')).toBeVisible()

  await page.getByRole('button', { name: 'Give this to a client' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // The overlay locks the page behind it — never two scrollbars.
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')

  await dialog.getByLabel('Client').selectOption({ label: 'Unassigned Client' })
  // Far future, so this row never lands in another spec's "this week" list.
  await dialog.getByLabel('Date').fill('2031-04-02')
  await dialog.getByRole('button', { name: 'Add to their homework' }).click()

  await expect(page.getByRole('link', { name: /Unassigned Client/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Nobody has this yet')).toHaveCount(0)

  const prisma2 = db()
  try {
    // The homework carries the provenance link — that's what "who has this" reads.
    const handed = await prisma2.trainingTask.findFirst({
      where: { libraryTaskId: LIB.itemId, clientId: SEED.unassignedClientId },
    })
    expect(handed).not.toBeNull()
    // …and it stayed a snapshot: the text was copied, not referenced.
    expect(handed?.title).toBe(LIB.itemTitle)
    await prisma2.trainingTask.deleteMany({ where: { libraryTaskId: LIB.itemId } })
  } finally {
    await prisma2.$disconnect()
  }
})

test('another business’s library is unreachable', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)

  // Deep links at Business B's rows 404 rather than rendering them.
  for (const url of [
    `/templates/item/${LIB.businessBItemId}`,
    `/templates/theme/${LIB.businessBThemeId}`,
  ]) {
    await page.goto(url)
    await expect(page.getByText('Rival', { exact: false })).toHaveCount(0)
    await expect(page.getByText(/404|not found|page could not be found/i).first()).toBeVisible()
  }

  // And the API refuses to mutate them.
  const patched = await page.request.patch(`/api/library/tasks/${LIB.businessBItemId}`, {
    data: { title: 'Hijacked' },
  })
  expect(patched.status()).toBe(404)

  const deleted = await page.request.delete(`/api/library/themes/${LIB.businessBThemeId}`)
  expect(deleted.status()).toBe(404)

  const prisma = db()
  try {
    const item = await prisma.libraryTask.findUnique({ where: { id: LIB.businessBItemId } })
    expect(item?.title).toBe('Rival Item')
  } finally {
    await prisma.$disconnect()
  }
})
