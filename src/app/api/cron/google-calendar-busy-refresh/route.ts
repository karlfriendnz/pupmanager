import { NextResponse } from 'next/server'
import { refreshAllBusyBlocks } from '@/lib/google-calendar-sync'

// Refresh imported Google "busy" times for every connected member (delete +
// reinsert a now → ~60-day window). Scheduled via Supabase pg_cron + pg_net (see
// the migration / setup SQL), which calls this over HTTPS with the CRON_SECRET
// Bearer. Exposed as both GET (matches net.http_get) and POST.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const result = await refreshAllBusyBlocks()
  return NextResponse.json({ ok: true, ...result })
}

export const GET = handle
export const POST = handle
