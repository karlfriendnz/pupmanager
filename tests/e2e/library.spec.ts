import { test, expect, type Locator, type Page } from '@playwright/test'
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
  // Save is a labelled button at the TOP right, on the item's heading line —
  // not a control at the foot of the longest screen in the Library.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
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

// ── Organising the categories ───────────────────────────────────────────────
// The order a trainer drags their categories into is the order getLibraryTree
// reads, so it sets the landing grid, the desktop rail and the drill-down on a
// phone. These make their own categories rather than leaning on the seed: the
// specs share one database, and a second seeded category would move counts
// under every other library test.

const TEMP_A = 'E2E Yak Manners'
const TEMP_B = 'E2E Zebra Recall'

async function makeCategory(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/library/types', { data: { name } })
  expect(res.status()).toBe(201)
  return (await res.json()).id as string
}

test('categories are dragged into the order the trainer wants', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, SEED.owner.email, SEED.owner.password)

  // Created in this order, so they arrive at the end of the list in it.
  const yakId = await makeCategory(page, TEMP_A)
  const zebraId = await makeCategory(page, TEMP_B)
  const prisma = db()

  try {
    await page.goto('/library')
    // List view, so the grid is one column and "up" is the row above — in the
    // two-across grid the same keypress means something else.
    await page.getByRole('button', { name: 'List view' }).click()

    const categories = page.getByRole('region', { name: 'Categories' })
    const names = categories.getByRole('link')
    await expect(names.filter({ hasText: TEMP_A })).toBeVisible()

    // Yak was made first, so it sits above Zebra.
    const before = await names.allInnerTexts()
    expect(before.findIndex(t => t.includes(TEMP_A))).toBeLessThan(
      before.findIndex(t => t.includes(TEMP_B)),
    )

    // Dragged by the keyboard rather than the mouse: dnd-kit ships a keyboard
    // sensor for exactly this, and it is the same code path a pointer drag ends
    // in — without the flake of synthesising drag coordinates.
    const zebraIsAbove = async () => {
      const rows = await prisma.libraryType.findMany({
        where: { id: { in: [yakId, zebraId] } },
        select: { id: true, order: true },
      })
      const order = Object.fromEntries(rows.map(r => [r.id, r.order]))
      return order[zebraId]! < order[yakId]!
    }
    await dragUp(page, categories, await names.count() - 1, zebraIsAbove)

    // It stuck in the DATABASE. This is the assertion that matters: an order
    // that only exists in React state is a page that rearranges itself on the
    // next load.
    expect(await zebraIsAbove()).toBe(true)

    // …and the page shows it.
    await expect(async () => {
      const after = await names.allInnerTexts()
      expect(after.findIndex(t => t.includes(TEMP_B))).toBeLessThan(
        after.findIndex(t => t.includes(TEMP_A)),
      )
    }).toPass({ timeout: 10_000 })

    // And a fresh load agrees — the rail reads the same `order` the grid does.
    await page.reload()
    await expect(async () => {
      const reloaded = await page.getByRole('region', { name: 'Categories' }).getByRole('link').allInnerTexts()
      expect(reloaded.findIndex(t => t.includes(TEMP_B))).toBeLessThan(
        reloaded.findIndex(t => t.includes(TEMP_A)),
      )
    }).toPass({ timeout: 10_000 })
  } finally {
    await prisma.libraryType.deleteMany({ where: { id: { in: [yakId, zebraId] } } })
    await prisma.$disconnect()
  }
})

/**
 * Lift the row at `index`, move it one place up, drop it — and keep trying
 * until `landed` says it worked.
 *
 * By the keyboard rather than the mouse: dnd-kit ships a keyboard sensor for
 * exactly this and it ends in the same onDragEnd a pointer drag does, without
 * the flake of synthesised drag coordinates.
 *
 * The retry is not superstition. dnd-kit measures every droppable rect after
 * the lift, and an arrow key that arrives before those measurements exist moves
 * nothing — the row lifts, the drop commits it exactly where it was, and the
 * test fails on an order that never changed. Waiting longer only makes that
 * rarer. A drop that moved nothing is a no-op, so re-running it is safe, and
 * `landed` stops the loop the moment the move is real.
 */
