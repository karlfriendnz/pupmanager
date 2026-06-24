import { test, expect, type Page } from '@playwright/test'
import { SEED, TEST_DATABASE_URL } from './test-db'

// Timesheets / time-tracking E2E. Runs against the isolated embedded Postgres.
// Drives the API directly (page.request, which carries the session cookie) for
// the data-mutation flow, plus a UI smoke pass for the page chrome. Cross-tenant
// access is tolerated as any of [401,403,404] like pentest.spec.ts.

void TEST_DATABASE_URL // imported for parity with the rest of the e2e suite

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}

test.describe('timesheets — owner UAT happy path', () => {
  test('create rate → timesheet → entry → finalise → PDF download', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)

    // 1. Owner creates an hourly rate.
    const rateRes = await page.request.post('/api/time-rates', {
      data: { name: `Training ${Date.now()}`, rateCents: 8000 },
    })
    expect(rateRes.ok(), 'create rate').toBeTruthy()
    const { rate } = await rateRes.json()
    expect(rate.id).toBeTruthy()
    expect(rate.rateCents).toBe(8000)

    // 2. Create a timesheet for the current week.
    const tsRes = await page.request.post('/api/timesheets', { data: { title: 'UAT week' } })
    expect(tsRes.ok(), 'create timesheet').toBeTruthy()
    const { timesheet } = await tsRes.json()
    const tsId = timesheet.id
    expect(tsId).toBeTruthy()

    // 3. Log time on it — 90 min @ the rate → $120.00.
    const entryRes = await page.request.post(`/api/timesheets/${tsId}/entries`, {
      data: { date: '2026-06-22', task: 'Puppy class', minutes: 90, rateId: rate.id },
    })
    expect(entryRes.ok(), 'add entry').toBeTruthy()

    // 4. Detail reflects the snapshotted rate + computed amount.
    const detail = await (await page.request.get(`/api/timesheets/${tsId}`)).json()
    expect(detail.entries).toHaveLength(1)
    expect(detail.entries[0].minutes).toBe(90)
    expect(detail.entries[0].amountCents).toBe(12000) // 1.5h × $80
    expect(detail.entries[0].rateName).toBe(rate.name)

    // 5. Finalise locks it.
    const finRes = await page.request.post(`/api/timesheets/${tsId}/finalise`)
    expect(finRes.ok(), 'finalise').toBeTruthy()
    const afterFin = await (await page.request.get(`/api/timesheets/${tsId}`)).json()
    expect(afterFin.timesheet.status).toBe('FINALISED')

    // 6. A finalised timesheet rejects further entries (409).
    const blocked = await page.request.post(`/api/timesheets/${tsId}/entries`, {
      data: { date: '2026-06-23', task: 'too late', minutes: 30 },
    })
    expect(blocked.status(), 'edit after finalise').toBe(409)

    // 7. Download the PDF.
    const pdf = await page.request.get(`/api/timesheets/${tsId}/pdf`)
    expect(pdf.ok(), 'pdf download').toBeTruthy()
    expect(pdf.headers()['content-type']).toContain('application/pdf')
    expect((await pdf.body()).length).toBeGreaterThan(500)

    // 8. Reopen returns it to DRAFT so edits are possible again.
    const reopen = await page.request.delete(`/api/timesheets/${tsId}/finalise`)
    expect(reopen.ok(), 'reopen').toBeTruthy()
    const afterReopen = await (await page.request.get(`/api/timesheets/${tsId}`)).json()
    expect(afterReopen.timesheet.status).toBe('DRAFT')
  })

  test('the Timesheets page renders and creates a sheet via the UI', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    await page.goto('/timesheets')
    await expect(page.getByRole('heading', { name: 'Timesheets' })).toBeVisible()
    await expect(page.getByText('Start a new timesheet')).toBeVisible()

    await page.getByRole('button', { name: /New timesheet/i }).click()
    // Lands on the detail page (week-range heading) or shows it in the list.
    await page.waitForURL('**/timesheets/**', { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible()
  })
})

test.describe('timesheets — empty-sheet finalise guard', () => {
  test('cannot finalise a timesheet with no entries', async ({ page }) => {
    await login(page, SEED.owner.email, SEED.owner.password)
    const tsRes = await page.request.post('/api/timesheets', { data: { title: 'Empty' } })
    const { timesheet } = await tsRes.json()
    const res = await page.request.post(`/api/timesheets/${timesheet.id}/finalise`)
    expect(res.status()).toBe(400)
  })
})

test.describe('time-rates — owner-only management', () => {
  test('a STAFF member cannot create a rate', async ({ page }) => {
    await login(page, SEED.staff.email, SEED.staff.password)
    const res = await page.request.post('/api/time-rates', { data: { name: 'Sneaky', rateCents: 5000 } })
    expect(res.status(), 'staff create rate').toBe(403)
  })

  test('a STAFF member CAN read rates (for the entry picker)', async ({ page }) => {
    await login(page, SEED.staff.email, SEED.staff.password)
    const res = await page.request.get('/api/time-rates')
    expect(res.ok(), 'staff read rates').toBeTruthy()
    const { rates } = await res.json()
    expect(Array.isArray(rates)).toBeTruthy()
  })
})

test.describe('timesheets — cross-tenant (Owner B attacks Business A)', () => {
  test('Owner B cannot read, edit, finalise or fetch the PDF of A’s timesheet', async ({ page, browser }) => {
    // Owner A creates a private timesheet.
    await login(page, SEED.owner.email, SEED.owner.password)
    const { timesheet } = await (await page.request.post('/api/timesheets', { data: { title: 'A private' } })).json()
    const aId = timesheet.id
    expect(aId).toBeTruthy()

    // A fresh context for the rival owner (Business B).
    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await login(pageB, SEED.businessB.ownerEmail, SEED.businessB.ownerPassword)

    const deny = [401, 403, 404]
    const read = await pageB.request.get(`/api/timesheets/${aId}`)
    expect(deny, 'B reads A timesheet').toContain(read.status())

    const edit = await pageB.request.patch(`/api/timesheets/${aId}`, { data: { title: 'pwned' } })
    expect(deny, 'B edits A timesheet').toContain(edit.status())

    const addEntry = await pageB.request.post(`/api/timesheets/${aId}/entries`, {
      data: { date: '2026-06-22', task: 'pwn', minutes: 10 },
    })
    expect(deny, 'B adds entry to A timesheet').toContain(addEntry.status())

    const finalise = await pageB.request.post(`/api/timesheets/${aId}/finalise`)
    expect(deny, 'B finalises A timesheet').toContain(finalise.status())

    const pdf = await pageB.request.get(`/api/timesheets/${aId}/pdf`)
    expect(deny, 'B downloads A timesheet PDF').toContain(pdf.status())

    const del = await pageB.request.delete(`/api/timesheets/${aId}`)
    expect(deny, 'B deletes A timesheet').toContain(del.status())

    // Confirm A still owns an unmodified sheet.
    const stillA = await page.request.get(`/api/timesheets/${aId}`)
    expect(stillA.ok()).toBeTruthy()
    expect((await stillA.json()).timesheet.title).toBe('A private')

    await ctxB.close()
  })
})
