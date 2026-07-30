import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

// The Library, end to end:
//   • it lives at /library now, and the old /templates links still get there;
//   • the landing screen is a grid of categories you drill down from, with the
//     tree as the desktop rail beside it;
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

test('the old /templates library links still land on the library', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)

  // The Library's old home. It still hosts the unrelated training-template
  // screens, so this has to redirect rather than 404 — bookmarks and in-app
  // links pointed here for a long time.
  await page.goto('/templates')
  await expect(page).toHaveURL(/\/library$/)
  // .first(): at desktop width a category is legitimately linked twice — once
  // from the left-hand tree and once from the landing grid. Both are meant to
  // be there, so this asserts the redirect landed on a page showing the
  // library, not that only one link exists.
  await expect(page.getByRole('link', { name: new RegExp(LIB.typeName) }).first()).toBeVisible()

  // …and the training-template screens under it are untouched by the move.
  await page.goto('/templates/new')
  await expect(page).toHaveURL(/\/templates\/new$/)
})

test('the phone landing screen is a grid of categories that drills down to an item', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, SEED.owner.email, SEED.owner.password)

  await page.goto('/library')
  // A tile per top-level category, carrying what's inside it — not a bare label.
  const tile = page.getByRole('link', { name: new RegExp(LIB.typeName) })
  await expect(tile).toBeVisible()
  await expect(tile).toContainText(/theme/)
  await expect(tile).toContainText(/item/)
  // The tree is the desktop rail — a phone drills in instead.
  await expect(page.getByRole('button', { name: `Expand ${LIB.typeName}` })).toHaveCount(0)

  await tile.click()
  await page.waitForURL(`**/library/type/${LIB.typeId}`)
  await expect(page.getByRole('link', { name: new RegExp(LIB.themeName) })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(LIB.themeTwoName) })).toBeVisible()

  await page.getByRole('link', { name: new RegExp(LIB.themeName) }).click()
  await page.waitForURL(`**/library/theme/${LIB.themeId}`)
  await page.getByRole('link', { name: new RegExp(LIB.itemTitle) }).click()

  await page.waitForURL(`**/library/item/${LIB.itemId}`)
  // The item's own page — no modal in between.
  await expect(page.getByLabel('Name')).toHaveValue(LIB.itemTitle)
})

test('the desktop tree opens the library from the rail, expanded to where you are', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, SEED.owner.email, SEED.owner.password)

  await page.goto('/library')
  const rail = page.getByRole('complementary')
  // Top level only, until you expand it.
  await expect(rail.getByRole('link', { name: new RegExp(LIB.typeName) })).toBeVisible()
  await expect(rail.getByRole('link', { name: new RegExp(LIB.themeName) })).toHaveCount(0)

  await rail.getByRole('button', { name: `Expand ${LIB.typeName}` }).click()
  await expect(rail.getByRole('link', { name: new RegExp(LIB.themeName) })).toBeVisible()
  await expect(rail.getByRole('link', { name: new RegExp(LIB.itemTitle) })).toHaveCount(0)

  await rail.getByRole('button', { name: `Expand ${LIB.themeName}` }).click()
  await rail.getByRole('link', { name: new RegExp(LIB.itemTitle) }).click()
  await page.waitForURL(`**/library/item/${LIB.itemId}`)

  // Landing on an item, the rail is already open at that item — the active path
  // comes from the URL, not from anything the page threads down.
  await expect(rail.getByRole('link', { name: new RegExp(LIB.itemTitle) })).toBeVisible()
})

test('a category is renamed from inside it, not from a pencil on its row', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)

  // The index lists the category but offers no edit affordance on the row.
  await page.goto('/library')
  await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /rename/i })).toHaveCount(0)

  // You open it, and the name field is in there.
  await page.goto(`/library/type/${LIB.typeId}`)
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
    // Put it back so the grid/tree tests above read the same either way round.
    await prisma.libraryType.update({ where: { id: LIB.typeId }, data: { name: LIB.typeName } })
  } finally {
    await prisma.$disconnect()
  }
})

test('an item is edited on its own page, in rich text, and shows who has it', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  await page.goto(`/library/item/${LIB.itemId}`)

  // Its own page — not a modal over the list.
  await expect(page).toHaveURL(new RegExp(`/library/item/${LIB.itemId}$`))
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

  // The client list is a searchable, alphabetical list of rows, not a <select> —
  // a dropdown at a few hundred clients is unscannable, so this matches the class
  // enrol flow. Driven the way a trainer does it: type, then tap the row.
  await dialog.getByLabel('Client').fill('Unassigned')
  await dialog.getByRole('button', { name: /Unassigned Client/ }).click()
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
    `/library/item/${LIB.businessBItemId}`,
    `/library/theme/${LIB.businessBThemeId}`,
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