async function dragUp(page: Page, scope: Locator, index: number, landed: () => Promise<boolean>) {
  const grips = scope.getByRole('button', { name: 'Drag to reorder' })
  for (let attempt = 0; attempt < 3; attempt++) {
    const grip = grips.nth(index)
    await grip.focus()
    await page.keyboard.press('Space')
    await expect(grip).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(300)
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(300)
    await page.keyboard.press('Space')
    await expect(scope.getByRole('button', { name: 'Drag to reorder', pressed: true })).toHaveCount(0)
    await page.waitForTimeout(300)
    if (await landed()) return
  }
  throw new Error('the row never moved, after three attempts')
}

test('the themes inside a category are dragged into order', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, SEED.owner.email, SEED.owner.password)
  const prisma = db()

  try {
    const wasFirst = await prisma.libraryTheme.findMany({
      where: { typeId: LIB.typeId },
      orderBy: { order: 'asc' },
      select: { id: true },
    })

    await page.goto(`/library/type/${LIB.typeId}`)
    // Page-wide is safe to scope to: the rail's tree has no grips, so the only
    // "Drag to reorder" buttons on screen are this list's.
    await expect(page.locator('a[href^="/library/theme/"]').first()).toBeVisible()

    // The second theme in the list, moved above the first.
    const second = wasFirst[1]!.id
    const firstIsSecond = async () => {
      const now = await prisma.libraryTheme.findMany({
        where: { typeId: LIB.typeId },
        orderBy: { order: 'asc' },
        select: { id: true },
      })
      return now[0]!.id === second
    }
    await dragUp(page, page.locator('body'), 1, firstIsSecond)
    expect(await firstIsSecond()).toBe(true)
  } finally {
    // Put the seeded order back — the specs share one database.
    await prisma.libraryTheme.update({ where: { id: LIB.themeId }, data: { order: 0 } })
    await prisma.libraryTheme.update({ where: { id: LIB.themeTwoId }, data: { order: 1 } })
    await prisma.$disconnect()
  }
})

test('the items inside a theme are dragged into order', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, SEED.owner.email, SEED.owner.password)
  const prisma = db()

  // Its own item to drag, so the seeded one keeps the position other specs
  // expect to find it in.
  const made = await page.request.post('/api/library/tasks', {
    data: { themeId: LIB.themeId, title: 'E2E Second Item' },
  })
  expect(made.ok()).toBeTruthy()
  const madeId = (await made.json()).id as string

  try {
    await page.goto(`/library/theme/${LIB.themeId}`)
    // .first(): the rail's tree links at the same item, so the page carries two
    // links to it. Both are meant to be there.
    const items = page.locator('a[href^="/library/item/"]')
    await expect(items.filter({ hasText: 'E2E Second Item' }).first()).toBeVisible()

    // The new item lands at the end; drag it above the seeded one.
    const newOneIsFirst = async () => {
      const rows = await prisma.libraryTask.findMany({
        where: { themeId: LIB.themeId },
        orderBy: { order: 'asc' },
        select: { id: true },
      })
      return rows[0]!.id === madeId
    }
    await dragUp(page, page.locator('body'), 1, newOneIsFirst)
    expect(await newOneIsFirst()).toBe(true)
  } finally {
    await prisma.libraryTask.deleteMany({ where: { id: madeId } })
    await prisma.libraryTask.update({ where: { id: LIB.itemId }, data: { order: 0 } })
    await prisma.$disconnect()
  }
})

