import { test, expect } from '@playwright/test'
import { SEED } from './test-db'

// The public (unauthenticated) form submit is capped at 10 per 10 min per IP.
// All requests here come from the same test IP, so the 11th must be 429.
test('public form submit is rate limited', async ({ request }) => {
  const url = `/api/form/${SEED.embedFormId}/submit`
  const payload = { name: 'Spam Bot', email: 'spam@e2e.test', message: 'hi' }

  let sawTooMany = false
  for (let i = 0; i < 12; i++) {
    const res = await request.post(url, { data: payload })
    if (res.status() === 429) { sawTooMany = true; break }
    // Pre-limit responses should be accepted (201).
    expect(res.status()).toBe(201)
  }
  expect(sawTooMany).toBe(true)
})
