import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { enforceRateLimit } from '@/lib/rate-limit'
import { backfillSessionsToGoogle } from '@/lib/google-calendar-sync'

// POST /api/google-calendar/backfill — "Sync my calendar now".
//
// Pushes this company's already-scheduled future sessions into Google. The
// connect callback now does this automatically, but that only helps people who
// connect from here on: every trainer who connected BEFORE it existed has a
// calendar missing everything scheduled up to that point, and the only way to
// fix them was a CRON_SECRET-guarded endpoint no trainer can reach (and whose
// secret is write-only in Vercel, so nobody can read it either).
//
// So the trainer gets the button instead. Same helper, same guarantees:
// idempotent (only sessions with no mirrored event), add-on gated, chunked and
// throttled under Google's write quota.
export const maxDuration = 300

export async function POST() {
  const ctx = await getTrainerContext()
  if (!ctx?.membershipId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // The connection is per STAFF MEMBER — you can only sync your own calendar.
  const conn = await prisma.googleCalendarConnection.findUnique({
    where: { membershipId: ctx.membershipId },
    select: { id: true },
  })
  if (!conn) {
    return NextResponse.json({ error: 'Connect your Google Calendar first.' }, { status: 409 })
  }
  if (!(await hasAddon(ctx.companyId, 'googlecalendar'))) {
    return NextResponse.json({ error: 'The Google Calendar add-on is switched off.' }, { status: 409 })
  }

  // Each run can write hundreds of events to Google. Twice in ten minutes is
  // plenty for a button whose whole job is a one-off catch-up.
  const limited = await enforceRateLimit({
    key: `gcal-backfill:${ctx.membershipId}`,
    limit: 2,
    windowMs: 10 * 60_000,
  })
  if (limited) return limited

  try {
    const result = await backfillSessionsToGoogle({
      execute: true,
      companyId: ctx.companyId,
      limit: 500,
    })
    return NextResponse.json({
      ok: true,
      synced: result.synced,
      remaining: result.remaining,
    })
  } catch (err) {
    console.error('[google-calendar] manual backfill failed', ctx.companyId, err)
    return NextResponse.json(
      { error: 'Could not reach Google just now. Try again in a minute.' },
      { status: 502 },
    )
  }
}
