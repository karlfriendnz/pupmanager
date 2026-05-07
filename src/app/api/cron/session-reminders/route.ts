import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { renderTemplate, NOTIFICATION_TYPES } from '@/lib/notification-types'
import { resolvePrefsForUsers } from '@/lib/notification-prefs'

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
              deviceTokens: { where: { platform: 'IOS' } },
            },
          },
        },
      },
    },
  })

  if (sessions.length === 0) {
    return NextResponse.json({ sessionsConsidered: 0, startPushes: 0, notesPushes: 0, tokensInvalidated: 0 })
  }

  const trainerUserIds = Array.from(new Set(sessions.map(s => s.trainer.user.id)))
  const [startPrefs, notesPrefs] = await Promise.all([
    resolvePrefsForUsers(trainerUserIds, 'SESSION_REMINDER', 'PUSH'),
    resolvePrefsForUsers(trainerUserIds, 'SESSION_NOTES_REMINDER', 'PUSH'),
  ])

  const startMeta = NOTIFICATION_TYPES.SESSION_REMINDER
  const notesMeta = NOTIFICATION_TYPES.SESSION_NOTES_REMINDER
  const tokensToDelete: string[] = []
  let startPushes = 0
  let notesPushes = 0

  for (const s of sessions) {
    const trainerUser = s.trainer.user
    const minutesUntilStart = (s.scheduledAt.getTime() - nowMs) / 60_000
    const minutesUntilEnd = minutesUntilStart + s.durationMins

    // ── Start reminder ──────────────────────────────────────────────────
    if (!s.reminderPushSentAt) {
      const pref = startPrefs.get(trainerUser.id)!
      const lead = pref.minutesBefore ?? startMeta.defaults.minutesBefore!
      const inWindow = minutesUntilStart > 0 && Math.abs(minutesUntilStart - lead) <= TICK_INTERVAL_MIN / 2

      if (inWindow) {
        if (!trainerUser.notifyPush || !pref.enabled || trainerUser.deviceTokens.length === 0) {
          await prisma.trainingSession.update({ where: { id: s.id }, data: { reminderPushSentAt: now } })
        } else {
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
          const results = await sendApns(trainerUser.deviceTokens.map(d => d.token), {
            alert: { title: renderTemplate(pref.title, subs), body: renderTemplate(pref.body, subs) },
            // `path` is consumed by the native shell's tap handler to deep-link
            // straight to the relevant session page.
            customData: { sessionId: s.id, type: 'session-reminder', path: `/sessions/${s.id}` },
          })
          for (const r of results) {
            if (r.ok) startPushes++
            else if (r.reason && INVALID_TOKEN_REASONS.has(r.reason)) tokensToDelete.push(r.token)
          }
          await prisma.trainingSession.update({ where: { id: s.id }, data: { reminderPushSentAt: now } })
        }
      }
    }

    // ── Notes reminder (before session END) ─────────────────────────────
    // Skip entirely when the session's package has opted out of notes.
    // Mark as "sent" so we don't re-evaluate next tick.
    const packageRequiresNotes = s.clientPackage?.package?.requireSessionNotes ?? true
    if (!s.notesReminderPushSentAt && !packageRequiresNotes) {
      await prisma.trainingSession.update({ where: { id: s.id }, data: { notesReminderPushSentAt: now } })
    } else if (!s.notesReminderPushSentAt) {
      const pref = notesPrefs.get(trainerUser.id)!
      const lead = pref.minutesBefore ?? notesMeta.defaults.minutesBefore!
      // Only fire while the session is in progress (or about to end). Skip
      // already-finished sessions — if the cron missed a tick we'd rather
      // skip the reminder than send a stale one.
      const inWindow = minutesUntilEnd > 0 && Math.abs(minutesUntilEnd - lead) <= TICK_INTERVAL_MIN / 2

      if (inWindow) {
        if (!trainerUser.notifyPush || !pref.enabled || trainerUser.deviceTokens.length === 0) {
          await prisma.trainingSession.update({ where: { id: s.id }, data: { notesReminderPushSentAt: now } })
        } else {
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
          const results = await sendApns(trainerUser.deviceTokens.map(d => d.token), {
            alert: { title: renderTemplate(pref.title, subs), body: renderTemplate(pref.body, subs) },
            // Deep-link straight to the session page with a #notes anchor so
            // the page can scroll/focus the notes editor when added.
            customData: { sessionId: s.id, type: 'session-notes-reminder', path: `/sessions/${s.id}#notes` },
          })
          for (const r of results) {
            if (r.ok) notesPushes++
            else if (r.reason && INVALID_TOKEN_REASONS.has(r.reason)) tokensToDelete.push(r.token)
          }
          await prisma.trainingSession.update({ where: { id: s.id }, data: { notesReminderPushSentAt: now } })
        }
      }
    }
  }

  if (tokensToDelete.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: tokensToDelete } } })
  }

  return NextResponse.json({
    sessionsConsidered: sessions.length,
    startPushes,
    notesPushes,
    tokensInvalidated: tokensToDelete.length,
  })
}