test('an item is duplicated and deleted from the ⋯ menu', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const prisma = db()
  let copyId: string | null = null

  try {
    await page.goto(`/library/item/${LIB.itemId}`)

    // Delete is no longer a permanent red row at the foot of the page.
    await expect(page.getByRole('button', { name: /^Delete this item$/ })).toHaveCount(0)

    // ── Duplicate ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'More actions for this item' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    // The sheet locks the page behind it — never two scrollbars.
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
    await page.getByRole('button', { name: /Duplicate this item/ }).click()

    // It lands on the copy, which carries everything but the name.
    await page.waitForURL(/\/library\/item\/(?!e2elibitem)/, { timeout: 15_000 })
    await expect(page.getByLabel('Name')).toHaveValue(`${LIB.itemTitle} (copy)`)

    copyId = new URL(page.url()).pathname.split('/').pop()!
    const copy = await prisma.libraryTask.findUnique({ where: { id: copyId } })
    const original = await prisma.libraryTask.findUnique({ where: { id: LIB.itemId } })
    expect(copy?.themeId).toBe(original!.themeId)
    expect(copy?.description).toBe(original!.description)
    // Directly below the original, not dumped at the end of the theme.
    expect(copy?.order).toBe(original!.order + 1)

    // ── Delete ───────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'More actions for this item' }).click()
    await page.getByRole('button', { name: /Delete this item/ }).click()

    // It asks first, in a sentence — not window.confirm, and not on one tap.
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('Homework already handed out')
    await confirm.getByRole('button', { name: 'Delete' }).click()

    await page.waitForURL(`**/library/theme/${LIB.themeId}`, { timeout: 15_000 })
    await expect(async () => {
      expect(await prisma.libraryTask.findUnique({ where: { id: copyId! } })).toBeNull()
    }).toPass({ timeout: 10_000 })
    copyId = null

    // The original is untouched.
    expect(await prisma.libraryTask.findUnique({ where: { id: LIB.itemId } })).not.toBeNull()
  } finally {
    if (copyId) await prisma.libraryTask.deleteMany({ where: { id: copyId } })
    await prisma.$disconnect()
  }
})

test('another business’s item cannot be cloned', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const prisma = db()

  try {
    const before = await prisma.libraryTask.count()
    const res = await page.request.post(`/api/library/tasks/${LIB.businessBItemId}/clone`, { data: {} })
    expect(res.status()).toBe(404)
    // Nothing was created — not even into Business A's own library.
    expect(await prisma.libraryTask.count()).toBe(before)
  } finally {
    await prisma.$disconnect()
  }
})

test('another business’s themes and items cannot be reordered', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const prisma = db()

  try {
    const theirItem = await prisma.libraryTask.findUnique({
      where: { id: LIB.businessBItemId },
      select: { order: true },
    })

    const themes = await page.request.post('/api/library/themes/reorder', {
      data: { ids: [LIB.businessBThemeId] },
    })
    expect(themes.status()).toBe(404)

    // …and smuggled in beside one Business A really does own.
    const mixed = await page.request.post('/api/library/tasks/reorder', {
      data: { ids: [LIB.businessBItemId, LIB.itemId] },
    })
    expect(mixed.status()).toBe(404)

    const after = await prisma.libraryTask.findUnique({
      where: { id: LIB.businessBItemId },
      select: { order: true },
    })
    expect(after!.order).toBe(theirItem!.order)
  } finally {
    await prisma.$disconnect()
  }
})

test('another business’s categories cannot be reordered', async ({ page }) => {
  await login(page, SEED.owner.email, SEED.owner.password)
  const prisma = db()

  try {
    // Business B's category, reached through the theme the seed pins.
    const theirs = await prisma.libraryTheme.findUnique({
      where: { id: LIB.businessBThemeId },
      select: { typeId: true },
    })
    const theirTypeId = theirs!.typeId
    const wasOrder = (await prisma.libraryType.findUnique({
      where: { id: theirTypeId }, select: { order: true },
    }))!.order

    // Alone, it is simply not found.
    const alone = await page.request.post('/api/library/types/reorder', { data: { ids: [theirTypeId] } })
    expect(alone.status()).toBe(404)

    // And smuggled in beside a category Business A really does own, the whole
    // request is refused — not partly applied to the caller's own rows.
    const mixed = await page.request.post('/api/library/types/reorder', {
      data: { ids: [theirTypeId, LIB.typeId] },
    })
    expect(mixed.status()).toBe(404)

    const after = await prisma.libraryType.findUnique({
      where: { id: theirTypeId }, select: { order: true },
    })
    expect(after!.order).toBe(wasOrder)
  } finally {
    await prisma.$disconnect()
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
