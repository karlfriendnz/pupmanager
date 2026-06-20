import { NextResponse } from 'next/server'
import { env } from './env'

// Defense-in-depth CSRF check for the most sensitive mutations (money, account
// deletion, role/permission changes). NextAuth's session cookie is already
// SameSite=Lax + httpOnly, which stops cross-site browsers from attaching it to
// a forged POST — this is a second layer that validates the request's Origin.
//
// Design: we BLOCK only when an Origin (or, as fallback, Referer) header is
// PRESENT and its host does NOT match our app. We deliberately ALLOW a missing
// Origin, because the Capacitor native webview and some same-origin server
// fetches omit it — blocking those would break the app, and a missing Origin is
// not the cross-site attack vector (the attacker's browser always sends one).
const NATIVE_ORIGINS = new Set([
  'capacitor://localhost', // iOS Capacitor
  'http://localhost',      // Android Capacitor / local dev shells
  'https://localhost',
])

function appHost(): string | null {
  try {
    return new URL(env.NEXT_PUBLIC_APP_URL).host
  } catch {
    return null
  }
}

/** Returns true when the request's origin is acceptable for a state change. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  const host = appHost()

  if (origin) {
    if (NATIVE_ORIGINS.has(origin)) return true
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }

  // No Origin — fall back to Referer if present; otherwise allow (native / SSR).
  const referer = req.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).host === host
    } catch {
      return false
    }
  }
  return true
}

/**
 * Guard a sensitive mutating route. Returns a 403 NextResponse to return early
 * when the Origin is cross-site, or null when the request may proceed.
 *
 *   const csrf = requireSameOrigin(req); if (csrf) return csrf
 */
export function requireSameOrigin(req: Request): NextResponse | null {
  if (isSameOrigin(req)) return null
  return NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 })
}
