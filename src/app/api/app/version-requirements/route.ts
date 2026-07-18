import { NextResponse } from 'next/server'
import { requirementsFromEnv } from '@/lib/app-version'

export const runtime = 'nodejs'
// Always read the current env at request time — never cache. This is what lets
// you bump APP_MIN_VERSION_* in Vercel and have the floor take effect on the
// next launch (after the redeploy that env changes trigger) without shipping code.
export const dynamic = 'force-dynamic'

// Public, unauthenticated: the native shell calls this on launch (often before
// the user is signed in) to decide whether the running build is too old. It
// returns only version floors + store links — no user or tenant data — so it
// needs no auth. See src/lib/app-version.ts for the tiers.
export function GET() {
  return NextResponse.json(requirementsFromEnv(process.env), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
