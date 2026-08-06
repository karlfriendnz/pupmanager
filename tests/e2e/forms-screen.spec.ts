import { test, expect, type Page } from '@playwright/test'
import { SEED } from './test-db'

// The Forms screen (Settings → Fields & forms → Forms) and the one editor every
// kind of form now wears:
//
//  1. the sub-tabs and the single action button share ONE row
//  2. "New form" → a full-screen chooser → the same page editor, whichever
//     kind you pick (this used to be a two-pane modal for session forms and a
//     page for lead-capture ones)
//  3. a form row IS the edit affordance — the duplicate pencil is gone
//  4. another tenant can't open the editor for your form
//
// Everything this spec creates it deletes again — the suite shares one seeded
// database and one trainer.

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test.describe('forms screen — owner happy path', () => {
  // REMOVED: 'tabs and the new-form action sit on one line'. It measured the
  // forms/fields sub-tab pair against the New form action. The Fields tab went
  // on 2026-07-30 (59a7104) and the field library is a row in the forms list
  // now, so there is no tab row left for the action to line up with.

  test('owner builds a session form on the shared editor page and it persists', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // Give the owner a field to link a question to.
    const fieldLabel = `Confidence ${Date.now()}`
    const created = await page.request.post('/api/custom-fields', {
      data: { label: fieldLabel, type: 'TEXT', appliesTo: 'DOG' },
    })
    expect(created.ok()).toBeTruthy()
    const fieldId = (await created.json()).id as string

    await page.goto('/settings?tab=forms&view=forms')

    // One door for every kind of form — a full screen, not a menu.
    await page.getByRole('button', { name: 'New form' }).click()
    await page.waitForURL('**/forms/new')
    // Two doors, split by who fills the form in. "Lead-capture form" used to be
    // a third; a client form set to "Website enquiry" replaced it.
    await expect(page.getByRole('link', { name: /Session form/ })).toBeVisible()
    // "Client form" is called "Intake form" now, and the website-enquiry door
    // is back as its own choice rather than a setting on a client form.
    await expect(page.getByRole('link', { name: /Intake form/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Website enquiry form/ })).toBeVisible()
    await page.getByRole('link', { name: /Session form/ }).click()
    await page.waitForURL('**/forms/session/new')

    const formName = `Editor form ${Date.now()}`
    await page.getByLabel('Form name').fill(formName)
    await page.getByLabel('Question 1', { exact: true }).fill('How did the session go?')

    // A linked field comes from a full-screen picker, not a dropdown.
    await page.getByRole('button', { name: 'Link a field' }).click()
    const picker = page.getByRole('dialog', { name: 'Link a client field' })
    await expect(picker).toBeVisible()
    await picker.getByRole('button', { name: new RegExp(fieldLabel) }).click()
    await expect(picker).toBeHidden()
    await expect(page.locator('[data-question-row]')).toHaveCount(2)

    const [res] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/session-forms') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create form' }).click(),
    ])
    expect(res.ok()).toBeTruthy()

    // Back on the list, described in one line, with no second "edit" control.
    await page.waitForURL('**/settings**')
    const row = page.getByRole('link', { name: new RegExp(formName) })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row).toContainText('2 questions')
    await expect(page.getByRole('button', { name: 'Edit form' })).toHaveCount(0)

    // The row itself opens the editor.
    await row.click()
    await page.waitForURL('**/forms/session/**')
    await expect(page.getByLabel('Form name')).toHaveValue(formName)

    // Clean up — delete the form from the editor, then the field via the API.
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/session-forms/') && r.request().method() === 'DELETE'),
      page.getByRole('button', { name: 'Confirm delete' }).click(),
    ])
    await expect(page.getByRole('link', { name: new RegExp(formName) })).toHaveCount(0, { timeout: 10_000 })
    await page.request.delete(`/api/custom-fields/${fieldId}`)
  })

  test('owner builds a client form on the same editor, with a conditional question', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/settings?tab=forms&view=forms')

    await page.getByRole('button', { name: 'New form' }).click()
    await page.waitForURL('**/forms/new')
    await page.getByRole('link', { name: /Intake form/ }).click()
    // The route still ends /forms/client/new but now carries ?use=intake, so a
    // strict glob no longer matches.
    await page.waitForURL(/\/forms\/client\/new/)

    const formName = `Client form ${Date.now()}`
    await page.getByLabel('Form name').fill(formName)

    // It is an intake form by default; also publish it as a website enquiry so
    // both halves of the model get exercised. Both switches are on step 1 —
    // "Where it's used" is part of the basics now, not a settings panel.
    await page.getByRole('switch', { name: 'Website enquiry form' }).click()

    // A client form is built in a THREE-STEP WIZARD now (the basics → the
    // questions → what happens next), so the questions are one step in.
    await page.getByRole('button', { name: 'Next: The questions' }).click()

    // Question 1 → a dropdown, so question 2 has something to branch on.
    await page.getByLabel('Question 1', { exact: true }).fill('Has your dog been groomed before?')
    await page.getByLabel('Answer type for question 1').selectOption('DROPDOWN')
    // exact: true — "Option 1" also matches the "Remove option 1" button.
    await page.getByLabel('Option 1', { exact: true }).fill('Yes')
    await page.getByLabel('Option 2', { exact: true }).fill('No')

    // The wizard has no palette rail to drag from, so "Add question" opens the
    // full-screen picker rather than appending a blank long-text box — it is
    // the one and only door, and a door that guessed would be a trap.
    await page.getByRole('button', { name: 'Add question' }).click()
    const palette = page.getByRole('dialog', { name: /Add a question/ })
    await expect(palette).toBeVisible()
    await palette.getByRole('button', { name: 'Add Short text' }).click()
    await expect(palette).toBeHidden()
    await page.getByLabel('Question 2', { exact: true }).fill('When was the last groom?')
    // Only question 2 gets a conditional row at all: the rule can only key on
    // an EARLIER question that has a fixed option list, and question 1 has
    // nothing before it. So there is exactly one of these on the page.
    const condition = page.getByLabel('Only ask this question when')
    await expect(condition).toHaveCount(1)
    await condition.selectOption({ label: 'Has your dog been groomed before?' })
    await page.getByLabel('Answer that reveals this question').selectOption('Yes')

    const [res] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/forms') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create form' }).click(),
    ])
    expect(res.ok()).toBeTruthy()
    const formId = (await res.json()).id as string

    // Listed under Client forms, saying what it does in words rather than chips.
    await page.waitForURL('**/settings**')
    const row = page.getByRole('link', { name: new RegExp(formName) })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row).toContainText('Website enquiry + client intake')
    await expect(row).toContainText('2 questions')

    // Reopening it round-trips the conditional rule.
    await row.click()
    await page.waitForURL('**/forms/client/**')
    await expect(page.getByLabel('Form name')).toHaveValue(formName)
    // …one step in, where the questions live.
    await page.getByRole('button', { name: 'Next: The questions' }).click()
    await expect(page.getByLabel('Answer that reveals this question')).toHaveValue('Yes')

    // The public enquiry page renders the same form, and the conditional
    // question stays hidden until its trigger is answered.
    const publicPage = await page.context().newPage()
    await publicPage.goto(`/form/${formId}`)
    await expect(publicPage.getByText('Has your dog been groomed before?')).toBeVisible()
    await expect(publicPage.getByText('When was the last groom?')).toHaveCount(0)
    await publicPage.getByLabel('Has your dog been groomed before?').selectOption('Yes')
    await expect(publicPage.getByText('When was the last groom?')).toBeVisible()
    await publicPage.close()

    // Clean up — the suite shares one database and one trainer.
    await page.request.delete(`/api/forms/${formId}`)
  })

  test('the editor refuses to save an unnamed form', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/forms/session/new')
    await page.getByRole('button', { name: 'Create form' }).click()
    // Not getByRole('alert') — Next's route announcer carries that role too.
    await expect(page.getByText('Give the form a name')).toBeVisible()
    await expect(page).toHaveURL(/\/forms\/session\/new/)
  })
})

