import { NextResponse } from 'next/server'
import { runOnboardingEmailDispatch } from '@/lib/onboarding/send-emails'

// Hourly dispatcher for the trainer onboarding + trial-process emails
// (Supabase pg_cron — see prisma/migrations/*_onboarding_email_cron).
//
// The route is a thin wrapper: all trigger evaluation, rendering, sending and
// dedup logging lives in runOnboardingEmailDispatch(). It only ever sends
// PUBLISHED templates, so with everything unpublished this is a safe no-op.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const stats = await runOnboardingEmailDispatch()
  return NextResponse.json(stats)
}
