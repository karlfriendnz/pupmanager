/**
 * THE EVERYDAY JOBS, DONE THE WAY A TRAINER DOES THEM.
 *
 * Karl, 2026-08-05: *"it should be done on playwright so we can really test can
 * a person do these things"*.
 *
 * The distinction matters and it is the reason this file exists. A day of audits
 * proved the plumbing — no leaks, fields save, money follows a cancellation,
 * every route has a guard. Then Karl asked whether a session date could be
 * edited, and the honest answer was that nobody had tried. An earlier attempt at
 * this swept the same ground through `page.request`, which tests the API and not
 * the person: a screen whose Save button is disabled, whose modal never opens,
 * or whose list does not refresh passes every one of those and is broken for
 * everybody.
 *
 * So: no `page.request` in this file. Click what a trainer clicks, and read what
 * a trainer reads.
 *
 * It runs in the 1am nightly sweep automatically — `nightly-tests.sh` runs the
 * whole e2e suite, so nothing here needs wiring up.
 *
 * Each job is its own test so a failure names the job that broke, not "the CRUD
 * spec". Everything is torn down by the test that made it, because the suite
 * shares one seeded database.
 *
 * EVERY SELECTOR IN HERE WAS READ OFF THE COMPONENT, never guessed. Four
 * earlier attempts at this file died on invented button names, and the truths
 * only reading finds are the ones that matter: "Add product" is a LINK, not a
 * button; a delete confirm is a custom sheet, so page.on('dialog') does nothing
 * and the row quietly survives; a settings tab you aren't on is still in the
 * DOM, just `hidden`. A red test in a suite Karl pushes on is worse than an
 * honest gap — so if a screen can't do the job, it is written up rather than
 * asserted here.
 *
 * Writing it also found four things worth fixing, which are fixed:
 *   • a one-session offering could never be saved from its edit screen (an
 *     invisible-but-validated "Weeks between" field silently blocked the
 *     submit). The 1:1 and event jobs below are the guards on that.
 *   • two screens deleted through window.confirm while the rest of the app used
 *     the house sheet — one action, two faces.
 *   • the add-client, location and email-template fields had loose <label>s
 *     that named nothing. They carry htmlFor/id now, and the jobs below ask for
 *     them BY NAME, which is what keeps it true.
 *   • the calendar's month arrows, and both ends of a session's time row, had
 *     no accessible name at all.
 */
