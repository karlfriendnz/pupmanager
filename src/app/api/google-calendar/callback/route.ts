import { NextResponse, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exchangeCodeForTokens } from '@/lib/google-calendar'
import { refreshBusyForMembership, backfillSessionsToGoogle } from '@/lib/google-calendar-sync'

// OAuth2 redirect target. Verifies the CSRF state, exchanges the code for
// tokens, and upserts the member's GoogleCalendarConnection (keyed by membership).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const stateToken = searchParams.get('state')
  const settings = `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=calendar`

  // Every exit from here used to be the SAME `?googlecalendar=error`, on a page
  // that rendered no message for it. So a trainer clicked Connect, went to
  // Google, came back, and landed on a page that looked exactly as it had
  // before — reported to us as the connection "hanging". It never hung; it
  // failed silently, and there was no way to tell which of five reasons it was.
  //
  // Each reason now names itself, and Settings → Calendar says what it means.
  const fail = (reason: string) => `${settings}&googlecalendar=${reason}`

  // The trainer said no on Google's consent screen, or closed it.
  const denied = searchParams.get('error')
  if (denied) return NextResponse.redirect(fail(denied === 'access_denied' ? 'denied' : 'google'))

  if (!code || !stateToken) return NextResponse.redirect(fail('nocode'))

  // Verify + consume the one-time state token, recovering the membership id.
  const stateRecord = await prisma.verificationToken.findFirst({
    where: {
      token: stateToken,
      identifier: { startsWith: 'gcal-oauth:' },
      expires: { gt: new Date() },
    },
  })
  // Expired (10 min) or already used — the commonest real failure, and the
  // one most likely to be read as a hang: the trainer left the Google tab open.
  if (!stateRecord) return NextResponse.redirect(fail('expired'))
  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier: stateRecord.identifier, token: stateToken } },
  })
  // Identifier is `gcal-oauth:<membershipId>` or `gcal-oauth:<membershipId>:<base64url returnTo>`.
  const rest = stateRecord.identifier.slice('gcal-oauth:'.length)
  const colon = rest.indexOf(':')
  const membershipId = colon === -1 ? rest : rest.slice(0, colon)
  let returnTo = ''
  if (colon !== -1) {
    try {
      const decoded = Buffer.from(rest.slice(colon + 1), 'base64url').toString('utf8')
      if (decoded.startsWith('/') && !decoded.startsWith('//')) returnTo = decoded
    } catch { /* ignore a malformed return path — fall back to settings */ }
  }
  const done = returnTo
    ? `${process.env.NEXT_PUBLIC_APP_URL}${returnTo}${returnTo.includes('?') ? '&' : '?'}googlecalendar=connected`
    : `${settings}&googlecalendar=connected`

  // Resolve the company from the membership (also validates the id is still real).
  const membership = await prisma.trainerMembership.findUnique({
    where: { id: membershipId },
    select: { companyId: true },
  })
  if (!membership) return NextResponse.redirect(fail('nomember'))

  try {
    const tokens = await exchangeCodeForTokens(code)
    // Without a refresh token we can't keep the connection alive — treat as a
    // failed connect. Means prompt=consent wasn't honoured, which Google does
    // when the account has already granted this client (every trainer who signs
    // in with Google has). googleCalendarAuthorizeUrl sends access_type=offline
    // AND prompt=consent precisely to force one; if this fires, that is what
    // stopped working.
    if (!tokens.refresh_token) return NextResponse.redirect(fail('norefresh'))

    const data = {
      companyId: membership.companyId,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000 - 60 * 1000),
    }
    await prisma.googleCalendarConnection.upsert({
      where: { membershipId },
      create: { membershipId, ...data },
      update: data,
    })
  } catch (err) {
    // The token exchange itself was rejected. redirect_uri_mismatch lands here,
    // which is what a missing /api/google-calendar/callback entry in the Google
    // console looks like from our side.
    console.error('[google-calendar] callback failed', err)
    return NextResponse.redirect(fail('exchange'))
  }

  // Immediately pull the member's busy window so overlap warnings work right away.
  // Best-effort — a failure here doesn't undo the successful connect.
  try {
    await refreshBusyForMembership(membershipId)
  } catch (err) {
    console.error('[google-calendar] initial busy refresh failed', err)
  }

  // ...and push the diary they ALREADY have the other way.
  //
  // Outbound sync only ever fired as sessions were created or edited, so a
  // trainer who connected on Tuesday saw an empty Google Calendar and a term's
  // worth of classes that were never going to appear — the connection looked
  // broken when it was working exactly as built. Busy import has always been
  // seeded on connect (just above); this is the missing other half.
  //
  // Runs AFTER the redirect: the trainer lands back on Settings straight away
  // rather than watching a spinner while a term of classes is written to
  // Google. Scoped to this company, capped, and idempotent (only sessions with
  // no mirrored event), so a reconnect is cheap and nobody else is touched.
  after(async () => {
    try {
      const result = await backfillSessionsToGoogle({
        execute: true,
        companyId: membership.companyId,
        limit: 750,
      })
      console.log('[google-calendar] connect backfill', membership.companyId, result)
      if (result.remaining > 0) {
        // Bigger than one pass. The nightly cron picks up the rest; log it so a
        // "some classes are missing" report has something to stand on.
        console.warn('[google-calendar] connect backfill left', result.remaining, 'sessions for the cron')
      }
    } catch (err) {
      console.error('[google-calendar] connect backfill failed', err)
    }
  })

  return NextResponse.redirect(done)
}
