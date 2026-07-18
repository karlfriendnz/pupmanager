import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/env', () => ({
  env: { AUTH_SECRET: 'test-secret-at-least-16-chars', NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com' },
}))

import { makeUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl, makeProductUnsubscribeToken, verifyProductUnsubscribeToken, productUnsubscribeUrl } from '@/lib/unsubscribe-token'

describe('unsubscribe tokens', () => {
  it('round-trips a clientProfileId', () => {
    const token = makeUnsubscribeToken('profile-123')
    expect(verifyUnsubscribeToken(token)).toBe('profile-123')
  })

  it('rejects a token with a tampered signature', () => {
    const token = makeUnsubscribeToken('profile-123')
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa')
    expect(verifyUnsubscribeToken(tampered)).toBeNull()
  })

  it('rejects a token whose id was swapped (signature no longer matches)', () => {
    const token = makeUnsubscribeToken('profile-123')
    const sig = token.slice(token.indexOf('.'))
    const forgedId = Buffer.from('profile-999', 'utf8').toString('base64url')
    expect(verifyUnsubscribeToken(forgedId + sig)).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifyUnsubscribeToken('')).toBeNull()
    expect(verifyUnsubscribeToken('nodot')).toBeNull()
    expect(verifyUnsubscribeToken('.onlysig')).toBeNull()
  })

  it('builds an absolute unsubscribe URL that verifies', () => {
    const url = unsubscribeUrl('profile-abc')
    expect(url.startsWith('https://app.pupmanager.com/unsubscribe/')).toBe(true)
    const token = url.split('/unsubscribe/')[1]
    expect(verifyUnsubscribeToken(token)).toBe('profile-abc')
  })
})

describe('product-update unsubscribe tokens', () => {
  it('round-trips a userId and builds the /unsubscribe/updates URL', () => {
    const url = productUnsubscribeUrl('user-42')
    expect(url.startsWith('https://app.pupmanager.com/unsubscribe/updates/')).toBe(true)
    const token = url.split('/unsubscribe/updates/')[1]
    expect(verifyProductUnsubscribeToken(token)).toBe('user-42')
  })

  it('rejects a tampered product token', () => {
    const token = makeProductUnsubscribeToken('user-42')
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa')
    expect(verifyProductUnsubscribeToken(tampered)).toBeNull()
  })

  it('is namespaced: a client token cannot be replayed as a product token, or vice versa', () => {
    // Same id, different token families — neither verifier accepts the other's token.
    const clientToken = makeUnsubscribeToken('shared-id')
    const productToken = makeProductUnsubscribeToken('shared-id')
    expect(clientToken).not.toBe(productToken)
    expect(verifyProductUnsubscribeToken(clientToken)).toBeNull()
    expect(verifyUnsubscribeToken(productToken)).toBeNull()
  })
})
