import { test, expect } from '@playwright/test'

// Visits every page route in the app and asserts it returns a non-500.
// Unauth callers get bounced to /login by the proxy middleware (307), or
// a route handler may return 401/404. What we're guarding against is the
// regression class where a page throws at the framework level — bad imports,
// broken Prisma queries on Server Components, server/client boundary leaks
// (e.g. onClick on a Link in a Server Component). Those manifest as 500s
// regardless of auth state.

const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/verify-email',
  '/invite',
]

const TRAINER_ROUTES = [
  '/dashboard',
  '/clients',
  '/clients/invite',
  '/schedule',
  '/packages',
  '/templates',
  '/templates/new',
  '/products',
  '/achievements',
  '/enquiries',
  '/messages',
  '/settings',
  '/help',
  '/ai-tools',
  '/forms/intake',
  '/forms/intake/preview',
  '/forms/embed/new',
  '/forms/session/new',
  '/progress',
  '/sessions/needs-notes',
]

const CLIENT_ROUTES = [
  '/home',
  '/my-sessions',
  '/my-availability',
  '/my-shop',
  '/my-help',
  '/my-profile',
  '/my-messages',
  '/notifications',
]

const ROOT_ROUTES = ['/', '/preview-as']

const ACCEPTABLE = new Set([200, 301, 302, 303, 307, 308, 401, 404])

function check(route: string, status: number) {
  expect(
    ACCEPTABLE.has(status),
    `${route} returned ${status} — expected 2xx/3xx/401/404, got 5xx`,
  ).toBe(true)
}

test.describe('Page smoke (unauth)', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`GET ${route}`, async ({ request }) => {
      const r = await request.get(route, { maxRedirects: 0 })
      check(route, r.status())
    })
  }

  for (const route of TRAINER_ROUTES) {
    test(`GET ${route} (expect redirect)`, async ({ request }) => {
      const r = await request.get(route, { maxRedirects: 0 })
      check(route, r.status())
    })
  }

  for (const route of CLIENT_ROUTES) {
    test(`GET ${route} (expect redirect)`, async ({ request }) => {
      const r = await request.get(route, { maxRedirects: 0 })
      check(route, r.status())
    })
  }

  for (const route of ROOT_ROUTES) {
    test(`GET ${route}`, async ({ request }) => {
      const r = await request.get(route, { maxRedirects: 0 })
      check(route, r.status())
    })
  }

  test('GET /form/[unknown] → 404', async ({ request }) => {
    const r = await request.get('/form/notarealid', { maxRedirects: 0 })
    expect(r.status()).toBe(404)
  })

  test('GET /clients/[unknown] (unauth) → redirect, never 500', async ({ request }) => {
    const r = await request.get('/clients/cmnotreal', { maxRedirects: 0 })
    check('/clients/cmnotreal', r.status())
  })

  test('GET /sessions/[unknown] (unauth) → redirect, never 500', async ({ request }) => {
    const r = await request.get('/sessions/cmnotreal', { maxRedirects: 0 })
    check('/sessions/cmnotreal', r.status())
  })
})