test.describe('forms screen — cross-tenant guard', () => {
  test("another business can't open the editor for your session form", async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const name = `Guarded form ${Date.now()}`
    const created = await page.request.post('/api/session-forms', {
      data: { name, questions: [{ id: 'q1', type: 'SHORT_TEXT', label: 'Anything?', required: false }] },
    })
    expect(created.ok()).toBeTruthy()
    const formId = (await created.json()).id as string

    await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
    await page.goto(`/forms/session/${formId}`)
    await expect(page.getByLabel('Form name')).toHaveCount(0)
    await expect(page.getByText(name)).toHaveCount(0)

    // Tidy up as the owner again — the suite shares one database.
    await login(page, SEED.owner.email, SEED.owner.password)
    const deleted = await page.request.delete(`/api/session-forms/${formId}`)
    expect(deleted.ok()).toBeTruthy()
  })

  test("another business can't open or edit the editor for your client form", async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const name = `Guarded client form ${Date.now()}`
    const created = await page.request.post('/api/forms', {
      data: {
        name,
        usableAsIntake: true,
        questions: [{ id: 'q1', type: 'SHORT_TEXT', label: 'Anything?', required: false }],
      },
    })
    expect(created.ok()).toBeTruthy()
    const formId = (await created.json()).id as string

    await login(page, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)
    await page.goto(`/forms/client/${formId}`)
    await expect(page.getByLabel('Form name')).toHaveCount(0)
    await expect(page.getByText(name)).toHaveCount(0)
    // …and the API says the same, rather than the page merely hiding it.
    expect((await page.request.get(`/api/forms/${formId}`)).status()).toBe(404)
    expect((await page.request.patch(`/api/forms/${formId}`, { data: { name: 'hijacked' } })).status()).toBe(404)
    expect((await page.request.delete(`/api/forms/${formId}`)).status()).toBe(404)

    await login(page, SEED.owner.email, SEED.owner.password)
    // Still ours, still called what we called it.
    const mine = await page.request.get(`/api/forms/${formId}`)
    expect(mine.ok()).toBeTruthy()
    expect((await mine.json()).name).toBe(name)
    expect((await page.request.delete(`/api/forms/${formId}`)).ok()).toBeTruthy()
  })
})
