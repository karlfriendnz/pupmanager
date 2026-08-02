import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { NOT_SUSPENDED, SESSIONS_NOT_SUSPENDED } from '@/lib/membership-access'
import { notifyClient } from '@/lib/client-notify'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'
import type { NotificationChannel } from '@/generated/prisma'

export const runtime = 'nodejs'

// Fires "before each session" reminders. Runs frequently (e.g. every 15 min via
// Supabase pg_cron). For every upcoming session it looks at each enrolled
// client's per-channel lead times and, for any lead whose moment has passed,
// sends the reminder via exactly those channels — once (deduped by
// ClientReminderSent). 1:1 sessions and group classes both covered.
const REMINDER = NOTIFICATION_TYPES.CLIENT_SESSION_REMINDER
const DEFAULT_LEAD = REMINDER.defaults.minutesBefore ?? 120
// Look ahead just past the longest supported lead (1 day) so a session enters
// the window before its earliest reminder is due.
const HORIZON_MS = 25 * 60 * 60 * 1000

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const now = new Date()
  const horizon = new Date(now.getTime() + HORIZON_MS)

  const sessions = await prisma.trainingSession.findMany({
    where: {
      scheduledAt: { gt: now, lte: horizon },
      status: 'UPCOMING',
      // …and not one occurrence the trainer called off on its own. Reminding
      // someone to turn up to the week that was cancelled is the single worst
      // way for them to find out it was.
      cancelledAt: null,
      OR: [{ clientId: { not: null } }, { classRunId: { not: null } }],
      // Don't remind sample clients about demo sessions (1:1 or sample class).
      // A cancelled class must never remind anyone, even if a session row was
      // left UPCOMING. Belt and braces alongside cancelling the sessions at the
      // source — a stale session status must not be able to page a client.
      NOT: {
        OR: [
          { client: { isSample: true } },
          { classRun: { isSample: true } },
          { classRun: { status: 'CANCELLED' } },
          // Never remind anyone about a dog that has died. Group sessions
          // carry no dog of their own, so this only sifts the 1:1 rows — the
          // class side is filtered per-enrolment below.
          { dog: { deceasedAt: { not: null } } },
        ],
      },
      // Don't remind someone about a session their paused membership has taken
      // away — being reminded to turn up to something you can no longer see in
      // the app is the worst possible version of losing access.
      //
      // Nested under AND deliberately: this clause is its own OR, and spreading
      // it at the top level would silently REPLACE the clientId/classRunId OR
      // above, quietly widening the query to every session in the database.
      AND: [SESSIONS_NOT_SUSPENDED],
    },
    select: {
      id: true, scheduledAt: true, title: true, trainerId: true, clientId: true,
      // The session happens in the TRAINER's locale, so the reminder time renders
      // in the trainer's timezone (never the server's UTC).
      trainer: { select: { user: { select: { timezone: true } } } },
      dog: { select: { name: true } },
      client: { select: { userId: true } },
      classRun: {
        select: {
          name: true,
          enrollments: {
            // Two independent reasons to skip an enrolment, and both apply.
            // A deceased dog's enrolment is skipped; an enrolment with no dog
            // on it at all is still a real person to remind, so it stays. And
            // a paused seat is still held, but the client should not be
            // reminded to attend while their plan is unpaid.
            // NOT_SUSPENDED is { suspendedAt: null } — no OR of its own, so it
            // spreads alongside the dog filter without clobbering it.
            where: {
              status: 'ENROLLED',
              OR: [{ dogId: null }, { dog: { deceasedAt: null } }],
              ...NOT_SUSPENDED,
            },
            select: { client: { select: { userId: true } }, dog: { select: { name: true } } },
          },
        },
      },
    },
  })

  let sent = 0
  for (const s of sessions) {
    const tz = s.trainer?.user?.timezone ?? 'Pacific/Auckland'
    const recipients = s.clientId && s.client?.userId
      ? [{ userId: s.client.userId, dogName: s.dog?.name ?? null, planName: s.title }]
      : (s.classRun?.enrollments ?? [])
          .filter(e => e.client?.userId)
          .map(e => ({ userId: e.client.userId, dogName: e.dog?.name ?? null, planName: s.classRun!.name }))

    for (const r of recipients) {
      // Build lead → channels from the client's per-channel leadMinutes (or the
      // default lead on the default channels when they've never set prefs).
      const prefRows = await prisma.notificationPreference.findMany({ where: { userId: r.userId, type: 'CLIENT_SESSION_REMINDER' } })
      const leadToChannels = new Map<number, NotificationChannel[]>()
      for (const ch of REMINDER.channels) {
        const pref = prefRows.find(p => p.channel === ch)
        const leads = pref ? pref.leadMinutes : ((REMINDER.defaultChannels ?? REMINDER.channels).includes(ch) ? [DEFAULT_LEAD] : [])
        for (const lead of leads) {
          const arr = leadToChannels.get(lead) ?? []
          arr.push(ch)
          leadToChannels.set(lead, arr)
        }
      }

      for (const [lead, channels] of leadToChannels) {
        const fireAt = s.scheduledAt.getTime() - lead * 60_000
        if (fireAt > now.getTime()) continue // not due yet

        // Atomic dedup: the unique (session, user, lead) row means a second
        // cron tick (or overlapping run) can't double-send.
        try {
          await prisma.clientReminderSent.create({ data: { sessionId: s.id, userId: r.userId, leadMinutes: lead } })
        } catch {
          continue // already sent
        }

        const startTime = s.scheduledAt.toLocaleString('en-NZ', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
        await notifyClient({
          userId: r.userId,
          trainerId: s.trainerId,
          type: 'CLIENT_SESSION_REMINDER',
          vars: { dogName: r.dogName ?? 'your dog', planName: r.planName, startTime },
          link: `/my-sessions/${s.id}`,
          ctaLabel: 'View session',
          channels,
        })
        sent++
      }
    }
  }

  return NextResponse.json({ ok: true, checked: sessions.length, sent })
}
