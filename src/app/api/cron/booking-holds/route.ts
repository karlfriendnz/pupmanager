import { NextResponse } from 'next/server'
import { sweepBookingHolds } from '@/lib/booking-holds'

// Tidy away booking holds that have stopped mattering — lapsed while somebody
// was answering the offering's gating form, or long since turned into a real
// booking.
//
// THIS IS HOUSEKEEPING, NOT THE THING THAT FREES A SLOT. Every query that
// treats a hold as busy filters `expiresAt > now()` (lib/booking-holds), so a
// hold that lapsed thirty seconds ago is already bookable by somebody else
// whether or not this has run. If it never ran again the only consequence would
// be a table that grows.
//
// That ordering is deliberate. A sweep that were load-bearing would leave a slot
// locked for up to a whole cron interval after it should have been free, which
// is exactly the "one distracted person quietly takes 2pm out of the diary"
// failure the hold exists to prevent.
//
// Wired via Supabase pg_cron + pg_net (never vercel.json — this project
// deliberately doesn't use those), same Bearer/CRON_SECRET auth as every other
// cron route. Idempotent: a second run finds nothing left to delete.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const result = await sweepBookingHolds()
  return NextResponse.json({ ok: true, ...result })
}

export const GET = handle
export const POST = handle
