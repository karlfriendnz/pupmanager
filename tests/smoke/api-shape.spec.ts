import { test, expect } from '@playwright/test'

// Authenticated APIs should reject unauth callers, but the rejection format
// depends on whether the route is in PUBLIC_PATHS in proxy.ts:
//   - Listed there (e.g. /api/cron/*): handler runs, returns JSON 401
//   - Not listed: middleware redirects to /login (status 307)
// Either is correct. What we're guarding against is a route that crashes
// before any auth check and returns an empty body — exactly the regression
// that bit us with notification-preferences earlier today.

const ENDPOINTS: { method: 'GET' | 'POST'; path: string }[] = [
  { method: 'GET',  path: '/api/notification-preferences' },
  { method: 'POST', path: '/api/notification-preferences/test' },
  { method: 'POST', path: '/api/devices/register' },
  { method: 'POST', path: '/api/devices/test-push' },
  // Session lifecycle endpoints — touched by mark-complete, mark-invoiced and
  // the delete-session button. We pass a bogus id so the auth check runs but
  // the row lookup fails; what we're guarding against is the route exploding
  // before either step.
  { method: 'POST', path: '/api/clients/cmnotreal/packages' },
  // Billing checkout — auth-gated; the test below just verifies the
  // route survives the unauth bounce. The webhook is signature-gated
  // rather than auth-gated, so it gets its own test below.
  { method: 'POST', path: '/api/billing/checkout' },
]

test.describe('Authed API endpoints', () => {
  for (const { method, path } of ENDPOINTS) {
    test(`${method} ${path} rejects unauth without crashing`, async ({ request }) => {
      const r = method === 'GET'
        ? await request.get(path, { maxRedirects: 0 })
        : await request.post(path, { data: {}, maxRedirects: 0 })

      const status = r.status()
      expect([307, 401, 403], `${path} should reject unauth (got ${status})`).toContain(status)

      if (status === 401) {
        // 401 means the route handler ran, so the body must be a JSON error —
        // an empty body would mean the route crashed before auth and is the
        // regression class we explicitly want to catch.
        const text = await r.text()
        expect(text.length, `${path} 401 body should not be empty`).toBeGreaterThan(0)
        expect(() => JSON.parse(text), `${path} 401 body should be JSON`).not.toThrow()
      }
    })
  }

  // Session-status mutations live behind a dynamic [sessionId] route — easier
  // to test those by hitting them directly with a bogus id.
  for (const method of ['PATCH', 'DELETE'] as const) {
    test(`${method} /api/schedule/[id] rejects unauth without crashing`, async ({ request }) => {
      const r = await request.fetch('/api/schedule/cmnotreal', {
        method,
        data: method === 'PATCH' ? { status: 'INVOICED' } : undefined,
        maxRedirects: 0,
      })
      const status = r.status()
      expect([307, 401, 403], `expected auth-bounce (got ${status})`).toContain(status)
    })
  }

  // The native-shell version gate reads this on launch, often before login, so
  // it MUST be public (in PUBLIC_PATHS) — a 307 login bounce here means the app
  // can never read its update floor. Guards against the entry being dropped.
  test('GET /api/app/version-requirements is public and returns store links', async ({ request }) => {
    const r = await request.get('/api/app/version-requirements', { maxRedirects: 0 })
    expect(r.status(), 'must be reachable without auth (not a 307 login bounce)').toBe(200)
    const body = await r.json()
    expect(body.ios?.storeUrl, 'ios store url present').toBeTruthy()
    expect(body.android?.storeUrl, 'android store url present').toBeTruthy()
  })

  // Stripe webhook is signature-gated, not auth-gated, so an unsigned
  // POST should land on the signature check (400) or hit the
  // not-configured short-circuit (503) — never 500.
  test('POST /api/webhooks/stripe rejects unsigned without crashing', async ({ request }) => {
    const r = await request.post('/api/webhooks/stripe', {
      data: '{}',
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 0,
    })
    const status = r.status()
    expect([400, 503], `expected sig/config rejection (got ${status})`).toContain(status)
  })
})
