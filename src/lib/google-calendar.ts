import type { GoogleCalendarConnection } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'

// Google Calendar OAuth2 + API client. PupManager is a confidential (server-side)
// client: each trainer connects their OWN Google account, and their sessions,
// classes and blocked-out time sync ONE-WAY into their calendar. Tokens live on
// GoogleCalendarConnection (one row per connected trainer). Unlike Xero, Google
// refresh tokens do NOT normally rotate — but we still persist a new one on the
// rare occasion the token endpoint returns it. Mirrors src/lib/xero.ts.

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

//   calendar.events   → create/update/delete events (the one-way sync)
//   calendar.freebusy → query the member's busy times (the busy-import warning);
//                       calendar.events alone does NOT authorise freeBusy.query
//   openid email      → identify the connected account (nice for future display)
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'openid',
  'email',
].join(' ')

// Refresh a little before the real expiry so an in-flight request never races
// the cutoff.
const EXPIRY_SKEW_MS = 60 * 1000

export function isGoogleCalendarConfigured(): boolean {
  return !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET
}

export function googleCalendarRedirectUri(): string {
  return `${env.NEXT_PUBLIC_APP_URL}/api/google-calendar/callback`
}

/** The Google consent URL to redirect the trainer to, carrying our CSRF state. */
export function googleCalendarAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleCalendarRedirectUri(),
    scope: SCOPES,
    // access_type=offline + prompt=consent are what get us a refresh token —
    // without prompt=consent Google withholds it on a re-consent.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
}

async function postToken(extra: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      ...extra,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google token request failed (${res.status}): ${text}`)
  }
  return res.json()
}

/** Exchange the authorization code from the callback for the initial tokens. */
export function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  return postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: googleCalendarRedirectUri(),
  })
}

function expiryFrom(expiresInSeconds: number): Date {
  return new Date(Date.now() + expiresInSeconds * 1000 - EXPIRY_SKEW_MS)
}

/**
 * Return a usable access token for this connection, refreshing (and persisting
 * the new access token + expiry) when the cached one is stale. Google usually
 * returns the same refresh token, but we persist a rotated one if present.
 * Throws if the refresh fails — the caller decides whether to surface or swallow.
 */
export async function getValidAccessToken(connection: GoogleCalendarConnection): Promise<string> {
  const fresh =
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() > Date.now()
  if (fresh) return connection.accessToken!

  const tokens = await postToken({
    grant_type: 'refresh_token',
    refresh_token: connection.refreshToken,
  })

  await prisma.googleCalendarConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiryFrom(tokens.expires_in),
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    },
  })

  return tokens.access_token
}

// The shape of a Google Calendar event we write. `start`/`end` are either a
// timed instant (dateTime, with an optional IANA timeZone) or an all-day date.
export type CalendarEventTime =
  | { dateTime: string; timeZone?: string }
  | { date: string }

export type CalendarEventInput = {
  summary: string
  description?: string
  location?: string
  start: CalendarEventTime
  end: CalendarEventTime
  // RRULE strings for recurring events (e.g. weekly availability).
  recurrence?: string[]
}

/**
 * Create (POST) or update (PATCH) an event in the trainer's calendar and return
 * its event id. Pass the existing `eventId` to update in place, or null to
 * create. Throws on a non-OK response so the best-effort sync layer can log it.
 */
export async function upsertCalendarEvent(
  connection: GoogleCalendarConnection,
  eventId: string | null,
  event: CalendarEventInput,
): Promise<string | null> {
  const accessToken = await getValidAccessToken(connection)
  const cal = encodeURIComponent(connection.calendarId)
  const url = eventId
    ? `${GOOGLE_CALENDAR_API_BASE}/calendars/${cal}/events/${encodeURIComponent(eventId)}`
    : `${GOOGLE_CALENDAR_API_BASE}/calendars/${cal}/events`
  const res = await fetch(url, {
    method: eventId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google Calendar event upsert failed (${res.status}): ${text}`)
  }
  const data: { id?: string } = await res.json()
  return data.id ?? eventId ?? null
}

export type BusyInterval = { start: Date; end: Date; sourceId?: string }

/**
 * Query the member's calendar for BUSY intervals between timeMin and timeMax via
 * Google's FreeBusy API. Returns the busy blocks (start/end) so we can warn on
 * overlaps. Throws on a non-OK response so the best-effort refresh layer logs it.
 */
export async function fetchFreeBusy(
  connection: GoogleCalendarConnection,
  timeMin: Date,
  timeMax: Date,
): Promise<BusyInterval[]> {
  const accessToken = await getValidAccessToken(connection)
  const res = await fetch(`${GOOGLE_CALENDAR_API_BASE}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: connection.calendarId }],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google FreeBusy query failed (${res.status}): ${text}`)
  }
  const data: { calendars?: Record<string, { busy?: { start: string; end: string }[] }> } = await res.json()
  const busy = data.calendars?.[connection.calendarId]?.busy ?? []
  return busy
    .filter((b) => b.start && b.end)
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
}

export type CalendarBusyEvent = { id: string | null; start: Date; end: Date; title: string | null }

/**
 * List the member's actual events between timeMin and timeMax (expanding
 * recurring series), returning each as a busy interval WITH its title — used to
 * populate the schedule's grey strips + hover popup. Skips cancelled and
 * "free"/transparent events (they don't block time). Throws on a non-OK response.
 */
export async function fetchCalendarEvents(
  connection: GoogleCalendarConnection,
  timeMin: Date,
  timeMax: Date,
): Promise<CalendarBusyEvent[]> {
  const accessToken = await getValidAccessToken(connection)
  const cal = encodeURIComponent(connection.calendarId)
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true', // expand recurring events into instances
    orderBy: 'startTime',
    maxResults: '2500',
    showDeleted: 'false',
  })
  const res = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${cal}/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google events list failed (${res.status}): ${text}`)
  }
  const data: {
    items?: {
      status?: string
      transparency?: string
      summary?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      id?: string
    }[]
  } = await res.json()

  const out: CalendarBusyEvent[] = []
  for (const e of data.items ?? []) {
    if (e.status === 'cancelled') continue
    if (e.transparency === 'transparent') continue // "free" — doesn't block time
    // Timed events use dateTime; all-day use date (midnight → midnight).
    const startStr = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null)
    const endStr = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : null)
    if (!startStr || !endStr) continue
    const start = new Date(startStr)
    const end = new Date(endStr)
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) continue
    out.push({ id: e.id ?? null, start, end, title: e.summary?.trim() || null })
  }
  return out
}

/** Delete an event from the trainer's calendar. Best-effort at the call site. */
export async function deleteCalendarEvent(
  connection: GoogleCalendarConnection,
  eventId: string,
): Promise<void> {
  const accessToken = await getValidAccessToken(connection)
  const cal = encodeURIComponent(connection.calendarId)
  await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/${cal}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

/**
 * Revoke the trainer's Google grant so PupManager is removed from their
 * connected apps — the Google analogue of Xero's DELETE /connections. Revoking
 * the refresh token cascades to any access token minted from it. Best-effort:
 * any error is swallowed so the caller's local disconnect still proceeds.
 */
export async function revokeGoogleTokens(connection: GoogleCalendarConnection): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(connection.refreshToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }).catch(() => {})
}
