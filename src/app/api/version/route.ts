import { NextResponse } from 'next/server'

// The build id of the CURRENTLY-DEPLOYED server. A client compares this
// against the build id baked into its own bundle (NEXT_PUBLIC_BUILD_ID,
// inlined at build time). A mismatch = the client is running stale JS
// from a previous deploy and should reload. Never cached so a stale
// client always sees the live value.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { v: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
