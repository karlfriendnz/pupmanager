import { encode } from 'next-auth/jwt'
import type { NextResponse } from 'next/server'
import type { JWT } from 'next-auth/jwt'

// Helpers for minting an Auth.js session cookie by hand — used by the admin
// "log in as trainer" impersonation flow (start + stop). Auth.js normally
// only writes this cookie during a real sign-in; here we re-issue it so an
// admin can assume a trainer's session (and restore their own afterwards)
// without knowing the trainer's password.
//
// The salt MUST equal the cookie name (this is what Auth.js does internally),
// and the secret is AUTH_SECRET. Match the 365-day maxAge from auth.config.ts
// so the session lifetime is consistent with normal logins.

const MAX_AGE = 365 * 24 * 60 * 60

// Auth.js prefixes the cookie with `__Secure-` and sets `secure: true` only
// when the deployment is served over https (it keys off AUTH_URL). Mirror
// that here so the name + flags line up with what middleware reads back.
function secureCookies(): boolean {
  return process.env.AUTH_URL?.startsWith('https://') ?? false
}

export function sessionCookieName(): string {
  return `${secureCookies() ? '__Secure-' : ''}authjs.session-token`
}

/**
 * Encode `token` into an Auth.js session JWT and attach it to `res` under the
 * session cookie. On the next request the jwt callback re-runs and backfills
 * the rest (e.g. trainerId from membership), so a minimal `{ id, role }` token
 * is enough.
 */
export async function setSessionCookie(res: NextResponse, token: JWT): Promise<void> {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  const name = sessionCookieName()
  const encoded = await encode({ salt: name, secret, maxAge: MAX_AGE, token })
  res.cookies.set(name, encoded, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: secureCookies(),
    maxAge: MAX_AGE,
  })
}
