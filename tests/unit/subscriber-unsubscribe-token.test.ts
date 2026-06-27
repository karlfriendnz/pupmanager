import { describe, it, expect, vi } from 'vitest'

// AUTH_SECRET is read from env via @/lib/env — stub it before importing.
vi.mock('@/lib/env', () => ({ env: { AUTH_SECRET: 'test-secret-key', NEXT_PUBLIC_APP_URL: 'https://app.example' } }))

import { makeSubscriberUnsubToken, verifySubscriberUnsubToken, subscriberUnsubscribeUrl } from '@/lib/subscriber-unsubscribe-token'
import { makeUnsubscribeToken } from '@/lib/unsubscribe-token'

describe('subscriber unsubscribe token', () => {
  it('round-trips a subscriber id', () => {
    const token = makeSubscriberUnsubToken('sub_123')
    expect(verifySubscriberUnsubToken(token)).toBe('sub_123')
  })

  it('rejects a tampered token', () => {
    const token = makeSubscriberUnsubToken('sub_123')
    expect(verifySubscriberUnsubToken(token.slice(0, -2) + 'xy')).toBeNull()
    expect(verifySubscriberUnsubToken('garbage')).toBeNull()
    expect(verifySubscriberUnsubToken('')).toBeNull()
  })

  it('is namespaced — a CLIENT unsubscribe token does not verify as a subscriber token', () => {
    // Same underlying id, but the client token signs the bare id while the
    // subscriber token signs "sub:<id>", so they must not be interchangeable.
    const clientToken = makeUnsubscribeToken('shared_id')
    expect(verifySubscriberUnsubToken(clientToken)).toBeNull()
  })

  it('builds an absolute unsubscribe URL', () => {
    expect(subscriberUnsubscribeUrl('sub_9')).toMatch(/^https:\/\/app\.example\/unsubscribe\/subscriber\//)
  })
})
