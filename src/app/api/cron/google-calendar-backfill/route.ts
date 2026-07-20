import { NextResponse } from 'next/server'
import { backfillSessionsToGoogle } from '@/lib/google-calendar-sync'

// One-off, CRON_SECRET-guarded backfill of pre-existing future-dated sessions
// into connected trainers' Google Calendars — closes the gap for classes /
// self-book / booking-page / ongoing sessions created before outbound sync
// shipped (2026-07-20). Idempotent (only null-event-id rows) and resumable.
//
//   ?mode=count            → read-only: how many un-mirrored sessions exist
//   ?mode=execute&limit=N  → push up to N (default 1500); returns { synced, remaining }
//
// Loop execute until `remaining` is 0. Bearer CRON_SECRET, same as the
// busy-refresh cron. GET + POST both accepted.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handle(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const url = new URL(req.url)
  const execute = url.searchParams.get('mode') === 'execute'
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined

  const result = await backfillSessionsToGoogle({ execute, limit })
  return NextResponse.json({ ok: true, mode: execute ? 'execute' : 'count', ...result })
}

export const GET = handle
export const POST = handle
