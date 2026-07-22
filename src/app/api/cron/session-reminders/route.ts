import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendPush } from '@/lib/push'
import { renderTemplate, NOTIFICATION_TYPES } from '@/lib/notification-types'
import { resolvePrefsForPairs } from '@/lib/notification-prefs'
import { sendTrainerEmail } from '@/lib/trainer-notify'

const APP_URL = 'https://app.pupmanager.com'

// Cron tick interval — must match Supabase pg_cron schedule. Defines the
// fuzziness window for matching a session against a trainer's chosen lead time.
const TICK_INTERVAL_MIN = 5
// We never look more than this far ahead; keeps the per-tick query bounded.
const MAX_LEAD_MIN = 240

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const now = new Date()
  const nowMs = now.getTime()
  // Pull every session that's still relevant: hasn't ended yet AND starts
  // within the lookahead window. The same session may be a candidate for both
  // the start reminder (before scheduledAt) and the notes reminder (before
  // scheduledAt + duration).
  const sessions = await prisma.trainingSession.findMany({
    where: {
      scheduledAt: { lte: new Date(nowMs + MAX_LEAD_MIN * 60_000) },
      status: 'UPCOMING',
      OR: [
        { reminderPushSentAt: null },
        { notesReminderPushSentAt: null },
      ],
      // Skip demo/sample sessions — they belong to a sample client (1:1) or a
      // sample class run, and should never generate real reminders. Real
      // sessions (incl. real class sessions with no client) are unaffected.
      // A cancelled class must never remind anyone, even if a session row was
      // left UPCOMING. Belt and braces alongside cancelling the sessions at the
      // source — a stale session status must not be able to page a client.
      NOT: {
        OR: [
          { client: { isSample: true } },
          { classRun: { isSample: true } },
          { classRun: { status: 'CANCELLED' } },
        ],
      },
    },
    include: {
      dog: { select: { name: true } },
      client: { select: { user: { select: { name: true } } } },
      // Pull the package's notes-reminder opt-out so we can skip the notes
      // push for packages that don't expect a follow-up. Sessions without a
      // package keep the default behaviour (reminder fires).
      clientPackage: { select: { package: { select: { requireSessionNotes: true } } } },
      trainer: {
        select: {
          user: {
            select: {
              id: true,
              notifyPush: true,
              timezone: true,
            },
          },
        },
      },
      // The member running the session, if assigned — they're the recipient of
      // the reminders (falling back to the owner below when unassigned).
      assignedTrainer: {
        select: {
          user: { select: { id: true, notifyPush: true, timezone: true } },
        },
      },
    },
  })

  if (sessions.length === 0) {
    return NextResponse.json({ sessionsConsidered: 0, startPushes: 0, notesPushes: 0, tokensInvalidated: 0 })
  }

  // Recipient = the member assigned to the session, else the org owner. Prefs
  // are resolved per (recipient, org) so a member who works across orgs gets
  // the settings they chose for THIS business.
  const recipientOf = (s: typeof sessions[number]) => s.assignedTrainer?.user ?? s.trainer.user
  const prefKey = (s: typeof sessions[number]) => `${recipientOf(s).id}:${s.trainerId}`
  const pairs = sessions.map(s => ({ userId: recipientOf(s).id, companyId: s.trainerId }))
  const [startPrefs, notesPrefs] = await Promise.all([
    resolvePrefsForPairs(pairs, 'SESSION_REMINDER', 'PUSH'),
    resolvePrefsForPairs(pairs, 'SESSION_NOTES_REMINDER', 'PUSH'),
  ])

  const startMeta = NOTIFICATION_TYPES.SESSION_REMINDER
  const notesMeta = NOTIFICATION_TYPES.SESSION_NOTES_REMINDER
  let startPushes = 0
  let notesPushes = 0

  for (const s of sessions) {
    const trainerUser = recipientOf(s)
    const minutesUntilStart = (s.scheduledAt.getTime() - nowMs) / 60_000
    const minutesUntilEnd = minutesUntilStart + s.durationMins

    // ── Start reminder ──────────────────────────────────────────────────
    if (!s.reminderPushSentAt) {
      const pref = startPrefs.get(prefKey(s))!
      const lead = pref.minutesBefore ?? startMeta.defaults.minutesBefore!
      const inWindow = minutesUntilStart > 0 && Math.abs(minutesUntilStart - lead) <= TICK_INTERVAL_MIN / 2

      if (inWindow) {
        const startTime = s.scheduledAt.toLocaleTimeString('en-NZ', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: trainerUser.timezone,
        })
        const subs = {
          dogName: s.dog?.name ?? '',
          clientName: s.client?.user?.name ?? '',
          title: s.title,
          startTime,
          minutesBefore: String(lead),
        }
        if (trainerUser.notifyPush && pref.enabled) {
          // `path` is consumed by the native shell's tap handler to deep-link
          // straight to the relevant session page.
          const { sent } = await sendPush(trainerUser.id, {
            alert: { title: renderTemplate(pref.title, subs), body: renderTemplate(pref.body, subs) },
            customData: { sessionId: s.id, type: 'session-reminder', path: `/sessions/${s.id}` },
          })
          startPushes += sent
        }
        // Email channel — gated by its own per-type toggle inside the helper.
        await sendTrainerEmail(trainerUser.id, 'SESSION_REMINDER', subs, `${APP_URL}/sessions/${s.id}`, s.trainerId)
        await prisma.trainingSession.update({ where: { id: s.id }, data: { reminderPushSentAt: now } })
      }
    }

    // ── Notes reminder (before session END) ─────────────────────────────
    // Skip entirely when the session's package has opted out of notes.
    // Mark as "sent" so we don't re-evaluate next tick.
    const packageRequiresNotes = s.clientPackage?.package?.requireSessionNotes ?? true
    if (!s.notesReminderPushSentAt && !packageRequiresNotes) {
      await prisma.trainingSession.update({ where: { id: s.id }, data: { notesReminderPushSentAt: now } })
    } else if (!s.notesReminderPushSentAt) {
      const pref = notesPrefs.get(prefKey(s))!
      const lead = pref.minutesBefore ?? notesMeta.defaults.minutesBefore!
      // Only fire while the session is in progress (or about to end). Skip
      // already-finished sessions — if the cron missed a tick we'd rather
      // skip the reminder than send a stale one.
      const inWindow = minutesUntilEnd > 0 && Math.abs(minutesUntilEnd - lead) <= TICK_INTERVAL_MIN / 2

      if (inWindow) {
        const endsAt = new Date(s.scheduledAt.getTime() + s.durationMins * 60_000)
        const endTime = endsAt.toLocaleTimeString('en-NZ', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: trainerUser.timezone,
        })
        const subs = {
          dogName: s.dog?.name ?? '',
          clientName: s.client?.user?.name ?? '',
          title: s.title,
          endTime,
          minutesBefore: String(lead),
        }
        if (trainerUser.notifyPush && pref.enabled) {
          // Deep-link straight to the session page with a #notes anchor so
          // the page can scroll/focus the notes editor when added.
          const { sent } = await sendPush(trainerUser.id, {
            alert: { title: renderTemplate(pref.title, subs), body: renderTemplate(pref.body, subs) },
            customData: { sessionId: s.id, type: 'session-notes-reminder', path: `/sessions/${s.id}#notes` },
          })
          notesPushes += sent
        }
        await sendTrainerEmail(trainerUser.id, 'SESSION_NOTES_REMINDER', subs, `${APP_URL}/sessions/${s.id}#notes`, s.trainerId)
        await prisma.trainingSession.update({ where: { id: s.id }, data: { notesReminderPushSentAt: now } })
      }
    }
  }

  return NextResponse.json({
    sessionsConsidered: sessions.length,
    startPushes,
    notesPushes,
  })
}
