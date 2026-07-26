import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/connect/login-link — the hand-off to the trainer's Stripe Express
// dashboard.
//
// It gained a `?json=1` mode so the native app can resolve the link INSIDE the
// WebView (where the session cookie lives) and then hand the real Stripe URL to
// the OS browser. `target="_blank"` can't do that job on native: the OS browser
// would fetch this route with no cookie and land on the login screen.
//
// So the two things worth pinning down: json mode returns the URL rather than a
// redirect, and it stays exactly as locked down as the redirect mode.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  trainerFindUnique: vi.fn(),
  createLoginLink: vi.fn(),
  env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com' },
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/connect', () => ({ createLoginLink: h.createLoginLink }))
vi.mock('@/lib/env', () => ({ env: h.env }))
vi.mock('@/lib/prisma', () => ({
  prisma: { trainerProfile: { findUnique: h.trainerFindUnique } },
}))

import { GET } from '@/app/api/connect/login-link/route'

const STRIPE_URL = 'https://connect.stripe.com/express/acct_123/abc'
const SETTINGS = 'https://app.pupmanager.com/settings?tab=payments'

const req = (json: boolean) =>
  new Request(`https://app.pupmanager.com/api/connect/login-link${json ? '?json=1' : ''}`)

const trainerSession = {
  user: { role: 'TRAINER', trainerId: 't1' },
}

beforeEach(() => {
  h.auth.mockReset()
  h.trainerFindUnique.mockReset()
  h.createLoginLink.mockReset()
  h.auth.mockResolvedValue(trainerSession)
  h.trainerFindUnique.mockResolvedValue({
    connectAccountId: 'acct_123',
    sandboxBilling: false,
    connectChargesEnabled: true,
  })
  h.createLoginLink.mockResolvedValue(STRIPE_URL)
})

describe('GET /api/connect/login-link — redirect mode (web)', () => {
  it('redirects an onboarded trainer to their Stripe dashboard', async () => {
    const res = await GET(req(false))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(STRIPE_URL)
  })

  it('bounces a signed-out visitor back to settings instead of minting a link', async () => {
    h.auth.mockResolvedValue(null)
    const res = await GET(req(false))
    expect(res.headers.get('location')).toBe(SETTINGS)
    expect(h.createLoginLink).not.toHaveBeenCalled()
  })

  it('bounces a CLIENT — the dashboard is a trainer surface', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', trainerId: 't1' } })
    const res = await GET(req(false))
    expect(res.headers.get('location')).toBe(SETTINGS)
    expect(h.createLoginLink).not.toHaveBeenCalled()
  })
})

describe('GET /api/connect/login-link?json=1 — native mode', () => {
  it('returns the Stripe URL as JSON rather than redirecting', async () => {
    const res = await GET(req(true))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ url: STRIPE_URL })
    // Minted for the signed-in trainer's own account, in their own mode.
    expect(h.createLoginLink).toHaveBeenCalledWith('acct_123', false)
  })

  it('mints against the SANDBOX account when the trainer is in sandbox billing', async () => {
    h.trainerFindUnique.mockResolvedValue({
      connectAccountId: 'acct_test', sandboxBilling: true, connectChargesEnabled: true,
    })
    await GET(req(true))
    expect(h.createLoginLink).toHaveBeenCalledWith('acct_test', true)
  })

  it('401s a signed-out caller — json mode is not a way around the auth check', async () => {
    h.auth.mockResolvedValue(null)
    const res = await GET(req(true))
    expect(res.status).toBe(401)
    expect(h.createLoginLink).not.toHaveBeenCalled()
  })

  it('401s a CLIENT session', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', trainerId: 't1' } })
    const res = await GET(req(true))
    expect(res.status).toBe(401)
    expect(h.createLoginLink).not.toHaveBeenCalled()
  })

  it('400s before onboarding is finished (no login link exists yet)', async () => {
    h.trainerFindUnique.mockResolvedValue({
      connectAccountId: 'acct_123', sandboxBilling: false, connectChargesEnabled: false,
    })
    const res = await GET(req(true))
    expect(res.status).toBe(400)
    expect(h.createLoginLink).not.toHaveBeenCalled()
  })

  it('502s (not a redirect the app would try to parse as JSON) when Stripe is unreachable', async () => {
    h.createLoginLink.mockRejectedValue(new Error('stripe down'))
    const res = await GET(req(true))
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toHaveProperty('error')
  })

  it('still redirects to settings with an error flag when Stripe is unreachable on the web', async () => {
    h.createLoginLink.mockRejectedValue(new Error('stripe down'))
    const res = await GET(req(false))
    expect(res.headers.get('location')).toBe(`${SETTINGS}&error=dashboard`)
  })
})
