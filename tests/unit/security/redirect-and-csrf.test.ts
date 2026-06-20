import { describe, it, expect, vi } from 'vitest'

// CSRF helper reads env.NEXT_PUBLIC_APP_URL — pin it so the host comparison is
// deterministic regardless of the test environment.
vi.mock('../../../src/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com' } }))

import { safeInternalPath } from '../../../src/lib/safe-redirect'
import { isSameOrigin, requireSameOrigin } from '../../../src/lib/csrf'

describe('safeInternalPath — open-redirect guard', () => {
  it('allows ordinary same-origin relative paths', () => {
    expect(safeInternalPath('/dashboard')).toBe('/dashboard')
    expect(safeInternalPath('/clients/abc?tab=sessions')).toBe('/clients/abc?tab=sessions')
  })

  it('blocks absolute / off-site URLs', () => {
    expect(safeInternalPath('https://evil.com')).toBe('/')
    expect(safeInternalPath('http://evil.com/x')).toBe('/')
  })

  it('blocks protocol-relative "//evil.com"', () => {
    expect(safeInternalPath('//evil.com')).toBe('/')
    expect(safeInternalPath('/\\evil.com')).toBe('/')
  })

  it('blocks javascript:/data: scheme payloads', () => {
    expect(safeInternalPath('javascript:alert(1)')).toBe('/')
    expect(safeInternalPath('/javascript:alert(1)')).toBe('/') // still not a clean path
  })

  it('blocks encoded attempts to smuggle an external target', () => {
    expect(safeInternalPath('%2F%2Fevil.com')).toBe('/')
    expect(safeInternalPath('https%3A%2F%2Fevil.com')).toBe('/')
  })

  it('uses the provided fallback', () => {
    expect(safeInternalPath('https://evil.com', '/home')).toBe('/home')
    expect(safeInternalPath(null, '/home')).toBe('/home')
  })
})

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://app.pupmanager.com/api/x', { method: 'POST', headers })
}

describe('CSRF same-origin guard', () => {
  it('allows a same-origin request', () => {
    expect(isSameOrigin(reqWith({ origin: 'https://app.pupmanager.com' }))).toBe(true)
  })

  it('allows the Capacitor native webview origins', () => {
    expect(isSameOrigin(reqWith({ origin: 'capacitor://localhost' }))).toBe(true)
    expect(isSameOrigin(reqWith({ origin: 'https://localhost' }))).toBe(true)
  })

  it('allows a request with no Origin (native / server fetch)', () => {
    expect(isSameOrigin(reqWith({}))).toBe(true)
  })

  it('BLOCKS a cross-site Origin', () => {
    expect(isSameOrigin(reqWith({ origin: 'https://evil.com' }))).toBe(false)
  })

  it('blocks a cross-site Referer when no Origin is present', () => {
    expect(isSameOrigin(reqWith({ referer: 'https://evil.com/attack' }))).toBe(false)
  })

  it('requireSameOrigin returns a 403 response for a cross-site request', async () => {
    const res = requireSameOrigin(reqWith({ origin: 'https://evil.com' }))
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('requireSameOrigin returns null (proceed) for a same-origin request', () => {
    expect(requireSameOrigin(reqWith({ origin: 'https://app.pupmanager.com' }))).toBeNull()
  })
})
