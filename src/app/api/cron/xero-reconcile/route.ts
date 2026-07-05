import { NextResponse } from 'next/server'
import { reconcileAllXeroPayments } from '@/lib/invoicing'

// Poll Xero for payment updates on every still-open (UNPAID/PARTIAL), synced
// invoice across all trainers — the fallback for any webhook we miss. Scheduled
// via Supabase pg_cron + pg_net (NOT vercel.json), authenticated with the prod
// CRON_SECRET Bearer. Exposed as both GET (net.http_get) and POST (net.http_post).
//
// Register once in the Supabase SQL editor (superuser):
//
//   DO $$
//   BEGIN
//     CREATE EXTENSION IF NOT EXISTS pg_cron;
//     CREATE EXTENSION IF NOT EXISTS pg_net;
//     -- Every 30 minutes: reconcile open invoices against Xero.
//     PERFORM cron.schedule(
//       'pm-xero-reconcile', '*/30 * * * *',
//       $cmd$ SELECT net.http_post(
//         url     := 'https://app.pupmanager.com/api/cron/xero-reconcile',
//         headers := jsonb_build_object(
//           'Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''),
//           'Content-Type', 'application/json'
//         ),
//         body    := '{}'::jsonb
//       ) $cmd$
//     );
//   EXCEPTION WHEN OTHERS THEN
//     RAISE NOTICE 'Supabase pg_cron setup skipped (run manually): %', SQLERRM;
//   END $$;
//
// (app.cron_secret is the DB setting that mirrors env CRON_SECRET, as the other
// PupManager crons use.)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const result = await reconcileAllXeroPayments()
  return NextResponse.json({ ok: true, ...result })
}

export const GET = handle
export const POST = handle
