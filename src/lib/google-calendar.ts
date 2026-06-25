import type { TrainingSession } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

// The shape Google's events endpoint accepts. Built identically for create and
// update so an event stays in sync with the session it mirrors.
function buildEventBody(session: TrainingSession) {
  const end = new Date(session.scheduledAt)
  end.setMinutes(end.getMinutes() + session.durationMins)
  return {
    summary: session.title,
    description: session.description ?? undefined,
    location: session.location ?? undefined,
    start: { dateTime: session.scheduledAt.toISOString() },
    end: { dateTime: end.toISOString() },
  }
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  return data.access_token
}

export async function syncSessionToGoogleCalendar(
  refreshToken: string,
  session: TrainingSession
): Promise<string | null> {
  const accessToken = await getAccessToken(refreshToken)

  const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildEventBody(session)),
  })

  if (!res.ok) return null
  const data = await res.json()
  return data.id ?? null
}

// Alias: clearer name at the create call sites.
export { syncSessionToGoogleCalendar as createGoogleCalendarEvent }

// Update an existing event in place. Best-effort — swallows failures (the
// caller treats calendar sync as non-critical).
export async function updateGoogleCalendarEvent(
  refreshToken: string,
  eventId: string,
  session: TrainingSession
): Promise<void> {
  const accessToken = await getAccessToken(refreshToken)
  await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${eventId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildEventBody(session)),
  })
}

// Best-effort orchestrator: mirror one session to the trainer's Google Calendar.
// No-ops when the trainer hasn't connected Google. Creates a new event (and
// persists its id) or patches the existing one. Never throws.
export async function syncSessionToGoogle(sessionId: string): Promise<void> {
  try {
    const session = await prisma.trainingSession.findUnique({ where: { id: sessionId } })
    if (!session) return

    const trainer = await prisma.trainerProfile.findUnique({
      where: { id: session.trainerId },
      select: { googleCalendarConnected: true, googleCalendarRefreshToken: true },
    })
    if (!trainer?.googleCalendarConnected || !trainer.googleCalendarRefreshToken) return

    if (session.googleCalendarEventId) {
      await updateGoogleCalendarEvent(trainer.googleCalendarRefreshToken, session.googleCalendarEventId, session)
    } else {
      const eventId = await syncSessionToGoogleCalendar(trainer.googleCalendarRefreshToken, session)
      if (eventId) {
        await prisma.trainingSession.update({
          where: { id: session.id },
          data: { googleCalendarEventId: eventId },
        })
      }
    }
  } catch (err) {
    console.error('[google-calendar] syncSessionToGoogle failed', err)
  }
}

// Batch variant of syncSessionToGoogle. Loads the (shared) trainer once, then
// creates/updates every session in parallel. Best-effort — never throws.
export async function syncSessionsToGoogle(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return
  try {
    const sessions = await prisma.trainingSession.findMany({ where: { id: { in: sessionIds } } })
    if (sessions.length === 0) return

    // All sessions in a batch share a trainer (same create call). Load once.
    const trainer = await prisma.trainerProfile.findUnique({
      where: { id: sessions[0].trainerId },
      select: { googleCalendarConnected: true, googleCalendarRefreshToken: true },
    })
    if (!trainer?.googleCalendarConnected || !trainer.googleCalendarRefreshToken) return
    const refreshToken = trainer.googleCalendarRefreshToken

    await Promise.all(
      sessions.map(async (session) => {
        try {
          if (session.googleCalendarEventId) {
            await updateGoogleCalendarEvent(refreshToken, session.googleCalendarEventId, session)
          } else {
            const eventId = await syncSessionToGoogleCalendar(refreshToken, session)
            if (eventId) {
              await prisma.trainingSession.update({
                where: { id: session.id },
                data: { googleCalendarEventId: eventId },
              })
            }
          }
        } catch (err) {
          console.error('[google-calendar] syncSessionsToGoogle item failed', session.id, err)
        }
      }),
    )
  } catch (err) {
    console.error('[google-calendar] syncSessionsToGoogle failed', err)
  }
}

export async function deleteGoogleCalendarEvent(
  refreshToken: string,
  eventId: string
): Promise<void> {
  const accessToken = await getAccessToken(refreshToken)
  await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