import { test, expect, type Page } from '@playwright/test'
import { PrismaPg } from '@prisma/adapter-pg'
import { SEED, TEST_DATABASE_URL } from './test-db'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function makePrisma(): Promise<any> {
  const { PrismaClient } = await import('../../src/generated/prisma/index.js')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) })
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`

/**
 * Wait for a row to exist, and hand it back.
 *
 * The DB question is always asked FIRST — "did it save at all" and "did it save
 * but the list doesn't show it" are different bugs, and the screen alone cannot
 * tell them apart. A save is a round trip through a route handler, so it is
 * polled rather than read once.
 */
async function until(read: () => Promise<any>, message: string, timeout = 20_000): Promise<any> {
  await expect.poll(async () => ((await read()) ? 'saved' : 'missing'), { timeout, message }).toBe('saved')
  return await read()
}

/** The trainer this whole file works as. */
async function ownerTrainer(prisma: any) {
  return prisma.trainerProfile.findFirstOrThrow({ where: { user: { email: SEED.owner.email } } })
}

test.describe('the jobs a trainer does every day', () => {
  test('open a session from the schedule, move it, and cancel it', async ({ page }) => {
    // The job Karl asked about. Everything here happens on the session screen.
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const title = `Everyday session ${stamp()}`
    let sessionId = ''
    try {
      await signIn(page)
      const trainer = await prisma.trainerProfile.findFirstOrThrow({
        where: { user: { email: SEED.owner.email } },
      })
      const client = await prisma.clientProfile.findFirstOrThrow({
        where: { trainerId: trainer.id },
        select: { id: true, dogId: true },
      })
      const when = new Date(Date.now() + 5 * 864e5)
      when.setUTCHours(9, 0, 0, 0)
      const session = await prisma.trainingSession.create({
        data: {
          trainerId: trainer.id, clientId: client.id, dogId: client.dogId,
          title, scheduledAt: when, durationMins: 60, status: 'UPCOMING',
        },
      })
      sessionId = session.id

      await page.goto(`/sessions/${session.id}`)
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 })

      // ── Cancel it ───────────────────────────────────────────────────────────
      // NOTE (audit T-17): changing the DATE is not possible from this screen.
      // It offers Complete, Invoice, Payment and Delete session — no date, and
      // no reschedule. The date/time editor lives in the Schedule screen's
      // session modal (with a this-session vs this-and-later choice), and you
      // can drag a session to move it there. So the job is doable, just not from
      // the screen called "session", which is where Karl looked for it.
      //
      // Not asserted as absent on purpose: baking the gap into a test makes
      // fixing it fail the suite. Recorded in docs/audit-trainer.md instead.
      const cancel = page.getByRole('button', { name: /cancel session|delete session|^cancel$|^delete$/i }).first()
      expect(
        await cancel.count(),
        'the session screen offers no way to cancel the session',
      ).toBeGreaterThan(0)
    } finally {
      if (sessionId) await prisma.trainingSession.delete({ where: { id: sessionId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('add a product, change its price, delete it — all from the screen', async ({ page }) => {
    // Written from the component rather than guessed at. Three earlier attempts
    // failed on invented button names; the real ones are an "Add product" LINK,
    // a "Name" field, "Create product" / "Save changes", and Delete behind the
    // ⋯ menu ("More actions for this product").
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const name = `Everyday product ${stamp()}`
    try {
      await signIn(page)

      // ── Create ──────────────────────────────────────────────────────────────
      await page.goto('/products')
      await page.getByRole('link', { name: /add product/i }).first().click()
      await page.getByLabel('Name', { exact: true }).fill(name)
      await page.getByRole('button', { name: 'Create product' }).click()

      // Did it save at all? Asked FIRST, because "not saved" and "saved but the
      // shelf does not show it" are different bugs and the screen alone cannot
      // tell them apart.
      const made = await prisma.product.findFirstOrThrow({ where: { name } })

      // And then: can the trainer see it where they would look?
      await page.goto('/products')
      await expect(
        page.getByText(name).first(),
        'the product saved, but it is not on the products screen',
      ).toBeVisible({ timeout: 20_000 })

      // ── Edit ────────────────────────────────────────────────────────────────
      await page.goto(`/products/${made.id}`)
      const renamed = `${name} renamed`
      await page.getByLabel('Name', { exact: true }).fill(renamed)
      await page.getByRole('button', { name: 'Save changes' }).click()

      await expect
        .poll(async () => (await prisma.product.findUnique({ where: { id: made.id } }))?.name, { timeout: 20_000 })
        .toBe(renamed)

      // ── Delete ──────────────────────────────────────────────────────────────
      await page.goto(`/products/${made.id}`)
      await page.getByRole('button', { name: /more actions for this product/i }).click()
      await page.getByRole('button', { name: /delete this product/i }).click()
      // A custom confirm, not window.confirm — so a dialog handler does nothing
      // and the product quietly survives. The kind of thing only clicking finds.
      await page.getByRole('button', { name: 'Delete', exact: true }).click()

      await expect
        .poll(async () => await prisma.product.count({ where: { id: made.id } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      await prisma.product.deleteMany({ where: { name: { startsWith: name.slice(0, 24) } } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('take on a new client and their dog, correct both names, then delete them', async ({ page }) => {
    // The first job on the list in docs/audit-trainer.md, and the one with the
    // most traps: the add-client form's fields carry PLACEHOLDERS, not labels
    // (getByLabel finds nothing), the dog lives behind a tab, and the delete is
    // a custom confirm on the client's own screen.
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const mark = stamp()
    const name = `Everyday Client ${mark}`
    const dogName = `Rufus ${mark}`
    let clientId = ''
    let userId = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)

      // ── Create ──────────────────────────────────────────────────────────────
      // Through the app's one "+" in the top bar, which is how a trainer starts
      // anything. Its accessible name is "Create" (a title, not a label).
      await page.goto('/clients')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Full client' }).click()

      const sheet = page.getByRole('dialog', { name: 'New client' })
      await expect(sheet).toBeVisible({ timeout: 20_000 })
      // getByLabel, not getByPlaceholder: these fields had loose <label>s that
      // named nothing, and now carry htmlFor/id like the rest of the app. Asked
      // for by NAME here on purpose — that is what proves the association is
      // real, and it fails the moment someone drops the htmlFor again.
      await sheet.getByLabel('Client name').fill(name)
      // Contact · Dogs · Invitation email are TABS, not wizard steps — the dog
      // is one tap away and the save works from any of them.
      await sheet.getByRole('button', { name: 'Dogs', exact: true }).click()
      await sheet.getByLabel("Dog's name").fill(dogName)
      // No email on purpose: with one, "Send invitation email" is ticked by
      // default and a real send would be attempted.
      await sheet.getByRole('button', { name: 'Create client' }).click()

      const made = await until(
        () => prisma.clientProfile.findFirst({
          where: { trainerId: trainer.id, user: { name } },
          include: { dog: true, user: true },
        }),
        'the client never reached the database',
      )
      clientId = made.id
      userId = made.userId
      expect(made.dog?.name, 'the dog typed on the Dogs tab was not saved with the client').toBe(dogName)

      // And then: can the trainer see them where they would look? NOT on the
      // tab they land on — Clients opens on "Current", which means "has a
      // session still to come", and somebody added a minute ago has nothing
      // booked. They are one tab over, under "Contacts". Working as designed,
      // and still the first surprise of the job: you add a client and the
      // screen you are returned to does not contain them.
      await page.goto('/clients')
      await page.getByRole('link', { name: /^Contacts/ }).click()
      await expect(
        page.getByText(name).first(),
        'the client saved, but they are on none of the clients tabs',
      ).toBeVisible({ timeout: 20_000 })

      // ── Edit ────────────────────────────────────────────────────────────────
      // The edit screen DOES label its fields, so this half is getByLabel.
      const renamed = `${name} fixed`
      const renamedDog = `${dogName} fixed`
      await page.goto(`/clients/${clientId}/edit`)
      await page.getByLabel("Dog's name").fill(renamedDog)
      await page.getByRole('button', { name: 'Details', exact: true }).click()
      await page.getByLabel('Name', { exact: true }).fill(renamed)
      await page.getByRole('button', { name: 'Save changes' }).click()

      await expect
        .poll(async () => {
          const row = await prisma.clientProfile.findUnique({
            where: { id: clientId },
            include: { user: true, dog: true },
          })
          return `${row?.user?.name} / ${row?.dog?.name}`
        }, { timeout: 20_000 })
        .toBe(`${renamed} / ${renamedDog}`)

      // ── Delete ──────────────────────────────────────────────────────────────
      // On the client's own Overview tab, in a block of its own. Its confirm is
      // this screen's own modal, so a dialog handler would never see it.
      await page.goto(`/clients/${clientId}`)
      await page.getByRole('button', { name: 'Delete client' }).click()
      await page.getByRole('button', { name: 'Yes, delete' }).click()

      await expect
        .poll(async () => await prisma.clientProfile.count({ where: { id: clientId } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (clientId) await prisma.clientProfile.deleteMany({ where: { id: clientId } }).catch(() => {})
      if (userId) await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {})
      await prisma.dog.deleteMany({ where: { name: { startsWith: `Rufus ${mark}` } } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('build a library theme and an item inside it, reword them, then bin them', async ({ page }) => {
    // A category is made in the seed rather than on screen: it is the same
    // "New category" control this test already exercises twice over (the theme
    // and the item both use AddNameInline), and it keeps the Library index's
    // desktop-only rail out of the flow.
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const mark = stamp()
    const themeName = `Everyday theme ${mark}`
    const itemName = `Everyday item ${mark}`
    let typeId = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)
      const type = await prisma.libraryType.create({
        data: { trainerId: trainer.id, name: `Everyday category ${mark}` },
      })
      typeId = type.id

      // ── Create the theme ────────────────────────────────────────────────────
      // "New theme" opens ONE field in place, whose only name is its aria-label.
      await page.goto(`/library/type/${typeId}`)
      await page.getByRole('button', { name: 'New theme' }).click()
      await page.getByLabel('New theme').fill(themeName)
      await page.getByRole('button', { name: 'Add', exact: true }).click()

      const theme = await until(
        () => prisma.libraryTheme.findFirst({ where: { typeId, name: themeName } }),
        'the theme never reached the database',
      )
      await page.waitForURL(`**/library/theme/${theme.id}`, { timeout: 20_000 })

      // ── Create the item inside it ───────────────────────────────────────────
      await page.getByRole('button', { name: 'New item' }).click()
      await page.getByLabel('New item').fill(itemName)
      await page.getByRole('button', { name: 'Add', exact: true }).click()

      const item = await until(
        () => prisma.libraryTask.findFirst({ where: { themeId: theme.id, title: itemName } }),
        'the item never reached the database',
      )
      await page.waitForURL(`**/library/item/${item.id}`, { timeout: 20_000 })

      await page.goto(`/library/theme/${theme.id}`)
      await expect(
        page.getByText(itemName).first(),
        'the item saved, but the theme it belongs to does not list it',
      ).toBeVisible({ timeout: 20_000 })

      // ── Edit the item ───────────────────────────────────────────────────────
      const itemRenamed = `${itemName} reworded`
      await page.goto(`/library/item/${item.id}`)
      await page.getByLabel('Name').fill(itemRenamed)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect
        .poll(async () => (await prisma.libraryTask.findUnique({ where: { id: item.id } }))?.title, { timeout: 20_000 })
        .toBe(itemRenamed)

      // ── Delete the item ─────────────────────────────────────────────────────
      await page.getByRole('button', { name: 'More actions for this item' }).click()
      await page.getByRole('button', { name: /delete this item/i }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect
        .poll(async () => await prisma.libraryTask.count({ where: { id: item.id } }), { timeout: 20_000 })
        .toBe(0)

      // ── Edit the theme ──────────────────────────────────────────────────────
      // A theme is renamed from INSIDE it, behind the gear beside "New item" —
      // there is no pencil on the row that lists it.
      const themeRenamed = `${themeName} reworded`
      await page.goto(`/library/theme/${theme.id}`)
      await page.getByRole('button', { name: 'Theme settings' }).click()
      const panel = page.getByRole('dialog', { name: 'Theme settings' })
      await panel.getByLabel('Name').fill(themeRenamed)
      await panel.getByRole('button', { name: 'Save', exact: true }).click()
      await expect
        .poll(async () => (await prisma.libraryTheme.findUnique({ where: { id: theme.id } }))?.name, { timeout: 20_000 })
        .toBe(themeRenamed)

      // ── Delete the theme ────────────────────────────────────────────────────
      await panel.getByRole('button', { name: /delete this theme/i }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect
        .poll(async () => await prisma.libraryTheme.count({ where: { id: theme.id } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (typeId) await prisma.libraryType.deleteMany({ where: { id: typeId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('design an achievement, reword it, then delete it', async ({ page }) => {
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const name = `Everyday badge ${stamp()}`
    let id = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)

      // ── Create ──────────────────────────────────────────────────────────────
      // "Add achievement" is a LINK to its own page (the editor used to be a
      // modal over a scrolling page — two scrollbars).
      await page.goto('/achievements')
      await page.getByRole('link', { name: 'Add achievement' }).first().click()
      await page.getByLabel('Name', { exact: true }).fill(name)
      await page.getByRole('button', { name: 'Create achievement' }).click()

      const made = await until(
        () => prisma.achievement.findFirst({ where: { trainerId: trainer.id, name } }),
        'the achievement never reached the database',
      )
      id = made.id

      await page.goto('/achievements')
      await expect(
        page.getByText(name).first(),
        'the achievement saved, but it is not on the achievements screen',
      ).toBeVisible({ timeout: 20_000 })

      // ── Edit ────────────────────────────────────────────────────────────────
      const renamed = `${name} reworded`
      await page.goto(`/achievements/${id}`)
      await page.getByLabel('Name', { exact: true }).fill(renamed)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect
        .poll(async () => (await prisma.achievement.findUnique({ where: { id } }))?.name, { timeout: 20_000 })
        .toBe(renamed)

      // ── Delete ──────────────────────────────────────────────────────────────
      // In the ⋯ at the foot of the screen, behind the house confirm sheet —
      // the same shape as every other offering. It used to be a grey line of
      // text under the last field that turned into two buttons in place.
      await page.goto(`/achievements/${id}`)
      await page.getByRole('button', { name: /^More actions/ }).click()
      await page.getByRole('button', { name: /Delete this achievement/ }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect
        .poll(async () => await prisma.achievement.count({ where: { id } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (id) await prisma.achievement.deleteMany({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('add a tag, rename it, then delete it', async ({ page }) => {
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const name = `Everyday tag ${stamp()}`
    let id = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)

      // ── Create ──────────────────────────────────────────────────────────────
      // Arrived at through the OLD url on purpose: Tags moved into Settings
      // (2026-08-06) and /offerings/tags was a menu item for long enough to be
      // in bookmarks and histories, so the redirect is part of the feature.
      await page.goto('/offerings/tags')
      await expect(page, 'the old tags url no longer lands on the tags screen')
        .toHaveURL(/\/settings\?tab=tags/, { timeout: 20_000 })

      // Deliberately two steps — press, then name it — which is what stops
      // "Puppy", "Puppies" and "puppy class" all existing at once.
      await page.getByRole('button', { name: 'New tag' }).click()
      await page.getByLabel('New tag name').fill(name)
      await page.getByRole('button', { name: 'Add', exact: true }).click()

      const made = await until(
        () => prisma.tag.findFirst({ where: { trainerId: trainer.id, name } }),
        'the tag never reached the database',
      )
      id = made.id

      await page.goto('/settings?tab=tags')
      await expect(
        page.getByText(name).first(),
        'the tag saved, but it is not on the tags screen',
      ).toBeVisible({ timeout: 20_000 })

      // ── Edit ────────────────────────────────────────────────────────────────
      // The row itself OPENS the tag; renaming is the pencil beside it, which
      // swaps the row for a field carrying the same aria-label.
      const renamed = `${name} renamed`
      await page.getByRole('button', { name: `Rename ${name}` }).click()
      await page.getByLabel(`Rename ${name}`).fill(renamed)
      await page.getByRole('button', { name: 'Save name' }).click()
      await expect
        .poll(async () => (await prisma.tag.findUnique({ where: { id } }))?.name, { timeout: 20_000 })
        .toBe(renamed)

      // ── Delete ──────────────────────────────────────────────────────────────
      await page.getByRole('button', { name: `Delete ${renamed}` }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete tag' }).click()
      await expect
        .poll(async () => await prisma.tag.count({ where: { id } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (id) await prisma.tag.deleteMany({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('set up a 1:1 offering, change its name, then delete it', async ({ page }) => {
    // Creating an offering is a four-step wizard (Details · Schedule · Pricing ·
    // Settings) because the link already said which kind it is — arriving from
    // /packages skips the "what are you setting up?" question entirely.
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const name = `Everyday 1:1 ${stamp()}`
    let id = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)

      // ── Create ──────────────────────────────────────────────────────────────
      await page.goto('/packages')
      await page.getByRole('link', { name: 'New 1:1 session' }).first().click()
      await page.getByLabel('Name', { exact: true }).fill(name)
      // Only the LAST step's button may save — an Enter keypress or a mid-flow
      // Next can never create the offering behind the trainer's back.
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('button', { name: 'Create offering' }).click()

      const made = await until(
        () => prisma.package.findFirst({ where: { trainerId: trainer.id, name } }),
        'the 1:1 offering never reached the database',
      )
      id = made.id

      await page.goto('/packages')
      await expect(
        page.getByText(name).first(),
        'the offering saved, but it is not on the 1:1 sessions screen',
      ).toBeVisible({ timeout: 20_000 })

      // ── Edit ────────────────────────────────────────────────────────────────
      // Editing drops the wizard: every card at once, one Save changes.
      //
      // This is left on the wizard's DEFAULT of one session on purpose, because
      // that shape used to be uneditable and this is the guard on the fix. A
      // one-off is saved with weeksBetween = 0 (the submit zeroes the cadence);
      // re-opening it rendered the "Weeks between" input — min={1} — inside a
      // container that is only `invisible`, and a hidden control is still a
      // candidate for constraint validation. The browser refused the submit and
      // could not focus the field to say why ("An invalid form control with
      // name='weeksBetween' is not focusable"), so Save changes did nothing at
      // all, with no message. If that ever comes back, this line goes red.
      const renamed = `${name} renamed`
      await page.goto(`/packages/${id}/edit`)
      await page.getByLabel('Name', { exact: true }).fill(renamed)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect
        .poll(async () => (await prisma.package.findUnique({ where: { id } }))?.name, { timeout: 20_000 })
        .toBe(renamed)

      // ── Delete ──────────────────────────────────────────────────────────────
      // From the offering's own screen, behind ⋯ , with a real confirmation.
      // (The edit form ALSO has a Delete, and that one is a window.confirm —
      // two different dialogs for one action, on two screens.)
      await page.goto(`/packages/${id}`)
      // The ⋯ is pinned at the foot of the screen now and names the offering
      // rather than its noun ("More actions for Puppy Basics").
      await page.getByRole('button', { name: /^More actions/ }).click()
      await page.getByRole('button', { name: /delete this package/i }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect
        .poll(async () => await prisma.package.count({ where: { id } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (id) await prisma.package.deleteMany({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('schedule a group class, rename it, then delete it', async ({ page }) => {
    // A group offering saved WITH a start date is scheduled as well as defined —
    // the server creates its class run in the same transaction, which is the
    // only reason it appears on /classes at all. So the date is part of the job,
    // and it is picked from a calendar popover, not typed.
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const name = `Everyday class ${stamp()}`
    let packageId = ''
    let runId = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)

      // ── Create ──────────────────────────────────────────────────────────────
      await page.goto('/classes')
      await page.getByRole('link', { name: 'New class' }).first().click()
      await page.getByLabel('Name', { exact: true }).fill(name)
      await page.getByRole('button', { name: 'Next' }).click()

      // The schedule step. Ten days out so the class is never already Past, and
      // one tap forward when that lands in next month — the month arrows are
      // asked for by name, which they now have.
      const target = new Date(Date.now() + 10 * 864e5)
      const dateField = page.getByRole('button', { name: 'Pick a date' })
      const datePicker = dateField.locator('..')
      await dateField.click()
      if (target.getMonth() !== new Date().getMonth()) {
        await datePicker.getByRole('button', { name: 'Next month' }).click()
      }
      await datePicker.getByRole('button', { name: String(target.getDate()), exact: true }).click()
      // No time set on purpose: picking a day with nothing in the box defaults
      // to 9am, which is what a trainer who never opened the time wheel gets.

      // Six weekly sessions — a real course rather than the default of one.
      // The label carries no htmlFor, so the select is reached through it.
      await page.getByText('Number of sessions', { exact: true }).locator('..')
        .getByRole('combobox').selectOption('6')

      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('button', { name: 'Create offering' }).click()

      const run = await until(
        () => prisma.classRun.findFirst({ where: { trainerId: trainer.id, name } }),
        'the class never reached the database — a group offering with no run appears on no list at all',
      )
      runId = run.id
      packageId = run.packageId

      await page.goto('/classes')
      await expect(
        page.getByText(name).first(),
        'the class saved, but it is not on the classes screen',
      ).toBeVisible({ timeout: 20_000 })

      // ── Edit ────────────────────────────────────────────────────────────────
      // A class is edited through the offering behind it, and the rename has to
      // reach the RUN as well or the trainer's list and the client's booking
      // screen would say different things.
      const renamed = `${name} renamed`
      await page.goto(`/packages/${packageId}/edit`)
      await page.getByLabel('Name', { exact: true }).fill(renamed)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect
        .poll(async () => (await prisma.classRun.findUnique({ where: { id: runId } }))?.name, { timeout: 20_000 })
        .toBe(renamed)

      // ── Delete ──────────────────────────────────────────────────────────────
      // NOTE (for docs/audit-trainer.md): this deletes the RUN. The group
      // offering behind it survives with no run, and /packages only lists
      // `isGroup: false` — so it is on no trainer screen anywhere. Not asserted:
      // baking a gap into a test makes fixing it fail the suite.
      await page.goto(`/classes/${runId}`)
      await page.getByRole('button', { name: 'More actions for this class' }).click()
      await page.getByRole('button', { name: /delete this class/i }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect
        .poll(async () => await prisma.classRun.count({ where: { id: runId } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (packageId) await prisma.package.deleteMany({ where: { id: packageId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('put on a one-off event, rename it, then delete it', async ({ page }) => {
    // The same wizard as a class, but an event has NO cadence — it is always one
    // session — which is exactly the shape that used to be locked out of its own
    // edit screen (see the 1:1 job). So this job is both a real day's work and
    // the second guard on that fix.
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const name = `Everyday event ${stamp()}`
    let packageId = ''
    let runId = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)

      // ── Create ──────────────────────────────────────────────────────────────
      await page.goto('/events')
      await page.getByRole('link', { name: 'New event' }).first().click()
      await page.getByLabel('Name', { exact: true }).fill(name)
      await page.getByRole('button', { name: 'Next' }).click()

      // An event's date and time are stacked and labelled, rather than the
      // class's single "first session" row.
      const target = new Date(Date.now() + 12 * 864e5)
      const dateField = page.getByRole('button', { name: 'Pick a date' })
      const datePicker = dateField.locator('..')
      await dateField.click()
      if (target.getMonth() !== new Date().getMonth()) {
        await datePicker.getByRole('button', { name: 'Next month' }).click()
      }
      await datePicker.getByRole('button', { name: String(target.getDate()), exact: true }).click()

      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('button', { name: 'Next' }).click()
      // No ticket types: the editor always keeps one empty row to type into, and
      // the blanks are dropped rather than failing the save.
      await page.getByRole('button', { name: 'Create offering' }).click()

      const run = await until(
        () => prisma.classRun.findFirst({ where: { trainerId: trainer.id, name } }),
        'the event never reached the database',
      )
      runId = run.id
      packageId = run.packageId
      // What it IS, said outright and stored — not re-derived from its shape.
      // A one-session CLASS used to turn into an event the moment it was saved.
      const pkg = await prisma.package.findUnique({ where: { id: packageId } })
      expect(pkg?.isEvent, 'the offering was created from "New event" but was not saved as one').toBe(true)

      await page.goto('/events')
      await expect(
        page.getByText(name).first(),
        'the event saved, but it is not on the events screen',
      ).toBeVisible({ timeout: 20_000 })

      // ── Edit ────────────────────────────────────────────────────────────────
      const renamed = `${name} renamed`
      await page.goto(`/packages/${packageId}/edit`)
      await page.getByLabel('Name', { exact: true }).fill(renamed)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect
        .poll(async () => (await prisma.classRun.findUnique({ where: { id: runId } }))?.name, { timeout: 20_000 })
        .toBe(renamed)
      // Still an event afterwards. Re-saving used to be able to change what an
      // offering was, which moved it off the list the trainer found it on.
      await expect
        .poll(async () => (await prisma.package.findUnique({ where: { id: packageId } }))?.isEvent, { timeout: 20_000 })
        .toBe(true)

      // ── Delete ──────────────────────────────────────────────────────────────
      await page.goto(`/events/${runId}`)
      await page.getByRole('button', { name: 'More actions for this event' }).click()
      await page.getByRole('button', { name: /delete this event/i }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect
        .poll(async () => await prisma.classRun.count({ where: { id: runId } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (packageId) await prisma.package.deleteMany({ where: { id: packageId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('open a casual class people can drop into, rename it, then delete it', async ({ page }) => {
    // The fourth and last kind of offering. A casual class has no single start
    // date — each session card carries its own day, time and "starts from" — so
    // the wizard drops the pricing step entirely and the schedule IS the form.
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const name = `Everyday casual class ${stamp()}`
    let packageId = ''
    let runId = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)

      // ── Create ──────────────────────────────────────────────────────────────
      await page.goto('/casual-classes')
      await page.getByRole('link', { name: 'New casual class' }).first().click()
      await page.getByLabel('Name', { exact: true }).fill(name)
      await page.getByRole('button', { name: 'Next' }).click()

      // Times start BLANK so nobody publishes a guessed hour by accident, and
      // the form says so in a sentence rather than letting the server reject the
      // shape. Both ends of the row are asked for by name.
      await page.getByLabel('Start time').fill('18:00')
      await page.getByLabel('Finish time').fill('19:00')

      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('button', { name: 'Create offering' }).click()

      const run = await until(
        () => prisma.classRun.findFirst({ where: { trainerId: trainer.id, name } }),
        'the casual class never reached the database',
      )
      runId = run.id
      packageId = run.packageId
      const pkg = await prisma.package.findUnique({
        where: { id: packageId },
        include: { sessionSlots: true },
      })
      expect(pkg?.allowDropIn, 'created from "New casual class" but not saved as one people can drop into').toBe(true)
      expect(pkg?.sessionSlots?.[0]?.startTime, 'the session time typed into the card did not save').toBe('18:00')

      await page.goto('/casual-classes')
      await expect(
        page.getByText(name).first(),
        'the casual class saved, but it is not on the casual classes screen',
      ).toBeVisible({ timeout: 20_000 })

      // ── Edit ────────────────────────────────────────────────────────────────
      const renamed = `${name} renamed`
      await page.goto(`/packages/${packageId}/edit`)
      await page.getByLabel('Name', { exact: true }).fill(renamed)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect
        .poll(async () => (await prisma.classRun.findUnique({ where: { id: runId } }))?.name, { timeout: 20_000 })
        .toBe(renamed)

      // ── Delete ──────────────────────────────────────────────────────────────
      // The sheet calls it a "casual class", not a "class" — the same component
      // serves four screens and takes the noun from the one you are on.
      await page.goto(`/casual-classes/${runId}`)
      await page.getByRole('button', { name: 'More actions for this casual class' }).click()
      await page.getByRole('button', { name: /delete this casual class/i }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect
        .poll(async () => await prisma.classRun.count({ where: { id: runId } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (packageId) await prisma.package.deleteMany({ where: { id: packageId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('jot down a to-do, tick it off, then clear it', async ({ page }) => {
    // The smallest job in the app, and the one a trainer does most often between
    // other things. Three controls, none of them labelled in words: a field, a
    // "+" and a tick that IS a checkbox (role and aria-label, so it can be asked
    // for as one).
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const title = `Everyday to-do ${stamp()}`
    let id = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)

      // ── Create ──────────────────────────────────────────────────────────────
      await page.goto('/sessions/needs-notes?tab=todo')
      await page.getByPlaceholder('Add a to-do…').fill(title)
      await page.getByRole('button', { name: 'Add to-do' }).click()

      const made = await until(
        // companyId, not trainerId — a to-do belongs to the BUSINESS, so a
        // manager sees what the owner wrote down.
        () => prisma.trainerTodo.findFirst({ where: { companyId: trainer.id, title } }),
        'the to-do never reached the database',
      )
      id = made.id
      expect(made.done, 'a brand-new to-do arrived already ticked off').toBe(false)

      await page.goto('/sessions/needs-notes?tab=todo')
      await expect(
        page.getByText(title).first(),
        'the to-do saved, but it is not on the To do screen',
      ).toBeVisible({ timeout: 20_000 })

      // ── Tick it off ─────────────────────────────────────────────────────────
      // The change a to-do has: done. Its row is the one carrying the title.
      const row = page.getByText(title, { exact: true }).locator('xpath=../..')
      await row.getByRole('checkbox', { name: 'Mark as done' }).click()
      await expect
        .poll(async () => (await prisma.trainerTodo.findUnique({ where: { id } }))?.done, { timeout: 20_000 })
        .toBe(true)

      // ── Delete ──────────────────────────────────────────────────────────────
      // NOTE (for docs/audit-trainer.md): the bin only appears on hover, and on
      // a touch screen there is no hover. It still works — it is transparent,
      // not absent — but a trainer on a phone has no way to know it is there.
      await page.goto('/sessions/needs-notes?tab=todo')
      const doneRow = page.getByText(title, { exact: true }).locator('xpath=../..')
      await doneRow.getByRole('button', { name: 'Delete to-do' }).click()
      await expect
        .poll(async () => await prisma.trainerTodo.count({ where: { id } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (id) await prisma.trainerTodo.deleteMany({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('build an intake form, reword it, then delete it', async ({ page }) => {
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const name = `Everyday form ${stamp()}`
    let id = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)

      // ── Create ──────────────────────────────────────────────────────────────
      // "New form" asks what it is FOR first — intake, website enquiry, or a
      // session form — because those are three different jobs, not one form
      // with a flag.
      await page.goto('/settings?tab=forms')
      await page.getByRole('button', { name: 'New form' }).click()
      await page.getByRole('link', { name: /Intake form/ }).click()
      await page.getByLabel('Form name').fill(name)
      // A new form opens with one blank question, and it must be given words:
      // saving without them is refused in a sentence ("Every question needs a
      // label") rather than saving a form that asks nothing.
      // The questions are their own step now (the editor became a wizard on
      // 2026-08-05), so building one means walking to them.
      await page.getByRole('button', { name: /next: the questions/i }).click()
      await page.getByRole('textbox', { name: 'Question 1' }).fill('What are you hoping to work on?')
      await page.getByRole('button', { name: 'Create form' }).click()

      const made = await until(
        () => prisma.form.findFirst({ where: { trainerId: trainer.id, name } }),
        'the form never reached the database',
      )
      id = made.id

      await page.waitForURL('**/settings?tab=forms', { timeout: 20_000 })
      await expect(
        page.getByText(name).first(),
        'the form saved, but it is not listed on the Forms tab it returns you to',
      ).toBeVisible({ timeout: 20_000 })

      // ── Edit ────────────────────────────────────────────────────────────────
      const renamed = `${name} reworded`
      await page.goto(`/forms/client/${id}`)
      await page.getByLabel('Form name').fill(renamed)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect
        .poll(async () => (await prisma.form.findUnique({ where: { id } }))?.name, { timeout: 20_000 })
        .toBe(renamed)

      // ── Delete ──────────────────────────────────────────────────────────────
      // Delete sits at the far LEFT of the footer, away from Cancel and Save,
      // and turns into its own two-button confirm in place.
      await page.goto(`/forms/client/${id}`)
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.getByRole('button', { name: 'Confirm delete' }).click()
      await expect
        .poll(async () => await prisma.form.count({ where: { id } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (id) await prisma.form.deleteMany({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('enrol a client onto a class, then take them off it', async ({ page }) => {
    // The class itself is a fixture — building one through the wizard is its own
    // job, tested above. What is clicked here is the enrolment: the two-step
    // Who / What panel, and the withdrawal off the roster.
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const mark = stamp()
    let packageId = ''
    let runId = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)
      const pkg = await prisma.package.create({
        data: {
          trainerId: trainer.id, name: `Everyday roster class ${mark}`,
          sessionCount: 4, weeksBetween: 1, durationMins: 60, isGroup: true, capacity: 8,
        },
      })
      packageId = pkg.id
      const run = await prisma.classRun.create({
        data: {
          trainerId: trainer.id, packageId: pkg.id, name: pkg.name,
          startDate: new Date(Date.now() + 7 * 864e5), status: 'SCHEDULED',
        },
      })
      runId = run.id

      // ── Enrol ───────────────────────────────────────────────────────────────
      await page.goto(`/classes/${runId}`)
      await page.getByRole('tab', { name: /^Clients/ }).click()
      await page.getByRole('button', { name: 'Enrol client' }).click()

      const modal = page.getByRole('heading', { name: 'Enrol a client' })
      await expect(modal).toBeVisible({ timeout: 20_000 })
      // Step 1 is WHO. Nobody is picked up front on purpose — a pre-selected
      // first name is the wrong client by default, and one stray Enter enrols
      // them. Choosing IS the step, so this moves straight to step 2.
      await page.getByLabel('Search clients').fill(SEED.client.name)
      await page.getByRole('button', { name: new RegExp(SEED.client.name) }).click()
      // Untick the email — the send is stubbed in this suite, but a test should
      // not be asking to email anybody.
      await page.getByLabel(/Notify the client/).uncheck()
      await page.getByRole('button', { name: 'Enrol', exact: true }).click()

      const enrolment = await until(
        () => prisma.classEnrollment.findFirst({ where: { classRunId: runId, clientId: SEED.assignedClientId } }),
        'the enrolment never reached the database',
      )
      expect(enrolment.status, 'enrolling produced a row that is not actually enrolled').not.toBe('WITHDRAWN')

      await page.goto(`/classes/${runId}`)
      await page.getByRole('tab', { name: /^Clients/ }).click()
      // `visible: true` because every tab's panel is in the DOM at once — the
      // one you aren't on is `hidden`, so an unfiltered match finds the client
      // in the Details tab's snapshot and proves nothing about the roster.
      await expect(
        page.getByText(SEED.client.name).filter({ visible: true }).first(),
        'the enrolment saved, but the roster does not show them on it',
      ).toBeVisible({ timeout: 20_000 })

      // ── Withdraw ────────────────────────────────────────────────────────────
      // NOTE (for docs/audit-trainer.md): one click, no confirmation — the only
      // destructive action in this file that doesn't ask. Everything else on a
      // trainer screen opens a sheet and says what goes.
      await page.getByRole('button', { name: 'Withdraw', exact: true }).click()
      await expect
        .poll(async () => {
          const row = await prisma.classEnrollment.findFirst({ where: { classRunId: runId, clientId: SEED.assignedClientId } })
          return row ? row.status : 'gone'
        }, { timeout: 20_000 })
        .toMatch(/WITHDRAWN|gone/)
    } finally {
      if (runId) await prisma.classEnrollment.deleteMany({ where: { classRunId: runId } }).catch(() => {})
      if (runId) await prisma.trainingSession.deleteMany({ where: { classRunId: runId } }).catch(() => {})
      if (runId) await prisma.classRun.deleteMany({ where: { id: runId } }).catch(() => {})
      if (packageId) await prisma.package.deleteMany({ where: { id: packageId } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('write an email template, change its subject, then delete it', async ({ page }) => {
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const name = `Everyday template ${stamp()}`
    let id = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)

      // ── Create ──────────────────────────────────────────────────────────────
      // The way IN is a dropdown, and "+ New template…" is its last option —
      // you look for a template that fits before deciding to write one.
      await page.goto('/settings?tab=emails')
      const picker = page.getByLabel('Choose an email template')
      await expect(picker).toBeEnabled({ timeout: 20_000 })
      await picker.selectOption('__new')

      // exact, because "Welcome to the pack" is a substring of the subject
      // field's own placeholder ("A warm welcome to the pack").
      await page.getByPlaceholder('Welcome to the pack', { exact: true }).fill(name)
      await page.getByPlaceholder('A warm welcome to the pack').fill('Welcome along')
      // The message is rich text, so it is typed into, not filled.
      const body = page.locator('.tiptap-body[contenteditable="true"]:visible').first()
      await body.click()
      await page.keyboard.type('Glad to have you both with us.')
      await page.getByRole('button', { name: 'Create template' }).click()

      const made = await until(
        () => prisma.emailTemplate.findFirst({ where: { trainerId: trainer.id, name } }),
        'the template never reached the database',
      )
      id = made.id

      await page.goto('/settings?tab=emails')
      await expect(
        page.getByLabel('Choose an email template'),
        'the template saved, but it is not in the picker that is the only way back to it',
      ).toContainText(name, { timeout: 20_000 })

      // ── Edit ────────────────────────────────────────────────────────────────
      await page.getByLabel('Choose an email template').selectOption(id)
      await page.getByPlaceholder('A warm welcome to the pack').fill('Welcome along — a few first steps')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect
        .poll(async () => (await prisma.emailTemplate.findUnique({ where: { id } }))?.subject, { timeout: 20_000 })
        .toBe('Welcome along — a few first steps')

      // ── Delete ──────────────────────────────────────────────────────────────
      // The house sheet, like every other destructive action. This was the last
      // window.confirm on a trainer screen — the one dialog a phone renders
      // worst, and the odd one out among the app's confirmations.
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect
        .poll(async () => await prisma.emailTemplate.count({ where: { id } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (id) await prisma.emailTemplate.deleteMany({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })

  test('save a location, correct it, then delete it', async ({ page }) => {
    test.setTimeout(180_000)
    const prisma = await makePrisma()
    const name = `Everyday location ${stamp()}`
    let id = ''
    try {
      await signIn(page)
      const trainer = await ownerTrainer(prisma)

      // ── Create ──────────────────────────────────────────────────────────────
      // "Add location" opens the form; "Save location" submits it. They used to
      // share one name, so the screen had two different controls answering to
      // the same words and only the order they appear in told them apart.
      await page.goto('/settings?tab=locations')
      await page.getByRole('button', { name: 'Add location' }).click()
      await page.getByLabel('Name', { exact: true }).fill(name)
      await page.getByRole('button', { name: 'Save location' }).click()

      const made = await until(
        () => prisma.location.findFirst({ where: { trainerId: trainer.id, name } }),
        'the location never reached the database',
      )
      id = made.id

      const row = () => page.getByText(name, { exact: true }).locator('xpath=../..')
      await expect(
        row(),
        'the location saved, but the Locations tab does not list it',
      ).toBeVisible({ timeout: 20_000 })

      // ── Edit ────────────────────────────────────────────────────────────────
      const renamed = `${name} corrected`
      await row().getByRole('button', { name: 'Edit location' }).click()
      await page.getByLabel('Name', { exact: true }).fill(renamed)
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expect
        .poll(async () => (await prisma.location.findUnique({ where: { id } }))?.name, { timeout: 20_000 })
        .toBe(renamed)

      // ── Delete ──────────────────────────────────────────────────────────────
      // An inline "Delete? Yes / No" on the row, not a blocking dialog.
      const fixed = page.getByText(renamed, { exact: true }).locator('xpath=../..')
      await fixed.getByRole('button', { name: 'Delete location' }).click()
      await fixed.getByRole('button', { name: 'Yes', exact: true }).click()
      await expect
        .poll(async () => await prisma.location.count({ where: { id } }), { timeout: 20_000 })
        .toBe(0)
    } finally {
      if (id) await prisma.location.deleteMany({ where: { id } }).catch(() => {})
      await prisma.$disconnect()
    }
  })
})

test('a SINGLE-session offering can be saved from its edit screen', async ({ page }) => {
  // T-18. A one-session offering is stored with weeksBetween = 0, and its edit
  // screen rendered that 0 in a field with min={1} inside a container that was
  // only `invisible` — visibility:hidden, so the control still took part in
  // constraint validation while being impossible to focus. The browser refused
  // the submit and could not say why: Save changes did nothing at all. No
  // request, no error, no message. One session is the wizard's default, so this
  // was the likeliest offering in the app to hit.
  test.setTimeout(180_000)
  const prisma = await makePrisma()
  const name = `One session ${stamp()}`
  let id = ''
  try {
    await signIn(page)
    const trainer = await prisma.trainerProfile.findFirstOrThrow({
      where: { user: { email: SEED.owner.email } },
    })
    const pkg = await prisma.package.create({
      data: { trainerId: trainer.id, name, sessionCount: 1, weeksBetween: 0, durationMins: 60 },
    })
    id = pkg.id

    await page.goto(`/packages/${id}/edit`)
    const renamed = `${name} renamed`
    await page.getByLabel('Name', { exact: true }).first().fill(renamed)
    await page.getByRole('button', { name: /save/i }).first().click()

    // The proof is the database, because the symptom was a button that looked
    // like it worked and sent nothing.
    await expect
      .poll(async () => (await prisma.package.findUnique({ where: { id } }))?.name, { timeout: 20_000 })
      .toBe(renamed)
  } finally {
    if (id) await prisma.package.delete({ where: { id } }).catch(() => {})
    await prisma.$disconnect()
  }
})

test('a client form is built in numbered steps, and any step is one click away', async ({ page }) => {
  // The client form editor used to be two tabs — Build, and a Settings tab that
  // held "what happens when it comes back". Most people never pressed the second
  // one. It walks in three numbered steps now (Karl, 2026-08-05), and the rail
  // is clickable so editing an existing form is not a four-screen march.
  test.setTimeout(180_000)
  const prisma = await makePrisma()
  const name = `Wizard form ${stamp()}`
  let id = ''
  try {
    await signIn(page)
    const trainer = await prisma.trainerProfile.findFirstOrThrow({
      where: { user: { email: SEED.owner.email } },
    })
    const form = await prisma.form.create({
      data: {
        trainerId: trainer.id, name, usableAsIntake: true, isActive: true,
        questions: [{ id: 'q1', type: 'SHORT_TEXT', label: 'Biggest challenge', required: false }],
        steps: [],
      },
    })
    id = form.id

    await page.goto(`/forms/client/${id}`)

    // Step 1 is the basics, and the form's name is on it.
    await expect(page.getByLabel('Form name')).toBeVisible({ timeout: 20_000 })

    // Forward through the steps by their own names.
    await page.getByRole('button', { name: /next: the questions/i }).click()
    // The question's label is an editable box, not words on the page.
    await expect(page.getByRole('textbox', { name: 'Question 1' }))
      .toHaveValue('Biggest challenge', { timeout: 15_000 })
    // And the basics are NOT also on this step — that was the first bug in this
    // wizard: everything rendered at once and the steps meant nothing.
    await expect(page.getByLabel('Form name')).toHaveCount(0)

    await page.getByRole('button', { name: /next: what happens next/i }).click()
    await expect(page.getByLabel('Heading').first()).toBeVisible({ timeout: 15_000 })

    // And back to the start in ONE click, which is the point of the rail.
    await page.getByRole('button', { name: 'The basics' }).click()
    await expect(page.getByLabel('Form name')).toBeVisible({ timeout: 15_000 })

    // Saving still works from any step.
    const renamed = `${name} renamed`
    await page.getByLabel('Form name').fill(renamed)
    await page.getByRole('button', { name: /save changes/i }).first().click()
    await expect
      .poll(async () => (await prisma.form.findUnique({ where: { id } }))?.name, { timeout: 20_000 })
      .toBe(renamed)
  } finally {
    if (id) await prisma.form.delete({ where: { id } }).catch(() => {})
    await prisma.$disconnect()
  }
})
