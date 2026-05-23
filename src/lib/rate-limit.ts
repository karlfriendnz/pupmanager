// Lightweight DB-backed fixed-window rate limiting for sensitive/unauthenticated
// endpoints (login, register, password reset, public form submit). Uses a single
// atomic Postgres upsert so it works across serverless instances without any
// external store (no Redis/KV account needed).
//
// Design choices:
//  • Fixed window (not sliding) — approximate is fine for abuse control.
//  • Fails OPEN: if the limiter query errors, we allow the request rather than
//    locking everyone out over a transient DB blip.
//  • Counts every attempt against the key; pick generous limits so normal use
//    (even a shared office IP) never trips them.

import { NextResponse } from 'next/server'
import { prisma } from './prisma'

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/**
 * Atomically increment the counter for `key` within a window and return the
 * post-increment count. A single upsert resets the window when it has expired.
 */
async function hit(key: string, windowMs: number): Promise<{ count: number; resetAt: Date }> {
  const reset = new Date(Date.now() + windowMs)
  const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "rate_limits" ("key", "count", "resetAt")
    VALUES (${key}, 1, ${reset})
    ON CONFLICT ("key") DO UPDATE SET
      "count"   = CASE WHEN "rate_limits"."resetAt" < now() THEN 1        ELSE "rate_limits"."count" + 1 END,
      "resetAt" = CASE WHEN "rate_limits"."resetAt" < now() THEN ${reset} ELSE "rate_limits"."resetAt"     END
    RETURNING "count", "resetAt"
  `
  const row = rows[0]
  return { count: Number(row?.count ?? 1), resetAt: row?.resetAt ?? reset }
}

/**
 * Returns true if `key` is now OVER `limit` for the window. Fails open (returns
 * false) on any DB error. Use this when you want a boolean (e.g. inside
 * NextAuth's authorize, which can't return an HTTP response).
 */
export async function isRateLimited(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    const { count } = await hit(key, windowMs)
    return count > limit
  } catch (err) {
    console.error('[rate-limit] check failed (failing open):', err)
    return false
  }
}

/**
 * Route-handler guard. Returns a ready-to-return 429 NextResponse when the
 * caller is over the limit, or null to proceed. Fails open.
 *
 *   const limited = await enforceRateLimit({ key: `form:${getClientIp(req)}`, limit: 10, windowMs: 600_000 })
 *   if (limited) return limited
 */
export async function enforceRateLimit(opts: { key: string; limit: number; windowMs: number }): Promise<NextResponse | null> {
  try {
    const { count, resetAt } = await hit(opts.key, opts.windowMs)
    if (count > opts.limit) {
      const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))
      return NextResponse.json(
        { error: 'Too many requests. Please slow down and try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
    }
    return null
  } catch (err) {
    console.error('[rate-limit] enforce failed (failing open):', err)
    return null
  }
}
