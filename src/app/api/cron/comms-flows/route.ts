import { NextResponse } from 'next/server'
import { processCommsFlows } from '@/lib/comms-flows'

// Sends due automated communication-flow messages for classes / drop-ins /
// events (push / email / in-app). Runs every 5 min (Supabase pg_cron — see
// prisma/migrations/*_comms_flows_cron). The processor dedups per
// (step, session, recipient) so frequent ticks only keep timing tight (offsets
// land within ±2.5 min), never double-send.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const result = await processCommsFlows()
  return NextResponse.json(result)
}
