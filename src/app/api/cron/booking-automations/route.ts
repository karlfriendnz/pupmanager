import { NextResponse } from 'next/server'
import { processScheduledAutomations } from '@/lib/booking-automations'

// Sends due BEFORE/AFTER_SESSION booking-page automation emails. Runs every
// 15 min (Supabase pg_cron — see prisma/migrations/*_booking_automations_cron).
// The processor dedups per (automation, session) so frequent ticks only keep
// timing tight, never double-send.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const result = await processScheduledAutomations()
  return NextResponse.json(result)
}
