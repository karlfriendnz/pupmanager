import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyEnquiryFollowup } from '@/lib/notify-enquiry-followup'

// Nudges the trainer when a NEW enquiry has gone unanswered. Runs hourly
// (Supabase pg_cron — see prisma/migrations/*_enquiry_followup_reminders).
//
// Thresholds are elapsed hours since the enquiry landed. `followupReminderLevel`
// on the enquiry records the highest threshold already sent (0..4) so we never
// double-send and, if a cron tick is missed, we send only the most recent
// threshold rather than spamming every one we skipped past. An enquiry drops
// out of the query — and the nudges stop — the moment the trainer replies
// (an OUTBOUND message), accepts or declines (status leaves NEW).

const THRESHOLDS_H = [6, 18, 24, 36] as const

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const now = Date.now()
  const firstThresholdMs = THRESHOLDS_H[0] * 3_600_000

  // Candidates: still NEW, past the first threshold, not yet at the last
  // level, and with no reply sent. The heavy lifting (which exact threshold)
  // happens in code so the query stays a plain index scan.
  const enquiries = await prisma.enquiry.findMany({
    where: {
      status: 'NEW',
      // Never nudge on demo/sample enquiries — they're seeded as NEW with
      // backdated createdAt, so they'd otherwise trip every threshold at once.
      isSample: false,
      createdAt: { lte: new Date(now - firstThresholdMs) },
      followupReminderLevel: { lt: THRESHOLDS_H.length },
      messages: { none: { direction: 'OUTBOUND' } },
    },
    select: { id: true, createdAt: true, followupReminderLevel: true },
  })

  let sent = 0
  for (const e of enquiries) {
    const hoursSince = (now - e.createdAt.getTime()) / 3_600_000

    // Highest threshold index whose hour mark has passed (1-based level).
    let level = 0
    for (let i = 0; i < THRESHOLDS_H.length; i++) {
      if (hoursSince >= THRESHOLDS_H[i]) level = i + 1
    }
    if (level <= e.followupReminderLevel) continue

    await notifyEnquiryFollowup({ enquiryId: e.id, hours: THRESHOLDS_H[level - 1] })
    await prisma.enquiry.update({
      where: { id: e.id },
      data: { followupReminderLevel: level },
    })
    sent++
  }

  return NextResponse.json({ candidates: enquiries.length, nudgesSent: sent })
}
