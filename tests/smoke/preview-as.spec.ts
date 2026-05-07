import { test, expect } from '@playwright/test'

// The /preview-as/[clientId] route handler is the trainer's entry point into
// preview-as-client mode. It drops a cookie and 307s to /home. Tests below
// only cover the unauth path — auth-required behaviour is exercised by the
// in-browser audit and would need DB + session fixtures to test in CI.

test.describe('Preview-as route (unauth)', () => {
  test('GET /preview-as/[clientId] without auth → bounced to /login', async ({ request }) => {
    const r = await request.get('/preview-as/cmnotreal', { maxRedirects: 0 })
    expect(
      [307, 401].includes(r.status()),
      `expected 307/401 (auth bounce) — got ${r.status()}`,
    ).toBe(true)
    if (r.status() === 307) {
      expect(r.headers().location ?? '').toContain('/login')
    }
  })

  test('GET /preview-as without auth → bounced to /login', async ({ request }) => {
    const r = await request.get('/preview-as', { maxRedirects: 0 })
    expect([307, 401].includes(r.status())).toBe(true)
  })

  test('Trainer routes blocked from /home unless preview cookie set', async ({ request }) => {
    // Without a session, /home redirects to /login. With a trainer session
    // and no preview cookie, the proxy middleware sends them to /dashboard.
    // We can only verify the unauth path here; the cookie path is integration.
    const r = await request.get('/home', { maxRedirects: 0 })
    expect(r.status()).toBe(307)
    const loc = r.headers().location ?? ''
    expect(loc.includes('/login') || loc.includes('/dashboard')).toBe(true)
  })
})
