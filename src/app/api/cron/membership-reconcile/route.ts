import { NextResponse } from 'next/server'
import { reconcileAllSubscriptions } from '@/lib/membership-reconcile'

// Nightly: confirm Stripe agrees with every recurring membership we think is
// live, and fix any disagreement.
//
// Our row is never the source of truth. The failure this exists to catch — a
// client who cancelled, was told they had cancelled, and keeps being charged
// because the Stripe call failed — is silent by nature: nothing errors, nobody
// notices, and the first sign is an angry client and a trainer's reputation.
//
// Scheduled via Supabase pg_cron + pg_net (NEVER vercel.json), authenticated
// with the prod CRON_SECRET bearer. REGISTER IT IN scripts/setup-supabase-crons.ts
// alongside the others — CRON_SECRET can only be rotated, never read back, so a
// rotation has to rewrite every job at once and silently 401s any it misses.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const result = await reconcileAllSubscriptions()

  // Any correction is worth shouting about in the logs: it means a webhook was
  // missed or an API call silently failed, and the count is the health signal
  // for the whole recurring system. `unreachable` rising is its own alarm —
  // that is Stripe not answering, not a subscription genuinely ending.
  if (result.corrected > 0 || result.unreachable > 0) {
    console.error('[cron membership-reconcile] drift corrected', {
      corrected: result.corrected,
      unreachable: result.unreachable,
      details: result.details,
    })
  }

  return NextResponse.json({ ok: true, ...result })
}

export const GET = handle
export const POST = handle
