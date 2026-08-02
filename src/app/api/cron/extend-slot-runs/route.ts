import { NextResponse } from 'next/server'
import { extendSlotRuns } from '@/lib/extend-slot-runs'

// Nightly job: keep open-ended, slot-scheduled runs (doggy daycare, casual
// drop-in classes) stocked with sessions a year ahead.
//
// Without it a daycare's sessions simply stopped ~12 weeks after it was set up:
// the day-part slots are open-ended `FREQ=WEEKLY`, but they were only ever
// expanded once, at creation, and extendOngoingPackages only tops up 1:1
// assignments. The board and the client booking wizard emptied with no warning.
//
// Wired via Supabase pg_cron + pg_net (never vercel.json — this project
// deliberately doesn't use those), same Bearer/CRON_SECRET auth as every other
// cron route. Idempotent: each slot is filled FORWARD from the last session it
// already has, so running it twice adds nothing the second time, and a session
// the trainer deleted on purpose is never resurrected.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handle(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const result = await extendSlotRuns()
  return NextResponse.json({ ok: true, ...result })
}

export const GET = handle
export const POST = handle
